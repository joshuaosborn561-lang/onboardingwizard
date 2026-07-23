import { nanoid } from 'nanoid';
import { config, webhookBaseUrl } from '../config.js';
import { appendLog, getJob, listJobs, saveJob } from '../store/jobs.js';
import type {
  DomainCandidate,
  JobStep,
  MailboxRecord,
  OnboardingJob,
  Platform,
} from '../types.js';
import { createEmptyJob } from '../types.js';
import { generateCandidateDomains } from '../vendors/gemini.js';
import {
  buyMailboxesBatched,
  checkNameserverPropagation,
  countNameserversReady,
  createWorkspace,
  getMailboxCredentials,
  getMailboxDetails,
  getNameserversForConnection,
  setDomainForwarding,
  setWorkspaceWebhook,
} from '../vendors/inboxkit.js';
import {
  checkDomainThrottled,
  forwardDomainToMain,
  registerDomain,
  updateNameservers,
  type PorkbunCredentials,
} from '../vendors/porkbun.js';
import { notifyFailure, notifySuccess } from '../vendors/slack.js';
import {
  addEmailAccount,
  assignAccountToClient,
  buildSignaturePlain,
  createClient,
  enableWarmup,
  smtpDefaultsForPlatform,
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
  /** Pause for human approval before spend / Smartlead (default true). */
  manualApproval?: boolean;
}): Promise<OnboardingJob> {
  const websiteUrl = normalizeHttpUrl(input.websiteUrl);
  const forwardToUrl = normalizeHttpUrl(input.forwardToUrl || websiteUrl);
  const companyName = (input.companyName || '').trim();
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
    manualApproval: input.manualApproval !== false,
  });
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
    mailboxPlan?: Array<{ domain: string; platform: Platform }>;
  },
): Promise<OnboardingJob> {
  const job = requireJob(jobId);

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

  if (job.pendingPrompt?.type === 'mailbox_plan') {
    const approved =
      answers.approved === true ||
      answers.approved === 'true' ||
      answers.approved === '1' ||
      answers.approved === 'yes';
    if (answers.mailboxPlan?.length) {
      job.mailboxPlan = answers.mailboxPlan.map((p) => ({
        domain: p.domain,
        platform: p.platform === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE',
      }));
      job.expectedMailboxCount = job.mailboxPlan.length;
    } else if (!approved) {
      throw new Error('Approve the mailbox plan to continue (approved=true)');
    }
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
    const approved =
      answers.approved === true ||
      answers.approved === 'true' ||
      answers.approved === '1' ||
      answers.approved === 'yes';
    if (!approved) throw new Error('Approve Smartlead load to continue (approved=true)');
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
  const brand = await ingestWebsite(job.websiteUrl);
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
  appendLog(job, 'Generating 20 .info candidate domains with Gemini Flash');
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

  const checked: DomainCandidate[] = [];
  for (const candidate of job.candidates) {
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
    } catch (err) {
      checked.push({
        ...candidate,
        available: false,
        error: err instanceof Error ? err.message : String(err),
      });
      appendLog(job, `${candidate.domain}: check failed — ${checked.at(-1)?.error}`);
      await new Promise((r) => setTimeout(r, 10_500));
    }
  }
  job.candidates = checked;

  const available = checked.filter((c) => c.available);
  if (available.length === 0) {
    throw Object.assign(new Error('None of the 20 candidate domains were available on Porkbun'), {
      domain: checked[0]?.domain,
    });
  }

  // Always pause for domain + inbox plan approval before spending.
  const suggestedInboxCount =
    job.inboxCount > 0 ? job.inboxCount : Math.min(available.length, 6);
  job.status = 'await_domain_approval';
  job.pendingPrompt = {
    type: 'domain_approval',
    message:
      'Approve which domains to buy on the main Porkbun account, how many inboxes, and the Google/Microsoft split.',
    availableDomains: available.map((c) => ({
      domain: c.domain,
      costCents: c.costCents,
    })),
    suggestedInboxCount,
    suggestedGoogleRatio: job.googleRatio,
  };
  appendLog(
    job,
    `${available.length} domain(s) available — waiting for your approval before registration`,
  );
  return saveJob(job);
}

async function stepRegisterDomains(job: OnboardingJob): Promise<OnboardingJob> {
  const creds = resolvePorkbun(job);
  const toRegister = job.candidates.filter((c) => c.selected && c.available);
  if (toRegister.length === 0) {
    throw new Error('No domains were approved for registration');
  }

  appendLog(job, `Registering ${toRegister.length} approved domain(s) on Porkbun`);
  saveJob(job);

  const registered: string[] = [];
  for (const c of toRegister) {
    try {
      let cost = c.costCents;
      if (cost == null) {
        const again = await checkDomainThrottled(c.domain, creds);
        cost = again.priceCents;
      }
      if (cost == null) {
        throw new Error('Porkbun did not return a registration cost');
      }
      await registerDomain(c.domain, creds, cost);
      c.registered = true;
      c.costCents = cost;
      registered.push(c.domain);
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
    } catch (err) {
      c.registered = false;
      c.error = err instanceof Error ? err.message : String(err);
      appendLog(job, `Failed to register ${c.domain}: ${c.error}`);
      await notifyFailure({
        step: 'register_domains',
        clientName: job.brand?.clientName,
        message: c.error,
        domain: c.domain,
        jobId: job.id,
      });
    }
  }

  job.registeredDomains = registered;
  if (registered.length === 0) {
    throw new Error('Domain registration failed for every approved domain');
  }

  job.status = 'provision_mailboxes';
  appendLog(job, `Registered ${registered.length} domains; continuing to InboxKit`);
  return saveJob(job);
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

  const plan =
    job.mailboxPlan ||
    planMailboxes(job.registeredDomains, job.inboxCount, job.googleRatio);
  job.mailboxPlan = plan;
  job.expectedMailboxCount = plan.length;

  if (job.manualApproval) {
    const googleCount = plan.filter((p) => p.platform === 'GOOGLE').length;
    const microsoftCount = plan.filter((p) => p.platform === 'MICROSOFT').length;
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
    return saveJob(job);
  }

  job.status = 'buy_mailboxes';
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

  job.expectedMailboxCount = plan.length;
  appendLog(
    job,
    `NS matched — ordering ${plan.length} mailboxes (${plan.filter((p) => p.platform === 'GOOGLE').length} Google / ${plan.filter((p) => p.platform === 'MICROSOFT').length} Microsoft)`,
  );
  saveJob(job);

  const buyRequests = plan.map((p, i) => ({
    domainName: p.domain,
    platform: p.platform,
    seed: i,
  }));

  try {
    const created = await buyMailboxesBatched(workspaceId, buyRequests, {
      useWalletBalance: true,
      gapMs: 1200,
    });
    job.mailboxes = created.map((m) => ({
      uid: m.uid,
      email: `${m.username}@${m.domain_name}`,
      username: m.username,
      firstName: m.first_name,
      lastName: m.last_name,
      platform: (m.platform as Platform) || 'GOOGLE',
      domain: m.domain_name,
      status: m.status || 'scheduled',
    }));
    appendLog(
      job,
      `Mailbox order submitted (${job.mailboxes.length}); waiting for InboxKit webhooks (often 6–8h)`,
    );
  } catch (err) {
    throw Object.assign(new Error(err instanceof Error ? err.message : String(err)), {
      domain: job.registeredDomains[0],
    });
  }

  job.status = 'await_mailboxes';
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

  if (activeCount >= target && target > 0) {
    if (job.manualApproval) {
      const company = job.companyName || job.brand?.clientName || '';
      const samples = job.mailboxes
        .filter((m) => m.status === 'active')
        .slice(0, 5)
        .map((m) => buildSignaturePlain(m.firstName, m.lastName, company));
      job.status = 'await_smartlead_load';
      job.pendingPrompt = {
        type: 'smartlead_load',
        message:
          'Mailboxes are active. Approve loading them into Smartlead with matching signatures and enabling warmup.',
        mailboxCount: activeCount,
        sampleSignatures: samples,
      };
      appendLog(job, `All mailboxes active — waiting for Smartlead load approval`);
      saveJob(job);
      return;
    }
    job.status = 'load_smartlead';
    saveJob(job);
    void advanceJob(job.id);
  }
}

async function stepLoadSmartlead(job: OnboardingJob): Promise<OnboardingJob> {
  appendLog(job, 'Loading active mailboxes into Smartlead');
  saveJob(job);

  for (const mailbox of job.mailboxes.filter((m) => m.status === 'active')) {
    if (mailbox.smartleadLoaded) continue;
    try {
      await loadOneMailbox(job, mailbox);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mailbox.error = message;
      saveJob(job);
      await notifyFailure({
        step: 'load_smartlead',
        clientName: job.brand?.clientName,
        message,
        mailbox: mailbox.email,
        domain: mailbox.domain,
        jobId: job.id,
      });
      throw err;
    }
  }

  job.status = 'create_smartlead_client';
  return saveJob(job);
}

async function loadOneMailbox(job: OnboardingJob, mailbox: MailboxRecord): Promise<void> {
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
  await enableWarmup(accountId);
  mailbox.smartleadLoaded = true;
  appendLog(job, `Smartlead account ${accountId} loaded + warmup enabled for ${mailbox.email}`);
  saveJob(job);
}

async function stepCreateSmartleadClient(job: OnboardingJob): Promise<OnboardingJob> {
  const clientName = job.brand?.clientName || 'New Client';
  const email =
    config.registrant.email() ||
    `client-${job.id}@${new URL(job.websiteUrl).hostname.replace(/^www\./, '')}`;

  appendLog(job, `Creating Smartlead client workspace for ${clientName}`);
  saveJob(job);

  if (!job.smartleadClientId) {
    job.smartleadClientId = await createClient({ name: clientName, email });
    appendLog(job, `Smartlead client id ${job.smartleadClientId}`);
  }

  for (const mailbox of job.mailboxes.filter((m) => m.smartleadAccountId)) {
    const company = job.companyName || job.brand?.clientName || '';
    const signature = buildSignaturePlain(mailbox.firstName, mailbox.lastName, company);
    await assignAccountToClient(mailbox.smartleadAccountId!, job.smartleadClientId, signature);
    appendLog(job, `Assigned ${mailbox.email} → Smartlead client ${job.smartleadClientId}`);
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
): Array<{ domain: string; platform: Platform }> {
  // Default: ~1 mailbox per domain (agencies often want coverage across domains).
  // If inboxCount is provided, distribute across domains (max 5 per domain per InboxKit).
  const total =
    inboxCount > 0 ? inboxCount : Math.max(domains.length, Math.ceil(domains.length * 1));

  const googleTarget = Math.round(total * googleRatio);
  const microsoftTarget = total - googleTarget;

  // Assign platforms to domains (cannot mix platforms on one domain)
  const googleDomainCount = Math.max(
    1,
    Math.min(domains.length - (microsoftTarget > 0 ? 1 : 0), Math.round(domains.length * googleRatio)),
  );
  const googleDomains = domains.slice(0, googleDomainCount);
  const microsoftDomains = domains.slice(googleDomainCount);

  const plan: Array<{ domain: string; platform: Platform }> = [];

  const distribute = (
    domainList: string[],
    platform: Platform,
    count: number,
  ) => {
    if (domainList.length === 0 || count <= 0) return;
    let remaining = count;
    let i = 0;
    while (remaining > 0) {
      const domain = domainList[i % domainList.length];
      const already = plan.filter((p) => p.domain === domain).length;
      if (already < 5) {
        plan.push({ domain, platform });
        remaining--;
      }
      i++;
      if (i > count * 10) break;
    }
  };

  // Prefer at least one mailbox per domain when possible
  if (inboxCount <= 0) {
    for (const d of googleDomains) plan.push({ domain: d, platform: 'GOOGLE' });
    for (const d of microsoftDomains) plan.push({ domain: d, platform: 'MICROSOFT' });
    return plan;
  }

  distribute(googleDomains.length ? googleDomains : domains, 'GOOGLE', googleTarget);
  distribute(
    microsoftDomains.length ? microsoftDomains : domains.slice(Math.floor(domains.length * googleRatio)),
    'MICROSOFT',
    microsoftTarget,
  );

  return plan;
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
