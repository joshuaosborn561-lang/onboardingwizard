import { nanoid } from 'nanoid';
import { config, webhookBaseUrl } from '../config.js';
import { appendLog, getJob, listJobs, saveJob } from '../store/jobs.js';
import type {
  DomainCandidate,
  JobStep,
  MailboxPlanSlot,
  MailboxRecord,
  OnboardingJob,
  Platform,
} from '../types.js';
import { createEmptyJob } from '../types.js';
import { generateAffixCandidates } from '../lib/domainNaming.js';
import { INBOXES_PER_DOMAIN, inboxesForDomains, domainsForInboxes } from '../lib/opsRules.js';
import { allocateMailboxIdentities } from '../lib/mailboxNames.js';
import { generateCandidateDomains } from '../vendors/gemini.js';
import {
  buyMailboxesBatched,
  cancelMailboxes,
  checkNameserverPropagation,
  countNameserversReady,
  createWorkspace,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  getMailboxCredentials,
  getMailboxDetails,
  getNameserversForConnection,
  getSequencerExportStatus,
  listMailboxes,
  setDomainForwarding,
  setWorkspaceWebhook,
  uncancelMailboxes,
} from '../vendors/inboxkit.js';
import {
  checkDomainThrottled,
  disableDomainAutoRenew,
  forwardDomainToMain,
  getAccountBalance,
  listAllDomains,
  registerDomain,
  updateNameservers,
  type PorkbunCredentials,
} from '../vendors/porkbun.js';
import { sleep } from '../lib/http.js';
import {
  notifyDomainApprovalSlack,
  notifyFailure,
  notifyFundsSlack,
  notifyMailboxPlanSlack,
  notifySmartleadLoadSlack,
  notifySuccess,
  dismissSlackApprovalMessage,
  type SlackMessageRef,
} from '../vendors/slack.js';
import type { ApproveGate } from '../lib/approveToken.js';
import {
  addEmailAccount,
  assignAccountToClient,
  buildSignaturePlain,
  createClient,
  enableWarmup,
  listClients,
  listEmailAccounts,
  smtpDefaultsForPlatform,
  uniqueClientLoginEmail,
} from '../vendors/smartlead.js';
import { ingestWebsite } from '../vendors/website.js';

const running = new Set<string>();

function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export async function startOnboarding(input: {
  websiteUrl: string;
  forwardToUrl?: string;
  companyName?: string;
  inboxCount?: number;
  googleRatio?: number;
  inboxkitWorkspaceId?: string;
  smartleadClientId?: number;
  /**
   * Always true — paid actions (Porkbun register, InboxKit buy/cancel) require
   * explicit human approval. Passing false is ignored.
   */
  manualApproval?: boolean;
}): Promise<OnboardingJob> {
  const websiteUrl = normalizeHttpUrl(input.websiteUrl);
  const forwardToUrl = normalizeHttpUrl(input.forwardToUrl || websiteUrl);
  const companyName = (input.companyName || '').trim();
  void input.manualApproval;
  const job = createEmptyJob({
    id: nanoid(12),
    websiteUrl,
    forwardToUrl,
    companyName,
    inboxCount: input.inboxCount && input.inboxCount > 0 ? Math.floor(input.inboxCount) : 0,
    googleRatio:
      input.googleRatio != null && input.googleRatio >= 0 && input.googleRatio <= 1
        ? input.googleRatio
        : 2 / 3,
    // Hard rule: never auto-spend wallet / registrar balance.
    manualApproval: true,
  });
  if (input.inboxkitWorkspaceId?.trim()) {
    job.inboxkitWorkspaceId = input.inboxkitWorkspaceId.trim();
  }
  if (input.smartleadClientId && Number.isFinite(input.smartleadClientId)) {
    job.smartleadClientId = Number(input.smartleadClientId);
  }
  saveJob(job);
  void advanceJob(job.id);
  return job;
}

export async function submitAnswers(
  jobId: string,
  answers: {
    porkbunApiKey?: string;
    porkbunSecretApiKey?: string;
    porkbunLabel?: string;
    inboxkitWorkspaceId?: string;
    domains?: string[] | string;
    inboxCount?: number | string;
    googleRatio?: number | string;
    companyName?: string;
    approved?: boolean | string;
    mailboxPlan?: Array<{
      domain: string;
      platform: Platform;
      firstName?: string;
      lastName?: string;
      username?: string;
    }>;
  },
): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  const approved = isApprovedFlag(answers.approved);

  if (job.pendingPrompt?.type === 'porkbun_credentials') {
    const apiKey = answers.porkbunApiKey?.trim();
    const secretApiKey = answers.porkbunSecretApiKey?.trim();
    if (!apiKey || !secretApiKey) {
      throw new Error('porkbunApiKey and porkbunSecretApiKey are required');
    }
    job.porkbun = {
      apiKey,
      secretApiKey,
      label: answers.porkbunLabel?.trim() || undefined,
    };
    job.pendingPrompt = null;
    job.status = 'check_domains';
    appendLog(job, 'Received Porkbun main-account credentials');
    saveJob(job);
    void advanceJob(job.id);
    return job;
  }

  if (job.pendingPrompt?.type === 'domain_approval') {
    if (!approved) {
      throw new Error(
        'Approve domain purchase to continue (approved=true). Domains are a paid action.',
      );
    }
    const selected = normalizeDomainList(answers.domains);
    if (!selected.length) {
      throw new Error('Select at least one domain to register');
    }
    const available = new Set(
      job.candidates.filter((c) => c.available).map((c) => c.domain.toLowerCase()),
    );
    for (const d of selected) {
      if (!available.has(d.toLowerCase())) {
        throw new Error(`Domain not available for registration: ${d}`);
      }
    }
    for (const c of job.candidates) {
      c.selected = selected.some((d) => d.toLowerCase() === c.domain.toLowerCase());
    }
    if (answers.inboxCount != null && String(answers.inboxCount).trim() !== '') {
      const n = Number(answers.inboxCount);
      if (!Number.isFinite(n) || n < 0) throw new Error('inboxCount must be a non-negative number');
      job.inboxCount = Math.floor(n);
    }
    if (answers.googleRatio != null && String(answers.googleRatio).trim() !== '') {
      const r = Number(answers.googleRatio);
      if (!Number.isFinite(r) || r < 0 || r > 1) {
        throw new Error('googleRatio must be between 0 and 1');
      }
      job.googleRatio = r;
    }
    if (answers.companyName?.trim()) {
      job.companyName = answers.companyName.trim();
    }
    job.domainPurchaseApprovedAt = new Date().toISOString();
    job.mailboxPurchaseApprovedAt = undefined;
    job.smartleadLoadApprovedAt = undefined;
    job.pendingPrompt = null;
    job.status = 'register_domains';
    appendLog(
      job,
      `Approved ${selected.length} domain(s): ${selected.join(', ')} · inboxes=${
        job.inboxCount || 'auto'
      } · googleRatio=${job.googleRatio}`,
    );
    saveJob(job);
    void advanceJob(job.id);
    return job;
  }

  if (job.pendingPrompt?.type === 'porkbun_funds') {
    if (!approved) throw new Error('Confirm funds were added (approved=true) to retry');
    job.pendingPrompt = null;
    appendLog(job, 'Porkbun funds confirmed — retrying remaining domains');
    saveJob(job);
    return retryRemainingRegistrations(jobId);
  }

  if (job.pendingPrompt?.type === 'mailbox_plan') {
    if (!approved) {
      throw new Error(
        'Approve the mailbox order spend to continue (approved=true). Mailboxes are a paid action.',
      );
    }
    if (answers.mailboxPlan?.length) {
      const identities = allocateMailboxIdentities(answers.mailboxPlan.length);
      job.mailboxPlan = answers.mailboxPlan.map((p, i) => {
        const id = identities[i]!;
        return {
          domain: p.domain,
          platform: (p.platform === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE') as Platform,
          firstName: p.firstName || id.first_name,
          lastName: p.lastName || id.last_name,
          username: p.username || id.username,
        };
      });
      job.expectedMailboxCount = job.mailboxPlan.length;
    }
    job.mailboxPurchaseApprovedAt = new Date().toISOString();
    job.smartleadLoadApprovedAt = undefined;
    job.pendingPrompt = null;
    job.status = 'buy_mailboxes';
    appendLog(
      job,
      `Mailbox plan approved (${job.expectedMailboxCount} inboxes)`,
    );
    saveJob(job);
    void advanceJob(job.id);
    return job;
  }

  if (job.pendingPrompt?.type === 'smartlead_load') {
    if (!approved) throw new Error('Approve Smartlead load to continue (approved=true)');
    job.smartleadLoadApprovedAt = new Date().toISOString();
    job.pendingPrompt = null;
    job.status = 'load_smartlead';
    appendLog(job, 'Smartlead load approved');
    saveJob(job);
    void advanceJob(job.id);
    return job;
  }

  if (job.pendingPrompt?.type === 'inboxkit_workspace') {
    const ws = answers.inboxkitWorkspaceId?.trim();
    if (!ws) throw new Error('inboxkitWorkspaceId is required');
    job.inboxkitWorkspaceId = ws;
    job.pendingPrompt = null;
    job.status = 'provision_mailboxes';
    appendLog(job, `Using provided InboxKit workspace ${ws}`);
    saveJob(job);
    void advanceJob(job.id);
    return job;
  }

  throw new Error('This job is not waiting for answers');
}

/** One-click approvals from Slack button URLs. */
export async function applySlackApproval(
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  const clientName = job.companyName || job.brand?.clientName || job.websiteUrl;
  const storedRef = job.slackApprovals?.[gate] as SlackMessageRef | undefined;

  const dismiss = async (label: string) => {
    await dismissSlackApprovalMessage(storedRef, label);
    const latest = getJob(jobId);
    if (latest?.slackApprovals?.[gate]) {
      delete latest.slackApprovals[gate];
      saveJob(latest);
    }
  };

  if (!job.pendingPrompt || job.pendingPrompt.type !== gate) {
    await dismiss(`${gate.replace(/_/g, ' ')} for ${clientName} (already handled)`);
    // Treat repeat clicks as success so the browser page isn't scary
    if (job.status !== 'failed' && !job.pendingPrompt) {
      return job;
    }
    throw new Error(
      `Job is not waiting for ${gate} (status=${job.status}, prompt=${job.pendingPrompt?.type || 'none'})`,
    );
  }

  let result: OnboardingJob;
  if (gate === 'domain_approval' && job.pendingPrompt.type === 'domain_approval') {
    const mode = extras.mode || 'recommended';
    const domains =
      mode === 'all'
        ? job.pendingPrompt.availableDomains.map((d) => d.domain)
        : job.pendingPrompt.recommendedDomains?.length
          ? job.pendingPrompt.recommendedDomains
          : job.pendingPrompt.availableDomains.slice(0, 20).map((d) => d.domain);
    const inboxCount =
      extras.inboxCount != null && extras.inboxCount !== ''
        ? Number(extras.inboxCount)
        : inboxesForDomains(domains.length);
    const googleRatio =
      extras.googleRatio != null && extras.googleRatio !== ''
        ? Number(extras.googleRatio)
        : job.pendingPrompt.suggestedGoogleRatio;
    result = await submitAnswers(jobId, {
      approved: true,
      domains,
      inboxCount,
      googleRatio,
      companyName: job.companyName,
    });
  } else if (gate === 'mailbox_plan') {
    result = await submitAnswers(jobId, { approved: true });
  } else if (gate === 'smartlead_load') {
    result = await submitAnswers(jobId, { approved: true });
  } else if (gate === 'porkbun_funds') {
    result = await submitAnswers(jobId, { approved: true });
  } else {
    throw new Error(`Unsupported approval gate: ${gate}`);
  }

  await dismiss(`${gate.replace(/_/g, ' ')} for ${clientName}`);
  return result;
}

function rememberSlackApproval(
  job: OnboardingJob,
  gate: ApproveGate,
  ref: SlackMessageRef,
): void {
  if (!ref.ts) return;
  job.slackApprovals = {
    ...(job.slackApprovals || {}),
    [gate]: {
      channel: ref.channel,
      ts: ref.ts,
      bodyBlocks: ref.bodyBlocks,
      text: ref.text,
    },
  };
}

function normalizeDomainList(raw: string[] | string | undefined): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((d) => String(d).trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[\s,]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

function isApprovedFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

export async function advanceJob(jobId: string): Promise<void> {
  if (running.has(jobId)) return;
  running.add(jobId);
  try {
    let job = requireJob(jobId);
    while (true) {
      if (job.pendingPrompt || job.status === 'await_mailboxes' || job.status === 'completed') {
        break;
      }
      if (job.status === 'failed') break;

      try {
        switch (job.status) {
          case 'ingest':
            job = await stepIngest(job);
            break;
          case 'generate_domains':
            job = await stepGenerateDomains(job);
            break;
          case 'await_porkbun':
            return;
          case 'check_domains':
            job = await stepCheckDomains(job);
            break;
          case 'await_domain_approval':
            return;
          case 'register_domains':
            job = await stepRegisterDomains(job);
            break;
          case 'await_porkbun_funds':
            return;
          case 'await_inboxkit_workspace':
            return;
          case 'provision_mailboxes':
            job = await stepProvisionMailboxes(job);
            break;
          case 'await_ns':
            job = await stepAwaitNs(job);
            break;
          case 'await_mailbox_plan':
            return;
          case 'buy_mailboxes':
            job = await stepBuyMailboxes(job);
            break;
          case 'await_smartlead_load':
            return;
          case 'load_smartlead':
            job = await stepLoadSmartlead(job);
            break;
          case 'create_smartlead_client':
            job = await stepCreateSmartleadClient(job);
            break;
          case 'notify_complete':
            job = await stepNotifyComplete(job);
            break;
          default:
            appendLog(job, `No handler for status ${job.status}`);
            saveJob(job);
            return;
        }
      } catch (err) {
        if (err instanceof NsNotReadyError) {
          // Stay parked in await_ns until the poller retries
          appendLog(job, err.message);
          saveJob(job);
          return;
        }
        await failJob(job, job.status, err);
        return;
      }
    }
  } finally {
    running.delete(jobId);
  }
}

function requireJob(id: string): OnboardingJob {
  const job = getJob(id);
  if (!job) throw new Error(`Job not found: ${id}`);
  return job;
}

async function stepIngest(job: OnboardingJob): Promise<OnboardingJob> {
  appendLog(job, `Ingesting website ${job.websiteUrl}`);
  saveJob(job);
  const brand = await ingestWebsite(job.websiteUrl, { companyName: job.companyName });
  if (!brand.pageTextSample) {
    appendLog(
      job,
      brand.summary || `Website scrape unavailable — continuing with ${brand.clientName}`,
    );
  }
  job.brand = brand;
  if (!job.companyName) {
    job.companyName = brand.clientName;
  }
  if (!job.forwardToUrl) {
    job.forwardToUrl = brand.websiteUrl;
  }
  job.status = 'generate_domains';
  appendLog(
    job,
    `Ingested brand context for ${brand.clientName} (forward → ${job.forwardToUrl}; sig company "${job.companyName}")`,
  );
  return saveJob(job);
}

async function stepGenerateDomains(job: OnboardingJob): Promise<OnboardingJob> {
  if (!job.brand) throw new Error('Missing brand context');
  appendLog(job, 'Generating .info affix variations of the primary domain');
  saveJob(job);
  const domains = await generateCandidateDomains(job.brand);
  job.candidates = domains.map((domain) => ({ domain }));

  // Prefer main-account env credentials — no per-client Porkbun subaccounts.
  if (hasMainPorkbunCredentials(job)) {
    job.pendingPrompt = null;
    job.status = 'check_domains';
    appendLog(
      job,
      `Generated ${domains.length} candidates; using main Porkbun account`,
    );
    return saveJob(job);
  }

  job.status = 'await_porkbun';
  job.pendingPrompt = {
    type: 'porkbun_credentials',
    message:
      'Porkbun main-account API key and secret are not configured. Paste them once (or set PORKBUN_API_KEY / PORKBUN_SECRET_API_KEY).',
  };
  appendLog(
    job,
    `Generated ${domains.length} candidates; waiting for Porkbun main credentials`,
  );
  return saveJob(job);
}

async function stepCheckDomains(job: OnboardingJob): Promise<OnboardingJob> {
  const creds = resolvePorkbun(job);
  appendLog(
    job,
    `Checking availability for ${job.candidates.length} candidates (throttled ~10.5s/check)`,
  );
  saveJob(job);

  let checked = await checkCandidates(job, job.candidates, creds);
  job.candidates = checked;

  let available = checked.filter((c) => c.available);
  if (available.length < 4 && job.brand) {
    appendLog(
      job,
      `Only ${available.length} available — generating shorter affix fallbacks and rechecking`,
    );
    const extra = generateAffixCandidates(
      {
        websiteUrl: job.brand.websiteUrl,
        brandWords: job.brand.brandWords,
        clientName: job.brand.clientName,
      },
      48,
    ).filter((d) => !checked.some((c) => c.domain === d));
    if (extra.length) {
      const more = await checkCandidates(
        job,
        extra.map((domain) => ({ domain })),
        creds,
      );
      checked = [...checked, ...more];
      job.candidates = checked;
      available = checked.filter((c) => c.available);
    }
  }

  if (available.length === 0) {
    throw Object.assign(new Error('None of the candidate domains were available on Porkbun'), {
      domain: checked[0]?.domain,
    });
  }

  const recommendedLimit =
    job.inboxCount > 0 ? Math.max(1, domainsForInboxes(job.inboxCount)) : 20;
  const recommendedDomains = pickRecommendedDomains(
    available.map((c) => c.domain),
    recommendedLimit,
  );
  // Default ops plan: exactly INBOXES_PER_DOMAIN senders per approved domain.
  const suggestedInboxCount =
    job.inboxCount > 0 ? job.inboxCount : inboxesForDomains(recommendedDomains.length);
  job.domainPurchaseApprovedAt = undefined;
  job.mailboxPurchaseApprovedAt = undefined;
  job.smartleadLoadApprovedAt = undefined;
  job.status = 'await_domain_approval';
  job.pendingPrompt = {
    type: 'domain_approval',
    message:
      'Approve which domains to buy on the main Porkbun account, how many inboxes, and the Google/Microsoft split.',
    availableDomains: available.map((c) => ({
      domain: c.domain,
      costCents: c.costCents,
    })),
    recommendedDomains,
    suggestedInboxCount,
    suggestedGoogleRatio: job.googleRatio,
  };
  appendLog(
    job,
    `${available.length} domain(s) available — waiting for your approval before registration`,
  );
  saveJob(job);
  try {
    const costEach = (available[0]?.costCents ?? 360) / 100;
    const previewPlan = planMailboxes(recommendedDomains, suggestedInboxCount, job.googleRatio);
    const planPreview = summarizePlanByDomain(previewPlan);
    const ref = await notifyDomainApprovalSlack({
      jobId: job.id,
      clientName: job.companyName || job.brand?.clientName || job.websiteUrl,
      primaryUrl: job.websiteUrl,
      companyName: job.companyName || job.brand?.clientName || 'Company',
      recommendedDomains,
      allAvailableCount: available.length,
      inboxCount: suggestedInboxCount,
      googleRatio: job.googleRatio,
      costEachUsd: costEach,
      planPreview,
    });
    rememberSlackApproval(job, 'domain_approval', ref);
    appendLog(job, 'Slack domain-approval message sent (with approve buttons)');
    saveJob(job);
  } catch (err) {
    appendLog(
      job,
      `Slack domain-approval ping failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return saveJob(job);
}

/** Prefer readable prefix affixes (try/go/get/now/…) then fill to `limit`. */
function pickRecommendedDomains(available: string[], limit = 20): string[] {
  const preferred = [
    'try',
    'go',
    'get',
    'now',
    'my',
    'use',
    'pro',
    'hq',
    'win',
    'top',
    'new',
    'run',
    'app',
    'hub',
    'lab',
  ];
  const scored = available.map((domain) => {
    const label = domain.replace(/\.info$/i, '');
    let score = 100;
    for (let i = 0; i < preferred.length; i++) {
      const aff = preferred[i]!;
      if (label.startsWith(aff)) {
        score = i;
        break;
      }
      if (label.endsWith(aff)) {
        score = 50 + i;
        break;
      }
    }
    return { domain, score };
  });
  scored.sort((a, b) => a.score - b.score || a.domain.localeCompare(b.domain));
  return scored.slice(0, limit).map((s) => s.domain);
}

async function checkCandidates(
  job: OnboardingJob,
  candidates: DomainCandidate[],
  creds: PorkbunCredentials,
): Promise<DomainCandidate[]> {
  const checked: DomainCandidate[] = [];
  for (const candidate of candidates) {
    try {
      const result = await checkDomainThrottled(candidate.domain, creds);
      checked.push({
        ...candidate,
        available: result.available,
        costCents: result.priceCents,
      });
      appendLog(
        job,
        `${candidate.domain}: ${result.available ? 'available' : 'unavailable'}${
          result.priceCents != null ? ` ($${(result.priceCents / 100).toFixed(2)})` : ''
        }`,
      );
      saveJob(job);
    } catch (err) {
      checked.push({
        ...candidate,
        available: false,
        error: err instanceof Error ? err.message : String(err),
      });
      appendLog(job, `${candidate.domain}: check failed — ${checked.at(-1)?.error}`);
      saveJob(job);
      await new Promise((r) => setTimeout(r, 10_500));
    }
  }
  return checked;
}

async function stepRegisterDomains(job: OnboardingJob): Promise<OnboardingJob> {
  const result = await registerSelectedDomains(job);
  if (result.pendingFunds) {
    return result.job;
  }
  if (result.job.registeredDomains.length === 0) {
    throw new Error('Domain registration failed for every approved domain');
  }
  result.job.status = 'provision_mailboxes';
  appendLog(
    result.job,
    `Registered ${result.job.registeredDomains.length} domains; continuing to InboxKit`,
  );
  return saveJob(result.job);
}

/**
 * Register any selected domains that are not yet registered (throttled).
 * Pauses on insufficient funds so the operator can top up and retry.
 */
export async function retryRemainingRegistrations(jobId: string): Promise<OnboardingJob> {
  let job = requireJob(jobId);
  job.pendingPrompt = null;
  appendLog(job, 'Retrying remaining Porkbun domain registrations');
  saveJob(job);

  const result = await registerSelectedDomains(job);
  job = result.job;
  if (result.pendingFunds) {
    return job;
  }
  if (job.registeredDomains.length === 0) {
    throw new Error('No domains registered after retry');
  }

  // Re-run InboxKit connect for the full set (workspace may already exist).
  job.status = 'provision_mailboxes';
  job.mailboxPlan = undefined;
  saveJob(job);
  void advanceJob(job.id);
  return job;
}

async function registerSelectedDomains(
  job: OnboardingJob,
): Promise<{ job: OnboardingJob; pendingFunds: boolean }> {
  const creds = resolvePorkbun(job);
  const already = new Set(job.registeredDomains.map((d) => d.toLowerCase()));
  const toRegister = job.candidates.filter(
    (c) => c.selected && c.available !== false && !c.registered && !already.has(c.domain.toLowerCase()),
  );

  if (toRegister.length === 0) {
    appendLog(job, 'No remaining domains to register');
    return { job: saveJob(job), pendingFunds: false };
  }

  appendLog(job, `Registering ${toRegister.length} domain(s) on Porkbun (throttled)`);
  saveJob(job);

  const newly: string[] = [];
  for (const c of toRegister) {
    try {
      let cost = c.costCents;
      if (cost == null) {
        const again = await checkDomainThrottled(c.domain, creds);
        cost = again.priceCents ?? 360;
      }
      await registerDomain(c.domain, creds, cost);
      try {
        await disableDomainAutoRenew(c.domain, creds);
      } catch (err) {
        appendLog(
          job,
          `Could not disable auto-renew on ${c.domain}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Porkbun create limit ~1/sec
      await sleep(1500);
      c.registered = true;
      c.costCents = cost;
      c.error = undefined;
      newly.push(c.domain);
      if (!job.registeredDomains.includes(c.domain)) {
        job.registeredDomains.push(c.domain);
      }
      appendLog(job, `Registered ${c.domain} on Porkbun`);
      try {
        await forwardDomainToMain(c.domain, creds, job.forwardToUrl);
        appendLog(job, `Porkbun URL forward ${c.domain} → ${job.forwardToUrl}`);
      } catch (fwdErr) {
        appendLog(
          job,
          `Porkbun URL forward failed for ${c.domain}: ${
            fwdErr instanceof Error ? fwdErr.message : String(fwdErr)
          }`,
        );
      }
      saveJob(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      c.registered = false;
      c.error = message;
      appendLog(job, `Failed to register ${c.domain}: ${message}`);
      saveJob(job);
      await notifyFailure({
        step: 'register_domains',
        clientName: job.brand?.clientName,
        message,
        domain: c.domain,
        jobId: job.id,
      });

      if (/insufficient funds/i.test(message)) {
        const remaining = job.candidates
          .filter((x) => x.selected && !x.registered)
          .map((x) => x.domain);
        let balanceUsd: number | undefined;
        try {
          const bal = await getAccountBalance(creds);
          balanceUsd = bal.balanceCents / 100;
        } catch {
          // ignore
        }
        const estimated =
          remaining.reduce((sum, d) => {
            const cnd = job.candidates.find((x) => x.domain === d);
            return sum + (cnd?.costCents ?? 360);
          }, 0) / 100;
        job.status = 'await_porkbun_funds';
        job.pendingPrompt = {
          type: 'porkbun_funds',
          message:
            'Porkbun wallet ran out mid-registration. Add funds to the main account, then retry.',
          remainingDomains: remaining,
          registeredCount: job.registeredDomains.length,
          estimatedCostUsd: estimated,
          balanceUsd,
        };
        appendLog(
          job,
          `Paused for Porkbun funds — ${remaining.length} domain(s) left (~$${estimated.toFixed(2)}; balance ${
            balanceUsd != null ? `$${balanceUsd.toFixed(2)}` : 'unknown'
          })`,
        );
        saveJob(job);
        try {
          const ref = await notifyFundsSlack({
            jobId: job.id,
            clientName: job.brand?.clientName || job.companyName || job.websiteUrl,
            remaining: remaining.length,
            estimatedCostUsd: estimated,
            balanceUsd,
            remainingDomains: remaining,
          });
          rememberSlackApproval(job, 'porkbun_funds', ref);
        } catch {
          // non-fatal
        }
        return { job: saveJob(job), pendingFunds: true };
      }

      // Rate-limit / transient — brief pause then continue
      await sleep(1500);
    }
  }

  return { job: saveJob(job), pendingFunds: false };
}

/**
 * Rebuild an even per-domain mailbox plan and re-send the Slack approval
 * message with the full domain → inbox breakdown.
 */
export async function refreshMailboxPlanAndNudge(jobId: string): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  if (job.pendingPrompt?.type !== 'mailbox_plan' && job.status !== 'await_mailbox_plan') {
    throw new Error('Job is not waiting for mailbox plan approval');
  }
  const plan = ensurePlanIdentities(
    planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio),
  );
  job.mailboxPlan = plan;
  job.expectedMailboxCount = plan.length;
  const googleCount = plan.filter((p) => p.platform === 'GOOGLE').length;
  const microsoftCount = plan.filter((p) => p.platform === 'MICROSOFT').length;
  job.mailboxPurchaseApprovedAt = undefined;
  job.smartleadLoadApprovedAt = undefined;
  job.status = 'await_mailbox_plan';
  job.pendingPrompt = {
    type: 'mailbox_plan',
    message:
      'Nameservers are ready. Approve the InboxKit mailbox order (platform split per domain) before we spend wallet balance.',
    plan,
    googleCount,
    microsoftCount,
  };
  appendLog(
    job,
    `Mailbox plan refreshed for Slack approval (${googleCount} Google / ${microsoftCount} Microsoft)`,
  );
  saveJob(job);
  const ref = await notifyMailboxPlanSlack({
    jobId: job.id,
    clientName: job.brand?.clientName || job.companyName || job.websiteUrl,
    companyName: job.companyName || job.brand?.clientName || 'Company',
    domainCount: job.registeredDomains.length,
    googleCount,
    microsoftCount,
    totalInboxes: plan.length,
    plan,
  });
  rememberSlackApproval(job, 'mailbox_plan', ref);
  appendLog(job, 'Slack mailbox-plan approval message sent (detailed)');
  return saveJob(job);
}

/**
 * Mark selected domains already owned on Porkbun as registered, then continue
 * InboxKit provisioning (used after manual/external registration).
 */
export async function syncOwnedDomainsAndContinue(jobId: string): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  const creds = resolvePorkbun(job);
  appendLog(job, 'Syncing owned Porkbun domains into job state');
  saveJob(job);

  let owned = new Set<string>();
  try {
    const listed = await listAllDomains(creds);
    owned = new Set(listed.map((d) => d.toLowerCase()));
  } catch (err) {
    appendLog(
      job,
      `Porkbun listAll failed (${err instanceof Error ? err.message : String(err)}); assuming selected domains are owned`,
    );
    for (const c of job.candidates.filter((x) => x.selected)) {
      owned.add(c.domain.toLowerCase());
    }
  }

  let added = 0;
  for (const c of job.candidates) {
    if (!c.selected) continue;
    if (!owned.has(c.domain.toLowerCase())) continue;
    if (!c.registered) {
      c.registered = true;
      c.error = undefined;
      added++;
    }
    if (!job.registeredDomains.some((d) => d.toLowerCase() === c.domain.toLowerCase())) {
      job.registeredDomains.push(c.domain);
    }
  }

  appendLog(
    job,
    `Sync complete — ${job.registeredDomains.length} registered domain(s) (${added} newly marked)`,
  );
  job.pendingPrompt = null;
  job.error = undefined;
  job.mailboxPlan = undefined;
  job.status = 'provision_mailboxes';
  saveJob(job);
  void advanceJob(job.id);
  return job;
}

async function stepProvisionMailboxes(job: OnboardingJob): Promise<OnboardingJob> {
  if (!job.inboxkitWorkspaceId) {
    const webhookUrl = `${webhookBaseUrl()}/webhooks/inboxkit`;
    const name = job.brand?.clientName || new URL(job.websiteUrl).hostname;
    try {
      appendLog(job, `Creating InboxKit workspace for ${name}`);
      saveJob(job);
      const ws = await createWorkspace(name, webhookUrl);
      job.inboxkitWorkspaceId = ws.uid;
      appendLog(job, `Created InboxKit workspace ${ws.uid}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(job, `Workspace create failed (${message}); asking for existing workspace ID`);
      job.status = 'await_inboxkit_workspace';
      job.pendingPrompt = {
        type: 'inboxkit_workspace',
        message:
          'InboxKit workspace creation was not available via API. Paste an existing workspace ID to place the mailbox order under.',
        reason: message,
      };
      return saveJob(job);
    }
  } else {
    try {
      const webhookUrl = `${webhookBaseUrl()}/webhooks/inboxkit`;
      await setWorkspaceWebhook(job.inboxkitWorkspaceId, webhookUrl);
      appendLog(job, `Registered InboxKit webhook on workspace ${job.inboxkitWorkspaceId}`);
    } catch (err) {
      appendLog(
        job,
        `Warning: could not set webhook (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  const workspaceId = job.inboxkitWorkspaceId!;
  const domains = job.registeredDomains;
  const creds = resolvePorkbun(job);

  appendLog(job, `Connecting ${domains.length} domains to InboxKit (nameserver setup)`);
  saveJob(job);
  const nsResults = await getNameserversForConnection(workspaceId, domains);

  const domainUids: string[] = [];
  for (const result of nsResults) {
    const candidate = job.candidates.find((c) => c.domain === result.domain);
    if (candidate) {
      candidate.nameservers = result.nameservers;
      candidate.inboxkitDomainUid = result.uid;
    }
    if (result.uid) domainUids.push(result.uid);
    if (result.nameservers?.length) {
      try {
        await updateNameservers(result.domain, creds, result.nameservers);
        appendLog(
          job,
          `Updated Porkbun NS for ${result.domain} → ${result.nameservers.join(', ')}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendLog(job, `NS update failed for ${result.domain}: ${message}`);
        await notifyFailure({
          step: 'provision_mailboxes',
          clientName: job.brand?.clientName,
          message: `Nameserver update failed: ${message}`,
          domain: result.domain,
          jobId: job.id,
        });
      }
    }
  }

  if (domainUids.length) {
    try {
      await setDomainForwarding(workspaceId, domainUids, job.forwardToUrl);
      appendLog(
        job,
        `InboxKit domain forwarding set for ${domainUids.length} domains → ${job.forwardToUrl}`,
      );
    } catch (err) {
      appendLog(
        job,
        `InboxKit forwarding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  try {
    await checkNameserverPropagation(workspaceId, domains);
    appendLog(job, 'Requested InboxKit nameserver propagation check');
  } catch (err) {
    appendLog(
      job,
      `NS propagation check skipped/failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const plan = planMailboxes(domains, job.inboxCount, job.googleRatio);
  job.expectedMailboxCount = plan.length;
  job.mailboxPlan = plan;

  job.status = 'await_ns';
  appendLog(
    job,
    `NS updated. Waiting for InboxKit nameserver match before buying ${plan.length} mailboxes (often 3–4h).`,
  );
  return saveJob(job);
}

async function stepAwaitNs(job: OnboardingJob): Promise<OnboardingJob> {
  const workspaceId = job.inboxkitWorkspaceId;
  if (!workspaceId) throw new Error('Missing InboxKit workspace for NS wait');

  try {
    await checkNameserverPropagation(workspaceId, job.registeredDomains);
  } catch {
    // non-fatal
  }

  const { matched, total, missing } = await countNameserversReady(
    workspaceId,
    job.registeredDomains,
  );
  appendLog(job, `NS ready ${matched}/${total}${missing.length ? ` (pending: ${missing.slice(0, 5).join(', ')})` : ''}`);

  if (matched < total) {
    // Stay in await_ns — poller will retry
    saveJob(job);
    throw new NsNotReadyError(`NS ${matched}/${total}`);
  }

  const plan = ensurePlanIdentities(
    job.mailboxPlan ||
      planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio),
  );
  job.mailboxPlan = plan;
  job.expectedMailboxCount = plan.length;

  // Always require Slack/UI approval before InboxKit wallet spend.
  const googleCount = plan.filter((p) => p.platform === 'GOOGLE').length;
  const microsoftCount = plan.filter((p) => p.platform === 'MICROSOFT').length;
  job.mailboxPurchaseApprovedAt = undefined;
  job.smartleadLoadApprovedAt = undefined;
  job.status = 'await_mailbox_plan';
  job.pendingPrompt = {
    type: 'mailbox_plan',
    message:
      'Nameservers are ready. Approve the InboxKit mailbox order (platform split per domain) before we spend wallet balance.',
    plan,
    googleCount,
    microsoftCount,
  };
  appendLog(
    job,
    `NS ready — waiting for mailbox plan approval (${googleCount} Google / ${microsoftCount} Microsoft)`,
  );
  saveJob(job);
  try {
    const ref = await notifyMailboxPlanSlack({
      jobId: job.id,
      clientName: job.brand?.clientName || job.companyName || job.websiteUrl,
      companyName: job.companyName || job.brand?.clientName || 'Company',
      domainCount: job.registeredDomains.length,
      googleCount,
      microsoftCount,
      totalInboxes: plan.length,
      plan,
    });
    rememberSlackApproval(job, 'mailbox_plan', ref);
    appendLog(job, 'Slack mailbox-plan approval message sent (with approve button)');
  } catch (err) {
    appendLog(
      job,
      `Slack approval ping failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return saveJob(job);
}

class NsNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NsNotReadyError';
  }
}

async function stepBuyMailboxes(job: OnboardingJob): Promise<OnboardingJob> {
  const workspaceId = job.inboxkitWorkspaceId!;
  const plan =
    job.mailboxPlan ||
    planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio);

  // Prefer identities already shown on Slack approval so names stay unique + stable.
  const planWithNames = ensurePlanIdentities(plan);
  job.mailboxPlan = planWithNames;
  job.expectedMailboxCount = planWithNames.length;
  appendLog(
    job,
    `NS matched — ordering ${planWithNames.length} mailboxes (${planWithNames.filter((p) => p.platform === 'GOOGLE').length} Google / ${planWithNames.filter((p) => p.platform === 'MICROSOFT').length} Microsoft)`,
  );
  saveJob(job);

  const buyRequests = planWithNames.map((p, i) => ({
    domainName: p.domain,
    platform: p.platform,
    seed: i,
    firstName: p.firstName,
    lastName: p.lastName,
    username: p.username,
  }));

  try {
    const created = await buyMailboxesBatched(workspaceId, buyRequests, {
      useWalletBalance: true,
      gapMs: 1200,
    });
    mergeMailboxesIntoJob(job, created, planWithNames);
    appendLog(
      job,
      `Mailbox order submitted (${job.mailboxes.length}); waiting for InboxKit webhooks (often 6–8h)`,
    );
  } catch (err) {
    const partial = (err as { partialMailboxes?: Array<Record<string, string>> })?.partialMailboxes;
    if (partial?.length) {
      mergeMailboxesIntoJob(job, partial as Array<{
        uid: string;
        domain_name: string;
        first_name: string;
        last_name: string;
        username: string;
        platform: string;
        status: string;
      }>, planWithNames);
      appendLog(job, `Saved ${partial.length} mailboxes from partial buy before failure`);
      saveJob(job);
    }
    throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), {
      domain: (err as { domain?: string })?.domain || job.registeredDomains[0],
    });
  }

  job.status = 'await_mailboxes';
  return saveJob(job);
}

function mergeMailboxesIntoJob(
  job: OnboardingJob,
  created: Array<{
    uid: string;
    domain_name: string;
    first_name: string;
    last_name: string;
    username: string;
    platform: string;
    status: string;
  }>,
  planWithNames: MailboxPlanSlot[],
): void {
  for (const m of created) {
    const planned = planWithNames.find(
      (p) =>
        p.domain.toLowerCase() === m.domain_name.toLowerCase() &&
        p.username.toLowerCase() === (m.username || '').toLowerCase(),
    );
    const existing = job.mailboxes.find((x) => x.uid === m.uid);
    if (existing) {
      existing.status = m.status || existing.status;
      if (m.first_name) existing.firstName = m.first_name;
      if (m.last_name) existing.lastName = m.last_name;
      if (m.username) existing.username = m.username;
      continue;
    }
    job.mailboxes.push({
      uid: m.uid,
      email: `${m.username}@${m.domain_name}`,
      username: m.username,
      firstName: m.first_name || planned?.firstName || '',
      lastName: m.last_name || planned?.lastName || '',
      platform: (m.platform as Platform) || planned?.platform || 'GOOGLE',
      domain: m.domain_name,
      status: m.status || 'scheduled',
    });
  }
}

/**
 * Import existing InboxKit mailboxes for this job's domains (recovers partial buys
 * that succeeded in InboxKit but were not saved on the job).
 */
export async function syncMailboxesFromInboxkit(jobId: string): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  const workspaceId = job.inboxkitWorkspaceId;
  if (!workspaceId) throw new Error('Job has no InboxKit workspace');

  const listed = await listMailboxes(workspaceId, { limit: 100 });
  const wanted = new Set(job.registeredDomains.map((d) => d.toLowerCase()));
  const relevant = listed.filter((m) => wanted.has(String(m.domain_name || '').toLowerCase()));

  const plan =
    job.mailboxPlan ||
    planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio);
  const planWithNames = ensurePlanIdentities(plan);
  job.mailboxPlan = planWithNames;
  // Always target at least 2 per registered domain, but never under-count seats we already bought.
  job.inboxCount = Math.max(inboxesForDomains(wanted.size), relevant.length);
  job.expectedMailboxCount = Math.max(inboxesForDomains(wanted.size), relevant.length);

  mergeMailboxesIntoJob(
    job,
    relevant.map((m) => ({
      uid: m.uid,
      domain_name: m.domain_name || '',
      first_name: m.first_name || '',
      last_name: m.last_name || '',
      username: m.username || '',
      platform: m.platform || 'GOOGLE',
      status: m.status || 'scheduled',
    })),
    planWithNames,
  );

  appendLog(
    job,
    `Synced ${relevant.length} InboxKit mailbox(es) into job (${job.mailboxes.length} total tracked)`,
  );
  job.error = undefined;
  if (job.status === 'failed' || job.status === 'buy_mailboxes' || job.status === 'await_mailbox_plan') {
    job.status = 'await_mailboxes';
    job.pendingPrompt = null;
  }
  // Keep inventory we already paid for (e.g. Cornerstone 5/domain) while future plans stay at 2/domain.
  job.expectedMailboxCount = Math.max(job.mailboxes.length, inboxesForDomains(wanted.size));
  job.inboxCount = Math.max(job.inboxCount || 0, job.expectedMailboxCount);
  saveJob(job);
  await maybeRequestSmartleadApproval(job);
  return requireJob(jobId);
}

/**
 * Cancel extras so each domain has at most INBOXES_PER_DOMAIN mailboxes (ops rule).
 * Prefer cancelling the newest / non-active seats first.
 *
 * Requires confirmed=true — this is a paid-seat action and must not run silently.
 */
export async function trimMailboxesToMaxPerDomain(
  jobId: string,
  opts: { confirmed?: boolean } = {},
): Promise<OnboardingJob> {
  if (!opts.confirmed) {
    throw new Error(
      'Refusing to cancel InboxKit mailboxes without confirmed=true (paid seats — explicit approval required)',
    );
  }
  const job = requireJob(jobId);
  const workspaceId = job.inboxkitWorkspaceId;
  if (!workspaceId) throw new Error('Job has no InboxKit workspace');

  const byDomain = new Map<string, typeof job.mailboxes>();
  for (const m of job.mailboxes) {
    const key = m.domain.toLowerCase();
    const list = byDomain.get(key) ?? [];
    list.push(m);
    byDomain.set(key, list);
  }

  const cancelUids: string[] = [];
  const keep = new Set<string>();
  for (const [, list] of byDomain) {
    // Keep active seats preferentially, then older ones
    const ranked = [...list].sort((a, b) => {
      const score = (m: (typeof list)[number]) =>
        m.status === 'active' ? 0 : m.status === 'failed' ? 2 : 1;
      return score(a) - score(b);
    });
    for (const m of ranked.slice(0, INBOXES_PER_DOMAIN)) keep.add(m.uid);
    for (const m of ranked.slice(INBOXES_PER_DOMAIN)) cancelUids.push(m.uid);
  }

  if (cancelUids.length) {
    appendLog(
      job,
      `Trimming to ${INBOXES_PER_DOMAIN}/domain — cancelling ${cancelUids.length} extra mailbox(es) in InboxKit (explicitly confirmed)`,
    );
    saveJob(job);
    await cancelMailboxes(workspaceId, cancelUids);
    job.mailboxes = job.mailboxes.filter((m) => keep.has(m.uid));
  }

  job.inboxCount = inboxesForDomains(job.registeredDomains.length);
  job.expectedMailboxCount = inboxesForDomains(job.registeredDomains.length);
  appendLog(
    job,
    `Mailbox trim complete — ${job.mailboxes.length} tracked, expected ${job.expectedMailboxCount} (${INBOXES_PER_DOMAIN} × ${job.registeredDomains.length} domains)`,
  );
  return saveJob(job);
}

/** @deprecated Use trimMailboxesToMaxPerDomain — cap is now 2/domain. */
export const trimMailboxesToFourPerDomain = trimMailboxesToMaxPerDomain;

/**
 * Restore mailboxes that were scheduled for cancellation (e.g. accidental trim).
 * Requires confirmed=true. Re-syncs job state from InboxKit afterward.
 */
export async function restoreCancelledMailboxes(
  jobId: string,
  opts: { confirmed?: boolean } = {},
): Promise<OnboardingJob> {
  if (!opts.confirmed) {
    throw new Error(
      'Refusing to uncancel InboxKit mailboxes without confirmed=true (explicit approval required)',
    );
  }
  const job = requireJob(jobId);
  const workspaceId = job.inboxkitWorkspaceId;
  if (!workspaceId) throw new Error('Job has no InboxKit workspace');

  const listed = await listMailboxes(workspaceId, { limit: 100 });
  const listedCancelling = await listMailboxes(workspaceId, {
    limit: 100,
    status: 'scheduled_for_cancellation',
  }).catch(() => []);
  const listedCancelled = await listMailboxes(workspaceId, {
    limit: 100,
    status: 'cancelled',
  }).catch(() => []);

  const wanted = new Set(job.registeredDomains.map((d) => d.toLowerCase()));
  const byUid = new Map<string, (typeof listed)[number]>();
  for (const m of [...listed, ...listedCancelling, ...listedCancelled]) {
    const dom = String(m.domain_name || '').toLowerCase();
    if (!wanted.has(dom)) continue;
    const st = String(m.status || '').toLowerCase();
    const cs = String(m.mailbox_cancellation_status || '').toLowerCase();
    const isCancelling =
      st.includes('cancel') ||
      cs.includes('cancel') ||
      cs === 'scheduled' ||
      cs === 'processing' ||
      st === 'scheduled_for_cancellation';
    if (isCancelling) byUid.set(m.uid, m);
  }
  const uids = [...byUid.keys()];

  appendLog(
    job,
    `Restoring cancelled mailboxes — found ${uids.length} candidate(s) on registered domains`,
  );
  saveJob(job);

  if (uids.length) {
    const result = await uncancelMailboxes(workspaceId, uids);
    appendLog(
      job,
      `Uncancel result: ${result.success.length} restored, ${result.failed.length} failed${
        result.failed.length
          ? ` (${result.failed
              .slice(0, 3)
              .map((f) => `${f.uid}:${f.error}`)
              .join('; ')})`
          : ''
      }`,
    );
  } else {
    appendLog(job, 'No cancelled mailboxes found to restore — will still resync from InboxKit');
  }

  // Re-import all seats for registered domains (including restored ones)
  const after = await listMailboxes(workspaceId, { limit: 100 });
  const relevant = after.filter((m) => wanted.has(String(m.domain_name || '').toLowerCase()));
  // Keep restored seats even if still briefly marked cancelling
  const live = relevant.filter((m) => {
    const st = String(m.status || '').toLowerCase();
    return st !== 'cancelled' && st !== 'deleted';
  });

  const plan =
    job.mailboxPlan ||
    planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio);
  mergeMailboxesIntoJob(
    job,
    live.map((m) => ({
      uid: m.uid,
      domain_name: m.domain_name || '',
      first_name: m.first_name || '',
      last_name: m.last_name || '',
      username: m.username || '',
      platform: m.platform || 'GOOGLE',
      status: m.status || 'scheduled',
    })),
    ensurePlanIdentities(plan),
  );

  // Keep whatever InboxKit actually has now (may be 5/domain on current set)
  job.expectedMailboxCount = job.mailboxes.length;
  job.inboxCount = job.mailboxes.length;
  // Future buys still plan at 2/domain via planMailboxes(); this only reflects current inventory.
  appendLog(
    job,
    `Restore sync complete — ${job.mailboxes.length} mailbox(es) tracked across ${job.registeredDomains.length} domain(s)`,
  );
  job.error = undefined;
  if (job.status === 'failed') job.status = 'await_mailboxes';
  return saveJob(job);
}

export async function handleInboxkitWebhook(payload: {
  event?: string;
  data?: {
    mailbox?: {
      uid: string;
      email?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
      status?: string;
      password?: string;
      app_password?: string;
      platform?: string;
      domain_name?: string;
    };
    metadata?: {
      workspace_id?: string;
      domain_name?: string;
    };
  };
}): Promise<void> {
  if (payload.event && payload.event !== 'mailbox.status_changed') {
    console.log(`Ignoring InboxKit event ${payload.event}`);
    return;
  }

  const mailbox = payload.data?.mailbox;
  if (!mailbox?.uid) return;

  const status = (mailbox.status || '').toLowerCase();
  const workspaceId = payload.data?.metadata?.workspace_id;

  // Find job
  let job =
    listAwaiting().find((j) => j.mailboxes.some((m) => m.uid === mailbox.uid)) ||
    (workspaceId
      ? listAwaiting().find((j) => j.inboxkitWorkspaceId === workspaceId)
      : undefined);

  if (!job) {
    // Maybe mailbox uid not yet known — attach by workspace + email/domain
    job = listAwaiting().find((j) => j.inboxkitWorkspaceId && j.inboxkitWorkspaceId === workspaceId);
  }
  if (!job) {
    console.warn(`No waiting job for mailbox ${mailbox.uid}`);
    return;
  }

  let record = job.mailboxes.find((m) => m.uid === mailbox.uid);
  if (!record) {
    record = {
      uid: mailbox.uid,
      email: mailbox.email || `${mailbox.username}@${mailbox.domain_name || payload.data?.metadata?.domain_name}`,
      username: mailbox.username || '',
      firstName: mailbox.first_name || '',
      lastName: mailbox.last_name || '',
      platform: (mailbox.platform as Platform) || 'GOOGLE',
      domain: mailbox.domain_name || payload.data?.metadata?.domain_name || '',
      status,
    };
    job.mailboxes.push(record);
  }

  record.status = status;
  if (mailbox.first_name) record.firstName = mailbox.first_name;
  if (mailbox.last_name) record.lastName = mailbox.last_name;
  if (mailbox.email) record.email = mailbox.email;
  if (mailbox.username) record.username = mailbox.username;
  if (mailbox.password) record.password = mailbox.password;
  if (mailbox.app_password) record.appPassword = mailbox.app_password;
  if (mailbox.platform) record.platform = mailbox.platform as Platform;

  appendLog(job, `Webhook: ${record.email || record.uid} → ${status}`);

  if (status === 'failed') {
    record.error = 'InboxKit reported mailbox provisioning failed';
    saveJob(job);
    await notifyFailure({
      step: 'await_mailboxes',
      clientName: job.brand?.clientName,
      message: record.error,
      mailbox: record.email,
      domain: record.domain,
      jobId: job.id,
    });
    return;
  }

  if (status !== 'active') {
    saveJob(job);
    return;
  }

  // Ensure credentials present
  if ((!record.password && !record.appPassword) && job.inboxkitWorkspaceId) {
    try {
      const creds = await getMailboxCredentials(job.inboxkitWorkspaceId, record.uid);
      record.password = creds.password || record.password;
      record.appPassword = creds.app_password || record.appPassword;
    } catch (err) {
      appendLog(
        job,
        `Could not fetch credentials for ${record.uid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Refresh identity from InboxKit source of truth
  if (job.inboxkitWorkspaceId) {
    try {
      const details = await getMailboxDetails(job.inboxkitWorkspaceId, record.uid);
      if (details.first_name) record.firstName = details.first_name;
      if (details.last_name) record.lastName = details.last_name;
      if (details.username) record.username = details.username;
      if (details.email) record.email = details.email;
      if (details.domain_name) record.domain = details.domain_name;
    } catch {
      // non-fatal
    }
  }

  saveJob(job);

  const activeCount = job.mailboxes.filter((m) => m.status === 'active').length;
  const target = job.expectedMailboxCount || job.mailboxes.length;
  appendLog(job, `Active mailboxes: ${activeCount}/${target}`);
  await maybeRequestSmartleadApproval(job);
}

/** If all expected mailboxes are active, pause for Smartlead load approval. */
async function maybeRequestSmartleadApproval(job: OnboardingJob): Promise<void> {
  if (job.status === 'await_smartlead_load' || job.status === 'load_smartlead') return;
  if (job.status === 'completed' || job.status === 'failed') return;
  if (job.pendingPrompt?.type === 'smartlead_load') return;

  const active = job.mailboxes.filter((m) => m.status === 'active');
  const target = job.expectedMailboxCount || job.mailboxes.length;
  if (!target || active.length < target) return;

  const company = job.companyName || job.brand?.clientName || '';
  const samples = active
    .slice(0, 5)
    .map((m) => buildSignaturePlain(m.firstName, m.lastName, company));
  job.smartleadLoadApprovedAt = undefined;
  job.status = 'await_smartlead_load';
  job.pendingPrompt = {
    type: 'smartlead_load',
    message:
      'Mailboxes are active. Approve loading them into Smartlead with matching signatures and enabling warmup.',
    mailboxCount: active.length,
    sampleSignatures: samples,
  };
  appendLog(job, `All mailboxes active — waiting for Smartlead load approval`);
  saveJob(job);
  try {
    const ref = await notifySmartleadLoadSlack({
      jobId: job.id,
      clientName: job.brand?.clientName || job.companyName || job.websiteUrl,
      companyName: company || 'Company',
      mailboxCount: active.length,
      mailboxes: active.map((m) => ({
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        platform: m.platform,
      })),
    });
    rememberSlackApproval(job, 'smartlead_load', ref);
    appendLog(job, 'Slack Smartlead-approval message sent (with approve button)');
  } catch (err) {
    appendLog(
      job,
      `Slack approval ping failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  saveJob(job);
}

async function stepLoadSmartlead(job: OnboardingJob): Promise<OnboardingJob> {
  appendLog(job, 'Loading active mailboxes into Smartlead');
  saveJob(job);

  // Reconcile accounts already present in Smartlead (e.g. prior partial run)
  try {
    const existing = await listEmailAccounts();
    const byEmail = new Map(
      existing
        .map((a) => {
          const email = String(a.from_email || a.email || '').toLowerCase();
          return email && a.id != null ? ([email, Number(a.id)] as const) : null;
        })
        .filter((x): x is readonly [string, number] => Boolean(x)),
    );
    let linked = 0;
    for (const mailbox of job.mailboxes) {
      if (mailbox.smartleadLoaded && mailbox.smartleadAccountId) continue;
      const id = byEmail.get(mailbox.email.toLowerCase());
      if (!id) continue;
      mailbox.smartleadAccountId = id;
      try {
        await enableWarmup(id);
      } catch {
        // warmup may already be on
      }
      mailbox.smartleadLoaded = true;
      mailbox.error = undefined;
      linked += 1;
    }
    if (linked) {
      appendLog(job, `Linked ${linked} mailbox(es) already present in Smartlead`);
      saveJob(job);
    }
  } catch (err) {
    appendLog(
      job,
      `Smartlead account list skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let failures = 0;
  // Google (and any non-Microsoft) via SMTP / app password
  for (const mailbox of job.mailboxes.filter(
    (m) => m.status === 'active' && m.platform !== 'MICROSOFT',
  )) {
    if (mailbox.smartleadLoaded) continue;
    try {
      if (job.inboxkitWorkspaceId) {
        try {
          const creds = await getMailboxCredentials(job.inboxkitWorkspaceId, mailbox.uid);
          if (creds.password) mailbox.password = creds.password;
          if (creds.app_password) mailbox.appPassword = creds.app_password;
        } catch {
          // continue with whatever we have
        }
      }
      await loadOneMailbox(job, mailbox);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mailbox.error = message;
      failures += 1;
      appendLog(job, `Smartlead load failed for ${mailbox.email}: ${message}`);
      saveJob(job);
    }
  }

  // Microsoft requires OAuth — InboxKit sequencer export (IMAP basic auth is blocked)
  const microsoftPending = job.mailboxes.filter(
    (m) => m.status === 'active' && m.platform === 'MICROSOFT' && !m.smartleadLoaded,
  );
  if (microsoftPending.length && job.inboxkitWorkspaceId) {
    try {
      const sequencerUid = await ensureSmartleadSequencer(job.inboxkitWorkspaceId);
      appendLog(
        job,
        `Exporting ${microsoftPending.length} Microsoft mailbox(es) via InboxKit→Smartlead`,
      );
      saveJob(job);
      const uids = microsoftPending.map((m) => m.uid);
      for (let i = 0; i < uids.length; i += 50) {
        await exportMailboxesToSequencer(
          job.inboxkitWorkspaceId,
          sequencerUid,
          uids.slice(i, i + 50),
        );
      }
      const pendingMs = new Set(uids);
      for (let attempt = 0; attempt < 40 && pendingMs.size; attempt++) {
        await sleep(15_000);
        const statuses = await getSequencerExportStatus(job.inboxkitWorkspaceId, {
          sequencerUid,
          mailboxUids: [...pendingMs],
          limit: 100,
        });
        for (const st of statuses) {
          const uid = st.mailbox_uid;
          if (!uid || !pendingMs.has(uid)) continue;
          const mailbox = microsoftPending.find((m) => m.uid === uid);
          if (!mailbox) continue;
          const status = String(st.status || '').toLowerCase();
          if (status === 'completed' || status === 'success') {
            pendingMs.delete(uid);
            mailbox.error = undefined;
          } else if (status === 'failed' || status === 'errored' || status === 'cancelled') {
            pendingMs.delete(uid);
            mailbox.error = st.error_message || `InboxKit export ${status}`;
            failures += 1;
          }
        }
      }
      const existingAfter = await listEmailAccounts();
      const byEmailAfter = new Map(
        existingAfter
          .map((a) => {
            const email = String(a.from_email || a.email || '').toLowerCase();
            return email && a.id != null ? ([email, Number(a.id)] as const) : null;
          })
          .filter((x): x is readonly [string, number] => Boolean(x)),
      );
      for (const mailbox of microsoftPending) {
        const id = byEmailAfter.get(mailbox.email.toLowerCase());
        if (!id) {
          if (!mailbox.error) {
            mailbox.error = 'Exported but not yet visible in Smartlead';
            failures += 1;
          }
          continue;
        }
        mailbox.smartleadAccountId = id;
        try {
          await enableWarmup(id);
        } catch {
          // already on
        }
        mailbox.smartleadLoaded = true;
        mailbox.error = undefined;
      }
      saveJob(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(job, `Microsoft Smartlead export blocked: ${message}`);
      for (const mailbox of microsoftPending) {
        mailbox.error = message;
        failures += 1;
      }
      saveJob(job);
    }
  }

  const loaded = job.mailboxes.filter((m) => m.smartleadLoaded).length;
  appendLog(job, `Smartlead load progress: ${loaded} loaded, ${failures} failed`);
  if (loaded === 0) {
    throw new Error(`Smartlead load failed for every mailbox (${failures} error(s))`);
  }

  job.status = 'create_smartlead_client';
  return saveJob(job);
}

async function loadOneMailbox(job: OnboardingJob, mailbox: MailboxRecord): Promise<void> {
  // Prefer app password when present (required for many Google Workspace SMTP setups)
  const password = mailbox.appPassword || mailbox.password;
  if (!password) {
    throw new Error(`Missing SMTP/app password for ${mailbox.email}`);
  }

  const fromName = `${mailbox.firstName} ${mailbox.lastName}`.trim() || mailbox.username;
  const company = job.companyName || job.brand?.clientName || '';
  const signature = buildSignaturePlain(mailbox.firstName, mailbox.lastName, company);
  const smtp = smtpDefaultsForPlatform(mailbox.platform);

  const accountId = await addEmailAccount({
    fromName,
    fromEmail: mailbox.email,
    password,
    smtpHost: smtp.smtpHost,
    smtpPort: smtp.smtpPort,
    imapHost: smtp.imapHost,
    imapPort: smtp.imapPort,
    type: smtp.type,
    signature,
    clientId: job.smartleadClientId,
  });

  mailbox.smartleadAccountId = accountId;
  mailbox.error = undefined;
  try {
    await enableWarmup(accountId);
  } catch (err) {
    appendLog(
      job,
      `Warmup enable warning for ${mailbox.email}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  mailbox.smartleadLoaded = true;
  const loadedCount = job.mailboxes.filter((m) => m.smartleadLoaded).length;
  if (loadedCount === 1 || loadedCount % 25 === 0) {
    appendLog(job, `Smartlead load progress: ${loadedCount} account(s) loaded + warmup enabled`);
  }
  saveJob(job);
}

async function stepCreateSmartleadClient(job: OnboardingJob): Promise<OnboardingJob> {
  const clientName = job.brand?.clientName || 'New Client';
  // REGISTRANT_EMAIL is already a Smartlead client (Corey Tapper). Use a unique
  // variant of the Smartlead client login mailbox (default joshosb1996@gmail.com).
  const email = uniqueClientLoginEmail(
    config.smartleadClientEmail(),
    clientName.replace(/\s+/g, '') || job.id,
  );

  appendLog(job, `Creating Smartlead client workspace for ${clientName}`);
  saveJob(job);

  try {
    if (!job.smartleadClientId) {
      const existing = (await listClients()).find(
        (c) => (c.name || '').trim().toLowerCase() === clientName.trim().toLowerCase(),
      );
      if (existing) {
        job.smartleadClientId = existing.id;
        appendLog(job, `Reusing existing Smartlead client id ${existing.id} (${existing.name})`);
      } else {
        job.smartleadClientId = await createClient({ name: clientName, email });
        appendLog(job, `Smartlead client id ${job.smartleadClientId}`);
      }
    }

    let assigned = 0;
    for (const mailbox of job.mailboxes.filter((m) => m.smartleadAccountId)) {
      const company = job.companyName || job.brand?.clientName || '';
      const signature = buildSignaturePlain(mailbox.firstName, mailbox.lastName, company);
      await assignAccountToClient(mailbox.smartleadAccountId!, job.smartleadClientId, signature);
      assigned += 1;
    }
    if (assigned) {
      appendLog(job, `Assigned ${assigned} account(s) → Smartlead client ${job.smartleadClientId}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Agency/client API is plan-gated. Smartlead often returns 500 (or
    // "already exists") rather than 403 — accounts already warm on the main account.
    if (/not authorized|unauthorized|403|401|500|already exist|already been taken|duplicate/i.test(message)) {
      appendLog(
        job,
        `Smartlead client workspace skipped (${message}). Accounts remain under the main Smartlead account with warmup on.`,
      );
    } else {
      throw err;
    }
  }

  job.status = 'notify_complete';
  return saveJob(job);
}

async function stepNotifyComplete(job: OnboardingJob): Promise<OnboardingJob> {
  const count = job.mailboxes.filter((m) => m.smartleadLoaded).length;
  await notifySuccess(job.brand?.clientName || job.websiteUrl, count, job.id);
  job.status = 'completed';
  appendLog(job, `Completed — ${count} inboxes online`);
  return saveJob(job);
}

/**
 * Re-attempt Smartlead load for any active mailboxes not yet warming.
 * Google → SMTP/app password. Microsoft → InboxKit sequencer export (OAuth).
 */
export async function reloadUnloadedToSmartlead(jobId: string): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  if (!job.inboxkitWorkspaceId) {
    throw new Error('Job has no InboxKit workspace');
  }

  appendLog(job, 'Reloading unloaded mailboxes into Smartlead');
  saveJob(job);

  // 1) Link anything already present in Smartlead
  try {
    const existing = await listEmailAccounts();
    const byEmail = new Map(
      existing
        .map((a) => {
          const email = String(a.from_email || a.email || '').toLowerCase();
          return email && a.id != null ? ([email, Number(a.id)] as const) : null;
        })
        .filter((x): x is readonly [string, number] => Boolean(x)),
    );
    let linked = 0;
    for (const mailbox of job.mailboxes) {
      if (mailbox.smartleadLoaded && mailbox.smartleadAccountId) continue;
      const id = byEmail.get(mailbox.email.toLowerCase());
      if (!id) continue;
      mailbox.smartleadAccountId = id;
      try {
        await enableWarmup(id);
      } catch {
        // already on
      }
      mailbox.smartleadLoaded = true;
      mailbox.error = undefined;
      linked += 1;
    }
    if (linked) {
      appendLog(job, `Linked ${linked} mailbox(es) already in Smartlead + warmup on`);
      saveJob(job);
    }
  } catch (err) {
    appendLog(
      job,
      `Smartlead list skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pending = job.mailboxes.filter((m) => m.status === 'active' && !m.smartleadLoaded);
  const googlePending = pending.filter((m) => m.platform === 'GOOGLE');
  const microsoftPending = pending.filter((m) => m.platform === 'MICROSOFT');

  // 2) Google via SMTP / app password
  for (const mailbox of googlePending) {
    try {
      try {
        const creds = await getMailboxCredentials(job.inboxkitWorkspaceId, mailbox.uid);
        if (creds.password) mailbox.password = creds.password;
        if (creds.app_password) mailbox.appPassword = creds.app_password;
      } catch {
        // use cached
      }
      await loadOneMailbox(job, mailbox);
    } catch (err) {
      mailbox.error = err instanceof Error ? err.message : String(err);
      appendLog(job, `Smartlead reload failed for ${mailbox.email}: ${mailbox.error}`);
      saveJob(job);
    }
  }

  // 3) Microsoft via InboxKit→Smartlead export (OAuth; SMTP IMAP basic auth fails)
  if (microsoftPending.length) {
    try {
      const sequencerUid = await ensureSmartleadSequencer(job.inboxkitWorkspaceId);
      appendLog(
        job,
        `Exporting ${microsoftPending.length} Microsoft mailbox(es) via InboxKit→Smartlead`,
      );
      saveJob(job);

      const uids = microsoftPending.map((m) => m.uid);
      for (let i = 0; i < uids.length; i += 50) {
        const chunk = uids.slice(i, i + 50);
        const result = await exportMailboxesToSequencer(
          job.inboxkitWorkspaceId,
          sequencerUid,
          chunk,
        );
        appendLog(
          job,
          `InboxKit export queued: ${result.newExports} new, ${result.duplicates} already linked`,
        );
        saveJob(job);
      }

      // Poll export status up to ~10 minutes
      const pendingMs = new Set(microsoftPending.map((m) => m.uid));
      for (let attempt = 0; attempt < 40 && pendingMs.size; attempt++) {
        await sleep(15_000);
        const statuses = await getSequencerExportStatus(job.inboxkitWorkspaceId, {
          sequencerUid,
          mailboxUids: [...pendingMs],
          limit: 100,
        });
        for (const st of statuses) {
          const uid = st.mailbox_uid;
          if (!uid || !pendingMs.has(uid)) continue;
          const mailbox = microsoftPending.find((m) => m.uid === uid);
          if (!mailbox) continue;
          const status = String(st.status || '').toLowerCase();
          if (status === 'completed' || status === 'success') {
            pendingMs.delete(uid);
            mailbox.error = undefined;
          } else if (status === 'failed' || status === 'errored' || status === 'cancelled') {
            pendingMs.delete(uid);
            mailbox.error = st.error_message || `InboxKit export ${status}`;
          }
        }
      }

      // Reconcile Smartlead IDs + enable warmup for exported accounts
      const existing = await listEmailAccounts();
      const byEmail = new Map(
        existing
          .map((a) => {
            const email = String(a.from_email || a.email || '').toLowerCase();
            return email && a.id != null ? ([email, Number(a.id)] as const) : null;
          })
          .filter((x): x is readonly [string, number] => Boolean(x)),
      );
      for (const mailbox of microsoftPending) {
        const id = byEmail.get(mailbox.email.toLowerCase());
        if (!id) {
          if (!mailbox.error) {
            mailbox.error = 'Exported but not yet visible in Smartlead';
          }
          continue;
        }
        mailbox.smartleadAccountId = id;
        try {
          await enableWarmup(id);
        } catch {
          // already on
        }
        mailbox.smartleadLoaded = true;
        mailbox.error = undefined;
      }
      saveJob(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(job, `Microsoft Smartlead export blocked: ${message}`);
      for (const mailbox of microsoftPending) {
        if (!mailbox.smartleadLoaded) mailbox.error = message;
      }
      saveJob(job);
    }
  }

  const loaded = job.mailboxes.filter((m) => m.smartleadLoaded).length;
  const stillMissing = job.mailboxes.filter(
    (m) => m.status === 'active' && !m.smartleadLoaded,
  ).length;
  appendLog(
    job,
    `Smartlead reload done: ${loaded} warming, ${stillMissing} still missing`,
  );
  job.error = undefined;
  if (!stillMissing && loaded && job.status !== 'completed') {
    // Nothing left to load, so the approval gate has nothing to approve.
    if (job.pendingPrompt?.type === 'smartlead_load') job.pendingPrompt = undefined;
    job.status = 'notify_complete';
  } else if (job.status === 'failed' || job.status === 'load_smartlead') {
    job.status = 'completed';
  }
  return saveJob(job);
}

export async function resumeFailedJob(jobId: string): Promise<OnboardingJob> {
  const job = requireJob(jobId);
  if (job.status !== 'failed') {
    throw new Error(`Job ${jobId} is not failed (status=${job.status})`);
  }
  const step = job.error?.step;
  if (!step || step === 'failed' || step === 'completed') {
    throw new Error(`Job ${jobId} has no resumable failed step`);
  }
  appendLog(
    job,
    `Resuming after failure at ${step}: ${job.error?.message || 'no message'}`,
  );
  job.error = undefined;
  job.status = step;
  saveJob(job);
  void advanceJob(job.id);
  return requireJob(jobId);
}

async function failJob(job: OnboardingJob, step: JobStep, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const domain = (err as { domain?: string })?.domain;
  const mailbox = (err as { mailbox?: string })?.mailbox;
  job.status = 'failed';
  job.error = { step, message, domain, mailbox };
  appendLog(job, `FAILED at ${step}: ${message}`);
  saveJob(job);
  try {
    await notifyFailure({
      step,
      clientName: job.brand?.clientName,
      message,
      domain,
      mailbox,
      jobId: job.id,
    });
  } catch (notifyErr) {
    console.error('Failed to send Slack failure notification', notifyErr);
  }
}

function summarizePlanByDomain(
  plan: Array<{ domain: string; platform: Platform }>,
): Array<{ domain: string; platform: Platform; count: number }> {
  const map = new Map<string, { domain: string; platform: Platform; count: number }>();
  for (const row of plan) {
    const cur = map.get(row.domain);
    if (cur) cur.count += 1;
    else map.set(row.domain, { domain: row.domain, platform: row.platform, count: 1 });
  }
  return [...map.values()];
}

function hasMainPorkbunCredentials(job: OnboardingJob): boolean {
  const apiKey = job.porkbun?.apiKey || config.porkbunApiKey();
  const secretApiKey = job.porkbun?.secretApiKey || config.porkbunSecretApiKey();
  return Boolean(apiKey && secretApiKey);
}

function resolvePorkbun(job: OnboardingJob): PorkbunCredentials {
  const apiKey = job.porkbun?.apiKey || config.porkbunApiKey();
  const secretApiKey = job.porkbun?.secretApiKey || config.porkbunSecretApiKey();
  if (!apiKey || !secretApiKey) {
    throw new Error(
      'Porkbun main-account credentials missing (set PORKBUN_API_KEY and PORKBUN_SECRET_API_KEY)',
    );
  }
  return { apiKey, secretApiKey };
}

function planMailboxes(
  domains: string[],
  inboxCount: number,
  googleRatio: number,
): MailboxPlanSlot[] {
  if (!domains.length) return [];

  // Ops rule: exactly 2 inboxes per domain (InboxKit max is 5; never inflate
  // when fewer domains registered than originally planned).
  const perDomain = INBOXES_PER_DOMAIN;
  void inboxCount; // total is derived from domains × INBOXES_PER_DOMAIN

  const googleDomainCount = Math.max(
    0,
    Math.min(
      domains.length,
      microsoftNeeded(domains.length, googleRatio) === 0
        ? domains.length
        : Math.round(domains.length * googleRatio),
    ),
  );
  // Ensure at least one Microsoft domain when ratio < 1 and we have 2+ domains
  let gCount = googleDomainCount;
  if (googleRatio < 1 && domains.length > 1 && gCount === domains.length) {
    gCount = domains.length - 1;
  }
  if (googleRatio > 0 && domains.length > 1 && gCount === 0) {
    gCount = 1;
  }

  const googleDomains = domains.slice(0, gCount);
  const microsoftDomains = domains.slice(gCount);
  const skeleton: Array<{ domain: string; platform: Platform }> = [];
  for (const d of googleDomains) {
    for (let i = 0; i < perDomain; i++) skeleton.push({ domain: d, platform: 'GOOGLE' });
  }
  for (const d of microsoftDomains) {
    for (let i = 0; i < perDomain; i++) skeleton.push({ domain: d, platform: 'MICROSOFT' });
  }
  return attachIdentities(skeleton);
}

function attachIdentities(
  skeleton: Array<{ domain: string; platform: Platform }>,
): MailboxPlanSlot[] {
  const identities = allocateMailboxIdentities(skeleton.length);
  return skeleton.map((row, i) => {
    const id = identities[i]!;
    return {
      domain: row.domain,
      platform: row.platform,
      firstName: id.first_name,
      lastName: id.last_name,
      username: id.username,
    };
  });
}

/** Keep existing names when present; fill any missing slots uniquely. */
function ensurePlanIdentities(
  plan: Array<{
    domain: string;
    platform: Platform;
    firstName?: string;
    lastName?: string;
    username?: string;
  }>,
): MailboxPlanSlot[] {
  const usedFirst = new Set<string>();
  const usedLast = new Set<string>();
  const usedUser = new Set<string>();
  for (const p of plan) {
    if (p.firstName) usedFirst.add(p.firstName.toLowerCase());
    if (p.lastName) usedLast.add(p.lastName.toLowerCase());
    if (p.username) usedUser.add(p.username.toLowerCase());
  }

  const need = plan.filter((p) => !p.firstName || !p.lastName || !p.username).length;
  // Over-allocate then skip collisions with already-assigned names
  const fresh = allocateMailboxIdentities(Math.max(need * 3, need + 20));
  let fi = 0;

  return plan.map((p) => {
    if (p.firstName && p.lastName && p.username) {
      return {
        domain: p.domain,
        platform: p.platform,
        firstName: p.firstName,
        lastName: p.lastName,
        username: p.username,
      };
    }
    let id = fresh[fi++];
    while (
      id &&
      (usedFirst.has(id.first_name.toLowerCase()) ||
        usedLast.has(id.last_name.toLowerCase()) ||
        usedUser.has(id.username.toLowerCase()))
    ) {
      id = fresh[fi++];
    }
    if (!id) {
      id = allocateMailboxIdentities(1)[0]!;
    }
    usedFirst.add(id.first_name.toLowerCase());
    usedLast.add(id.last_name.toLowerCase());
    usedUser.add(id.username.toLowerCase());
    return {
      domain: p.domain,
      platform: p.platform,
      firstName: p.firstName || id.first_name,
      lastName: p.lastName || id.last_name,
      username: p.username || id.username,
    };
  });
}

function microsoftNeeded(domainCount: number, googleRatio: number): number {
  if (googleRatio >= 1) return 0;
  if (googleRatio <= 0) return domainCount;
  return Math.max(0, domainCount - Math.round(domainCount * googleRatio));
}

function listAwaiting(): OnboardingJob[] {
  return listJobs().filter((j) => j.status === 'await_mailboxes');
}

/** Poll jobs waiting on nameserver propagation (DW-style self-advance). */
export async function pollAwaitingNsJobs(): Promise<void> {
  const jobs = listJobs().filter((j) => j.status === 'await_ns');
  for (const job of jobs) {
    try {
      await advanceJob(job.id);
    } catch (err) {
      console.error(`[ns-poll] job ${job.id}`, err);
    }
  }
}
