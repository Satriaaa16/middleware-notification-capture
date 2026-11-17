import { Worker } from '@temporalio/worker';
import * as activities from './activities.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const worker = await Worker.create({
    workflowsPath: path.join(__dirname, 'workflows.js'),
    activities,
    taskQueue: 'uptime-kuma-sre-queue',
    maxConcurrentActivityTaskExecutions: 2, // Maksimal 2 Chromium jalan bersamaan
  });

  console.log('Temporal SRE Worker active on queue: uptime-kuma-sre-queue');
  await worker.run();
}

run().catch((err) => {
  console.error('[WORKER FATAL]', err);
  process.exit(1);
});
