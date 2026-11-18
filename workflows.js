import { proxyActivities } from '@temporalio/workflow';

const { captureAndUpload, dispatchGoogleChat } = proxyActivities({
  startToCloseTimeout: '45 seconds',
  retry: {
    initialInterval: '3s',
    backoffCoefficient: 2,
    maximumAttempts: 4, // Otomatis retry hingga 4x jika gagal
  },
});

export async function uptimeAlertWorkflow({ payload, engineerMention, timestamp }) {
  const heartbeatStatus = payload.heartbeat?.status;
  const msgText = (payload.msg || payload.heartbeat?.msg || '').toLowerCase();

  const isDown = heartbeatStatus === 0 || msgText.includes('down') || msgText.includes('fail') || msgText.includes('expire');
  const isTest = msgText.includes('testing') || (!payload.heartbeat && !msgText.includes('up'));

  const rawErrorMsg = payload.heartbeat?.msg || payload.msg || (isDown ? 'Service Down / Timeout' : 'HTTP 200 OK');

  // Ekstrak domain dari pesan jika payload.monitor kosong (kasus Domain/SSL Expiry)
  const domainMatch = rawErrorMsg.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\.[a-zA-Z]{2,})?)/);
  const extractedDomain = domainMatch ? domainMatch[1] : null;

  const siteUrl = payload.monitor?.url 
    || (extractedDomain ? `https://${extractedDomain}` : 'https://google.com');

  const monitorName = payload.monitor?.name 
    || (extractedDomain ? `Domain/SSL Alert (${extractedDomain})` : 'Production Service');

  // Step 1: Jalankan Activity Capture & Upload
  const { imageUrl, pageStatusCode } = await captureAndUpload(siteUrl);

  // Hilangkan kata "Puppeteer" & tampilkan HTTP status hanya jika >= 400
  const displayErrorMsg = (isDown || isTest)
    ? (pageStatusCode >= 400 ? `${rawErrorMsg} (HTTP ${pageStatusCode})` : rawErrorMsg)
    : 'HTTP 200 OK / Service Operational';

  // Step 2: Susun SRE Card Payload (Persis seperti kodemu)
  let googleChatPayload;

  if (isDown || isTest) {
    googleChatPayload = {
      text: `🚨 ${engineerMention} *[INCIDENT ALERT]* ${monitorName} is DOWN!`,
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
                  ...(imageUrl ? [{
                    image: {
                      imageUrl: imageUrl,
                      altText: `Visual Evidence for ${siteUrl}`
                    }
                  }] : []),
                  {
                    textParagraph: {
                      text: `<b>Target URL:</b> <a href="${siteUrl}">${siteUrl}</a><br>` +
                            `<b>Error Detail:</b> <code>${displayErrorMsg}</code><br>` +
                            `<b>Timestamp:</b> ${timestamp}<br>` +
                            `<b>Assigned To:</b> ${engineerMention}`
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
                  ...(imageUrl ? [{
                    image: {
                      imageUrl: imageUrl,
                      altText: `Recovery State for ${siteUrl}`
                    }
                  }] : []),
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

  // Step 3: Jalankan Activity Kirim ke Google Chat
  await dispatchGoogleChat(googleChatPayload);
}
