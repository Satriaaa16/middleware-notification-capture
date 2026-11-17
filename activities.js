import puppeteer from 'puppeteer';
import FormData from 'form-data';
import fetch from 'node-fetch';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const { GOOGLE_CHAT_WEBHOOK_URL, IMGBB_API_KEY } = config;

// Activity 1: Capture Screenshot & Upload ke ImgBB
export async function captureAndUpload(siteUrl) {
  const fileName = `/tmp/screenshot_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
  let pageStatusCode = 200;
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium-browser',
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--ignore-certificate-errors',
        '--window-size=1366,768',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url().toLowerCase();
      if (url.includes('onetrust') || url.includes('cookielaw') || url.includes('cookiebot') || url.includes('google-analytics')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      const response = await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      if (response) pageStatusCode = response.status();
    } catch (e) {
      console.log(`[WARN] Screenshot capture fallback: ${e.message}`);
    }

    await page.evaluate(() => {
      const selectors = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '#cybotcookiebotdialog', '[id*="cookie"]', '[class*="cookie"]'];
      selectors.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
    });

    await page.screenshot({ path: fileName, type: 'png', fullPage: false });
  } finally {
    if (browser) await browser.close();
  }

  // Upload Ke ImgBB
  let imageUrl = null;
  try {
    const form = new FormData();
    form.append('image', fs.createReadStream(fileName));
    const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: form });
    const imgbbData = await imgbbRes.json();
    imageUrl = imgbbData?.data?.display_url || imgbbData?.data?.url;
  } catch (uploadErr) {
    console.error('[ERROR Upload ImgBB]', uploadErr.message);
  } finally {
    if (fs.existsSync(fileName)) fs.unlinkSync(fileName);
  }

  return { imageUrl, pageStatusCode };
}

// Activity 2: Kirim Payload SRE Card ke Google Chat
export async function dispatchGoogleChat(googleChatPayload) {
  const res = await fetch(GOOGLE_CHAT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(googleChatPayload)
  });

  if (!res.ok) {
    throw new Error(`Google Chat API error: ${res.status} ${res.statusText}`);
  }
}
