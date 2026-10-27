import express from 'express';
import puppeteer from 'puppeteer';
import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

// 1. Load Konfigurasi
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const { PORT, GOOGLE_CHAT_WEBHOOK_URL, IMGBB_API_KEY, ENGINEER_MENTION } = config;

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  const payload = req.body;
  res.status(200).send('OK');

  console.log('[WEBHOOK RECEIVED]', JSON.stringify(payload));

  // Evaluasi Status Insiden
  const status = payload.heartbeat?.status;
  const isDown = status === 0;
  const isTest = payload.msg?.includes('Testing') || (!payload.heartbeat && !payload.msg?.includes('UP'));

  // Ekstrak Metadata Insiden (Single Target URL)
  const siteUrl = payload.monitor?.url || 'https://google.com';
  const monitorName = payload.monitor?.name || 'Production Web Service';
  const errorMsg = payload.heartbeat?.msg || payload.msg || (isDown ? 'Connection Timeout / HTTP 5xx Error' : 'HTTP 200 OK');
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';

  console.log(`[SRE-ALERT] Processing ${isDown ? 'CRITICAL' : 'RESOLVED'} state for ${monitorName} (${siteUrl})...`);
  const fileName = `screenshot_${Date.now()}.png`;

  let browser;
  try {
    // 2. Puppeteer Engine - User-Agent Stealth + Crisp Rendering
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors',
        '--window-size=1366,768',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Set Header Tambahan (Bypass Anti-Bot / WAF)
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
    });

    // Blokir Cookie Banner & Tracker
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('onetrust') || url.includes('cookielaw') || url.includes('google-analytics')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigasi dengan Timeout Toleran
    try {
      await page.goto(siteUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    } catch (e) {
      console.log(`[WARN] Page load fallback triggered (${e.message}), capturing current DOM...`);
    }

    // Pembersihan DOM Element (Cookie Banners)
    await page.evaluate(() => {
      const selectors = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '[id*="cookie"]', '[class*="cookie"]'];
      selectors.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });

    // Capture screenshot PNG (Viewable area)
    await page.screenshot({ path: fileName, type: 'png', fullPage: false });
    await browser.close();

    // 3. Upload Ke ImgBB & Ambil Direct Display URL (Tajam)
    const form = new FormData();
    form.append('image', fs.createReadStream(fileName));

    const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: form
    });
    const imgbbData = await imgbbRes.json();
    
    const imageUrl = imgbbData?.data?.display_url || imgbbData?.data?.url;

    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);

    // 4. Construct SRE Incident Card Payload
    let googleChatPayload;

    if (isDown || isTest) {
      googleChatPayload = {
        text: `🚨 ${ENGINEER_MENTION} *[INCIDENT ALERT]* ${monitorName} is DOWN!`,
        cardsV2: [
          {
            cardId: 'sreIncidentDownCard',
            card: {
              header: {
                title: `🔴 INCIDENT: ${monitorName}`,
                subtitle: `Severity: HIGH | Service Unavailable`,
                imageUrl: 'https://cdn-icons-png.flaticon.com/512/595/595067.png',
                imageType: 'CIRCLE'
              },
              sections: [
                {
                  widgets: [
                    // Visual Evidence (Atas)
                    ...(imageUrl ? [{
                      image: {
                        imageUrl: imageUrl,
                        altText: `Visual Evidence for ${siteUrl}`
                      }
                    }] : []),
                    // Incident Metadata (Bawah Gambar)
                    {
                      textParagraph: {
                        text: `<b>Target URL:</b> <a href="${siteUrl}">${siteUrl}</a><br>` +
                              `<b>Error Detail:</b> <code>${errorMsg}</code><br>` +
                              `<b>Timestamp:</b> ${timestamp}<br>` +
                              `<b>Assigned To:</b> ${ENGINEER_MENTION}`
                      }
                    }
                  ]
                }
              ]
            }
          }
        ]
      };
    } else {
      googleChatPayload = {
        text: `✅ *[RESOLVED]* ${monitorName} is BACK ONLINE`,
        cardsV2: [
          {
            cardId: 'sreIncidentRecoveryCard',
            card: {
              header: {
                title: `🟢 RESOLVED: ${monitorName}`,
                subtitle: `Status: Operational | Health Check Passed`,
                imageUrl: 'https://cdn-icons-png.flaticon.com/512/190/190411.png',
                imageType: 'CIRCLE'
              },
              sections: [
                {
                  widgets: [
                    // Visual Evidence (Atas)
                    ...(imageUrl ? [{
                      image: {
                        imageUrl: imageUrl,
                        altText: `Recovery State for ${siteUrl}`
                      }
                    }] : []),
                    // Recovery Metadata (Bawah Gambar)
                    {
                      textParagraph: {
                        text: `<b>Target URL:</b> <a href="${siteUrl}">${siteUrl}</a><br>` +
                              `<b>Status:</b> Service normal & responding correctly.<br>` +
                              `<b>Resolved At:</b> ${timestamp}`
                      }
                    }
                  ]
                }
              ]
            }
          }
        ]
      };
    }

    // 5. Dispatch Event ke Google Workspace Chat
    await fetch(GOOGLE_CHAT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(googleChatPayload)
    });

    console.log(`[SUCCESS] SRE Alert dispatched to Google Chat for ${siteUrl}`);

  } catch (err) {
    console.error(`[ERROR] SRE Alert pipeline failed for ${siteUrl}:`, err);
    if (browser) await browser.close();
    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
  }
});

app.listen(PORT, () => {
  console.log(`SRE Incident Receiver running on port ${PORT}...`);
});
