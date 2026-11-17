import express from 'express';
import fs from 'fs';
import { Connection, Client } from '@temporalio/client';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const { PORT, ENGINEER_MENTION } = config;

const app = express();
app.use(express.json());

// Inisialisasi koneksi Temporal Client sekali saat server start
const connection = await Connection.connect({ address: 'localhost:7233' });
const temporalClient = new Client({ connection });

app.post('/webhook', async (req, res) => {
  const payload = req.body;
  const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
  const monitorId = payload.monitor?.id || 'test';

  try {
    const handle = await temporalClient.workflow.start('uptimeAlertWorkflow', {
      taskQueue: 'uptime-kuma-sre-queue',
      workflowId: `kuma-${monitorId}-${Date.now()}`,
      args: [{
        payload,
        engineerMention: ENGINEER_MENTION,
        timestamp
      }],
    });

    console.log(`[QUEUED] WorkflowId: ${handle.workflowId} | Monitor: ${payload.monitor?.name || 'Test'}`);
    res.status(200).send({ status: 'SUCCESS_QUEUED', workflowId: handle.workflowId });
  } catch (err) {
    console.error('[QUEUE ERROR]', err);
    res.status(500).send({ status: 'FAILED_TO_QUEUE', error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sensitivy SRE Receiver active on port ${PORT}...`);
});
