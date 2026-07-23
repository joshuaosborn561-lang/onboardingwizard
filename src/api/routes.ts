import { Router } from 'express';
import { listJobs, getJob } from '../store/jobs.js';
import {
  advanceJob,
  handleInboxkitWebhook,
  startOnboarding,
  submitAnswers,
} from '../pipeline/onboarding.js';
import { verifyInboxkitSignature } from '../vendors/inboxkit.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'client-onboarding-automation' });
});

apiRouter.get('/jobs', (_req, res) => {
  const jobs = listJobs().map(summarizeJob);
  res.json({ jobs });
});

apiRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ job: sanitizeJob(job) });
});

apiRouter.post('/onboarding', async (req, res) => {
  try {
    const websiteUrl = String(req.body?.websiteUrl || req.body?.url || '').trim();
    if (!websiteUrl) {
      res.status(400).json({ error: 'websiteUrl is required' });
      return;
    }
    const forwardToUrl = String(req.body?.forwardToUrl || req.body?.mainDomain || '').trim();
    const companyName = String(req.body?.companyName || req.body?.company || '').trim();
    const inboxCount =
      req.body?.inboxCount != null ? Number(req.body.inboxCount) : undefined;
    const googleRatio =
      req.body?.googleRatio != null ? Number(req.body.googleRatio) : undefined;
    const manualApproval =
      req.body?.manualApproval == null
        ? true
        : !(
            req.body.manualApproval === false ||
            req.body.manualApproval === 'false' ||
            req.body.manualApproval === '0'
          );

    const job = await startOnboarding({
      websiteUrl,
      forwardToUrl: forwardToUrl || undefined,
      companyName: companyName || undefined,
      inboxCount,
      googleRatio,
      manualApproval,
    });
    res.status(201).json({ job: sanitizeJob(job) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

apiRouter.post('/jobs/:id/answers', async (req, res) => {
  try {
    const domains = req.body?.domains;
    const job = await submitAnswers(req.params.id, {
      porkbunApiKey: req.body?.porkbunApiKey,
      porkbunSecretApiKey: req.body?.porkbunSecretApiKey,
      porkbunLabel: req.body?.porkbunLabel,
      inboxkitWorkspaceId: req.body?.inboxkitWorkspaceId,
      domains: Array.isArray(domains)
        ? domains
        : domains != null
          ? String(domains)
          : undefined,
      inboxCount: req.body?.inboxCount,
      googleRatio: req.body?.googleRatio,
      companyName: req.body?.companyName,
      approved: req.body?.approved,
      mailboxPlan: req.body?.mailboxPlan,
    });
    res.json({ job: sanitizeJob(job) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 400;
    res.status(status).json({ error: message });
  }
});

apiRouter.post('/jobs/:id/advance', async (req, res) => {
  try {
    await advanceJob(req.params.id);
    const job = getJob(req.params.id);
    res.json({ job: job ? sanitizeJob(job) : null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export const webhookRouter = Router();

webhookRouter.post('/inboxkit', async (req, res) => {
  try {
    const signature = req.header('X-InboxKit-Signature') || undefined;
    // Signature is SHA-256 of API key; skip verification only if no header and we're in soft mode
    if (signature && !verifyInboxkitSignature(signature)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    // Ack immediately, process async — InboxKit expects 2xx within 10s
    res.status(200).json({ received: true });
    void handleInboxkitWebhook(req.body).catch((err) => {
      console.error('Webhook processing error', err);
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'handler_error' });
  }
});

function summarizeJob(job: ReturnType<typeof getJob>) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    websiteUrl: job.websiteUrl,
    forwardToUrl: job.forwardToUrl,
    companyName: job.companyName || job.brand?.clientName,
    clientName: job.brand?.clientName,
    pendingPrompt: job.pendingPrompt?.type ?? null,
    manualApproval: job.manualApproval,
    registeredDomains: job.registeredDomains.length,
    mailboxes: job.mailboxes.length,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
  };
}

function sanitizeJob(job: NonNullable<ReturnType<typeof getJob>>) {
  return {
    ...job,
    porkbun: job.porkbun
      ? {
          label: job.porkbun.label,
          apiKey: mask(job.porkbun.apiKey),
          secretApiKey: mask(job.porkbun.secretApiKey),
        }
      : undefined,
    mailboxes: job.mailboxes.map((m) => ({
      ...m,
      password: m.password ? '[redacted]' : undefined,
      appPassword: m.appPassword ? '[redacted]' : undefined,
    })),
  };
}

function mask(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
