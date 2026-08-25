import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { apiRouter, webhookRouter } from './api/routes.js';
import { pollAwaitingNsJobs } from './pipeline/onboarding.js';
import { pollInboxkitStuck } from './pipeline/inboxkitStuckWatch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRouter);
app.use('/webhooks', webhookRouter);
app.use(express.static(publicDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`Client onboarding automation listening on :${config.port}`);
  // NS sync often takes 3–4h; poll every 15m like DW's pool provisioner
  setInterval(() => {
    void pollAwaitingNsJobs();
    void pollInboxkitStuck();
  }, 15 * 60 * 1000);
  setTimeout(() => void pollAwaitingNsJobs(), 20_000);
  setTimeout(() => void pollInboxkitStuck(), 45_000);
});
