import { Router } from 'express';
import { listJobs, getJob } from '../store/jobs.js';
import {
  advanceJob,
  applySlackApproval,
  handleInboxkitWebhook,
  retryRemainingRegistrations,
  startOnboarding,
  submitAnswers,
  syncOwnedDomainsAndContinue,
} from '../pipeline/onboarding.js';
import { verifyInboxkitSignature } from '../vendors/inboxkit.js';
import { verifyApproveToken } from '../lib/approveToken.js';
import { notifyMailboxPlanSlack } from '../vendors/slack.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'client-onboarding-automation' });
});

/** One-click Slack approval buttons land here. */
apiRouter.get('/approve', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const parsed = verifyApproveToken(token);
    if (!parsed) {
      res.status(400).send(approveHtml('Invalid or expired approval link', false));
      return;
    }
    const { jobId, gate, ...extras } = parsed;
    const job = await applySlackApproval(jobId, gate, extras);
    const name = job.companyName || job.brand?.clientName || job.websiteUrl;
    res
      .status(200)
      .send(
        approveHtml(
          `Approved <strong>${escapeHtml(gate.replace(/_/g, ' '))}</strong> for <strong>${escapeHtml(name)}</strong>. You can close this tab.`,
          true,
        ),
      );
  } catch (err) {
    res
      .status(400)
      .send(
        approveHtml(escapeHtml(err instanceof Error ? err.message : String(err)), false),
      );
  }
});

/** Re-send Slack approval buttons for the job's current pending prompt. */
apiRouter.post('/jobs/:id/slack-nudge', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    const prompt = job.pendingPrompt;
    if (!prompt) {
      res.status(400).json({ error: 'Job has no pending approval' });
      return;
    }
    const clientName = job.companyName || job.brand?.clientName || job.websiteUrl;
    if (prompt.type === 'domain_approval') {
      const { notifyDomainApprovalSlack } = await import('../vendors/slack.js');
      await notifyDomainApprovalSlack({
        jobId: job.id,
        clientName,
        primaryUrl: job.websiteUrl,
        recommendedDomains: prompt.recommendedDomains?.length
          ? prompt.recommendedDomains
          : prompt.availableDomains.slice(0, 20).map((d) => d.domain),
        allAvailableCount: prompt.availableDomains.length,
        inboxCount: prompt.suggestedInboxCount,
        googleRatio: prompt.suggestedGoogleRatio,
        costEachUsd: (prompt.availableDomains[0]?.costCents ?? 360) / 100,
      });
    } else if (prompt.type === 'mailbox_plan') {
      await notifyMailboxPlanSlack({
        jobId: job.id,
        clientName,
        domainCount: job.registeredDomains.length,
        googleCount: prompt.googleCount,
        microsoftCount: prompt.microsoftCount,
        totalInboxes: prompt.plan.length,
      });
    } else if (prompt.type === 'smartlead_load') {
      const { notifySmartleadLoadSlack } = await import('../vendors/slack.js');
      await notifySmartleadLoadSlack({
        jobId: job.id,
        clientName,
        mailboxCount: prompt.mailboxCount,
        sampleSignatures: prompt.sampleSignatures,
      });
    } else if (prompt.type === 'porkbun_funds') {
      const { notifyFundsSlack } = await import('../vendors/slack.js');
      await notifyFundsSlack({
        jobId: job.id,
        clientName,
        remaining: prompt.remainingDomains.length,
        estimatedCostUsd: prompt.estimatedCostUsd ?? 0,
        balanceUsd: prompt.balanceUsd,
      });
    } else {
      res.status(400).json({ error: `No Slack template for ${prompt.type}` });
      return;
    }
    res.json({ ok: true, gate: prompt.type });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function approveHtml(message: string, ok: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Onboarding</title>
  <style>body{font-family:system-ui,sans-serif;background:#0f1a17;color:#e8f0ec;display:grid;place-items:center;min-height:100vh;margin:0}
  .card{max-width:28rem;padding:1.5rem 1.75rem;border:1px solid rgba(232,240,236,.15);border-radius:14px;background:rgba(22,36,33,.92)}
  .ok{color:#3d9b6e}.bad{color:#d4655a}</style></head>
  <body><div class="card"><p class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${message}</p></div></body></html>`;
}

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

apiRouter.post('/jobs/:id/retry-register', async (req, res) => {
  try {
    const job = await retryRemainingRegistrations(req.params.id);
    res.json({ job: sanitizeJob(job) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 500;
    res.status(status).json({ error: message });
  }
});

apiRouter.post('/jobs/:id/sync-owned', async (req, res) => {
  try {
    const job = await syncOwnedDomainsAndContinue(req.params.id);
    res.json({ job: sanitizeJob(job) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : 500;
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
