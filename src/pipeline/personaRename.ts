import { nanoid } from 'nanoid';
import { getJob } from '../store/jobs.js';
import {
  appendRenameLog,
  getRenameJob,
  listRenameJobs,
  saveRenameJob,
} from '../store/renameJobs.js';
import { allocateNeutralIdentities } from '../lib/mailboxNames.js';
import {
  findPersonaViolations,
  forbiddenPersonaTokens,
  identityUsesForbiddenToken,
} from '../lib/personaGuards.js';
import {
  assertNotPowerGryd,
  capSamples,
  isPowerGrydClientId,
  POWERGRYD_SMARTLEAD_CLIENT_ID,
} from '../lib/standards.js';
import { sleep } from '../lib/http.js';
import {
  changeMailboxUsername,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  getMailboxCredentials,
  listMailboxes,
  updateMailbox,
} from '../vendors/inboxkit.js';
import {
  addEmailAccount,
  buildSignaturePlain,
  enableWarmup,
  listEmailAccounts,
  smtpDefaultsForPlatform,
  updateEmailAccountPersona,
  type SmartleadEmailAccount,
} from '../vendors/smartlead.js';
import {
  dismissSlackApprovalMessage,
  notifyFailure,
  notifyPersonaRenameSlack,
  type SlackMessageRef,
} from '../vendors/slack.js';
import type { Platform } from '../types.js';
import type {
  PersonaRenameItem,
  PersonaRenameJob,
  PersonaRenameSkip,
} from './personaRenameTypes.js';

export type { PersonaRenameItem, PersonaRenameJob, PersonaRenameSkip } from './personaRenameTypes.js';
export { PERSONA_RENAME_SAMPLE_LIMIT } from './personaRenameTypes.js';

type ListedMailbox = Awaited<ReturnType<typeof listMailboxes>>[number];

export interface PersonaRenameVendors {
  listMailboxes: typeof listMailboxes;
  updateMailbox: typeof updateMailbox;
  changeMailboxUsername: typeof changeMailboxUsername;
  getMailboxCredentials: typeof getMailboxCredentials;
  ensureSmartleadSequencer: typeof ensureSmartleadSequencer;
  exportMailboxesToSequencer: typeof exportMailboxesToSequencer;
  listEmailAccounts: typeof listEmailAccounts;
  updateEmailAccountPersona: typeof updateEmailAccountPersona;
  addEmailAccount: typeof addEmailAccount;
  enableWarmup: typeof enableWarmup;
  sleep?: (ms: number) => Promise<void>;
}

const defaultVendors: PersonaRenameVendors = {
  listMailboxes,
  updateMailbox,
  changeMailboxUsername,
  getMailboxCredentials,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  listEmailAccounts,
  updateEmailAccountPersona,
  addEmailAccount,
  enableWarmup,
  sleep,
};

export interface PersonaRenameAssignment {
  uid?: string;
  email?: string;
  firstName: string;
  lastName: string;
  username?: string;
}

export interface StartPersonaRenameInput {
  inboxkitWorkspaceId?: string;
  onboardingJobId?: string;
  companyName?: string;
  clientName?: string;
  staffNames?: string[];
  emails?: string[];
  mailboxUids?: string[];
  assignments?: PersonaRenameAssignment[];
  /** Default true. Live InboxKit/Smartlead writes require approved=true. */
  dryRun?: boolean;
  approved?: boolean | string;
}

function isApprovedFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function asClientId(value: number | string | null | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function isPowerGryd(value: number | string | null | undefined): boolean {
  return isPowerGrydClientId(asClientId(value));
}

function requireRenameJob(id: string): PersonaRenameJob {
  const job = getRenameJob(id);
  if (!job) throw new Error(`Rename job not found: ${id}`);
  return job;
}

function mailboxEmail(row: ListedMailbox): string {
  if (row.email) return String(row.email).toLowerCase();
  const user = String(row.username || '').toLowerCase();
  const domain = String(row.domain_name || '').toLowerCase();
  return user && domain ? `${user}@${domain}` : user;
}

function isCancelledMailbox(row: ListedMailbox): boolean {
  const st = String(row.status || '').toLowerCase();
  const cs = String(row.mailbox_cancellation_status || '').toLowerCase();
  return (
    st.includes('cancel') ||
    st === 'deleted' ||
    cs.includes('cancel') ||
    cs === 'scheduled' ||
    cs === 'processing'
  );
}

function accountEmail(account: SmartleadEmailAccount): string {
  return String(account.from_email || account.email || '').toLowerCase();
}

export function summarizePersonaRename(job: PersonaRenameJob) {
  const samples = capSamples(job.items).map((item) => ({
    email: item.oldEmail,
    from: `${item.oldFirstName} ${item.oldLastName}`.trim(),
    to: `${item.newFirstName} ${item.newLastName}`.trim(),
    newEmail: item.newEmail,
    reasons: item.reasons,
    skipSmartlead: item.skipSmartlead || false,
    skipReason: item.skipReason,
    error: item.error,
  }));
  const skippedSamples = capSamples(job.skipped);
  return {
    id: job.id,
    status: job.status,
    dryRun: job.dryRun,
    inboxkitWorkspaceId: job.inboxkitWorkspaceId,
    onboardingJobId: job.onboardingJobId,
    clientName: job.clientName,
    companyName: job.companyName,
    scannedCount: job.scannedCount,
    renameCount: job.items.length,
    skippedCount: job.skipped.length,
    powergrydSkipped: job.skipped.filter((s) => /powergryd/i.test(s.reason)).length,
    staleSmartleadCount: job.items.filter((i) => i.smartleadEmailStale).length,
    samples,
    skippedSamples,
    approvedAt: job.approvedAt,
    error: job.error,
    updatedAt: job.updatedAt,
  };
}

function resolveWorkspaceId(input: StartPersonaRenameInput): string {
  const fromBody = String(input.inboxkitWorkspaceId || '').trim();
  if (fromBody) return fromBody;
  const onboardingId = String(input.onboardingJobId || '').trim();
  if (onboardingId) {
    const job = getJob(onboardingId);
    if (!job) throw new Error(`Onboarding job not found: ${onboardingId}`);
    if (!job.inboxkitWorkspaceId) {
      throw new Error(`Onboarding job ${onboardingId} has no InboxKit workspace`);
    }
    return job.inboxkitWorkspaceId;
  }
  throw new Error('inboxkitWorkspaceId or onboardingJobId is required');
}

function matchAssignment(
  row: ListedMailbox,
  assignments: PersonaRenameAssignment[],
): PersonaRenameAssignment | undefined {
  const email = mailboxEmail(row);
  return assignments.find((a) => {
    if (a.uid && a.uid === row.uid) return true;
    if (a.email && a.email.trim().toLowerCase() === email) return true;
    return false;
  });
}

export async function buildPersonaRenamePlan(
  input: StartPersonaRenameInput,
  vendors: PersonaRenameVendors = defaultVendors,
): Promise<PersonaRenameJob> {
  const workspaceId = resolveWorkspaceId(input);
  const onboarding = input.onboardingJobId ? getJob(input.onboardingJobId) : null;
  const clientName = (input.clientName || onboarding?.brand?.clientName || '').trim();
  const companyName = (input.companyName || onboarding?.companyName || clientName).trim();
  const forbidden = forbiddenPersonaTokens({
    clientName,
    companyName,
    staffNames: input.staffNames,
  });

  const listed = await vendors.listMailboxes(workspaceId, { limit: 100 });
  let accounts: SmartleadEmailAccount[] = [];
  try {
    accounts = await vendors.listEmailAccounts();
  } catch (err) {
    accounts = [];
    console.log(
      `[rename] Smartlead account list skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const byEmail = new Map<string, SmartleadEmailAccount>();
  for (const account of accounts) {
    const email = accountEmail(account);
    if (email) byEmail.set(email, account);
  }

  const explicitEmails = new Set(
    (input.emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
  );
  const explicitUids = new Set((input.mailboxUids || []).map((u) => String(u).trim()).filter(Boolean));
  const assignments = input.assignments || [];
  const explicit =
    explicitEmails.size > 0 || explicitUids.size > 0 || assignments.length > 0;

  const skipped: PersonaRenameSkip[] = [];
  const selected: ListedMailbox[] = [];

  for (const row of listed) {
    const email = mailboxEmail(row);
    if (isCancelledMailbox(row)) {
      skipped.push({ uid: row.uid, email, reason: 'cancelled_or_scheduled_for_cancellation' });
      continue;
    }
    const sl = byEmail.get(email);
    if (sl && isPowerGryd(sl.client_id)) {
      skipped.push({
        uid: row.uid,
        email,
        reason: `powergryd_smartlead_client_${POWERGRYD_SMARTLEAD_CLIENT_ID}`,
      });
      continue;
    }
    if (explicit) {
      const wanted =
        explicitUids.has(row.uid) ||
        explicitEmails.has(email) ||
        Boolean(matchAssignment(row, assignments));
      if (!wanted) continue;
      selected.push(row);
      continue;
    }
    const violations = findPersonaViolations(
      {
        firstName: row.first_name,
        lastName: row.last_name,
        username: row.username,
        email,
      },
      forbidden,
    );
    if (!violations.length) {
      skipped.push({ uid: row.uid, email, reason: 'already_neutral' });
      continue;
    }
    selected.push(row);
  }

  if (explicit) {
    for (const uid of explicitUids) {
      if (!listed.some((r) => r.uid === uid) && !selected.some((r) => r.uid === uid)) {
        skipped.push({ uid, reason: 'mailbox_not_found' });
      }
    }
    for (const email of explicitEmails) {
      if (!listed.some((r) => mailboxEmail(r) === email) && !selected.some((r) => mailboxEmail(r) === email)) {
        skipped.push({ email, reason: 'mailbox_not_found' });
      }
    }
  }

  const reservedUser = new Set<string>();
  const reservedFirst = new Set<string>();
  const reservedLast = new Set<string>();
  const selectedUids = new Set(selected.map((r) => r.uid));
  for (const row of listed) {
    if (selectedUids.has(row.uid)) continue;
    if (row.username) reservedUser.add(row.username.toLowerCase());
    if (row.first_name) reservedFirst.add(row.first_name.toLowerCase());
    if (row.last_name) reservedLast.add(row.last_name.toLowerCase());
  }

  const generated = allocateNeutralIdentities(selected.length, {
    reservedUsernames: reservedUser,
    reservedFirst,
    reservedLast,
    forbiddenTokens: forbidden,
  });

  const items: PersonaRenameItem[] = selected.map((row, i) => {
    const email = mailboxEmail(row);
    const domain = String(row.domain_name || email.split('@')[1] || '').toLowerCase();
    const assignment = matchAssignment(row, assignments);
    const identity = generated[i]!;
    const firstName = assignment?.firstName?.trim() || identity.first_name;
    const lastName = assignment?.lastName?.trim() || identity.last_name;
    let username = (assignment?.username || identity.username).trim().toLowerCase();
    if (!username || /\d/.test(username) || reservedUser.has(username)) {
      username = identity.username;
    }
    reservedUser.add(username);
    if (identityUsesForbiddenToken({ first_name: firstName, last_name: lastName, username }, forbidden)) {
      throw new Error(
        `Assigned persona for ${email || row.uid} still contains a client/staff name`,
      );
    }
    const violations = findPersonaViolations(
      {
        firstName: row.first_name,
        lastName: row.last_name,
        username: row.username,
        email,
      },
      forbidden,
    );
    const reasons = violations.map((v) =>
      v.reason === 'digits_in_username' ? `${v.field}:digits` : `${v.field}:${v.token}`,
    );
    if (explicit && !reasons.length) reasons.push('explicit_selection');
    const changeUsername = username !== String(row.username || '').toLowerCase();
    const sl = byEmail.get(email);
    return {
      mailboxUid: row.uid,
      workspaceId,
      platform: (String(row.platform || 'GOOGLE').toUpperCase() === 'MICROSOFT'
        ? 'MICROSOFT'
        : 'GOOGLE') as Platform,
      mailboxStatus: String(row.status || 'active'),
      oldEmail: email,
      oldUsername: String(row.username || ''),
      oldFirstName: String(row.first_name || ''),
      oldLastName: String(row.last_name || ''),
      newEmail: domain ? `${username}@${domain}` : username,
      newUsername: username,
      newFirstName: firstName,
      newLastName: lastName,
      reasons,
      changeUsername,
      smartleadAccountId: sl?.id != null ? Number(sl.id) : undefined,
      smartleadClientId: sl?.client_id ?? null,
      skipSmartlead: sl ? isPowerGryd(sl.client_id) : false,
      skipReason: sl && isPowerGryd(sl.client_id) ? 'powergryd' : sl ? undefined : 'not_in_smartlead',
      smartleadEmailStale: changeUsername && Boolean(sl),
    };
  });

  const now = new Date().toISOString();
  const job: PersonaRenameJob = {
    id: nanoid(12),
    createdAt: now,
    updatedAt: now,
    status: 'planned',
    dryRun: true,
    inboxkitWorkspaceId: workspaceId,
    onboardingJobId: input.onboardingJobId?.trim() || undefined,
    companyName,
    clientName,
    forbiddenTokens: forbidden,
    scannedCount: listed.length,
    items,
    skipped,
    logs: [],
  };
  appendRenameLog(
    job,
    `Planned ${items.length} rename(s) from ${listed.length} mailbox(es); skipped ${skipped.length}`,
  );
  return job;
}

export async function startPersonaRename(
  input: StartPersonaRenameInput,
  vendors: PersonaRenameVendors = defaultVendors,
): Promise<PersonaRenameJob> {
  const job = await buildPersonaRenamePlan(input, vendors);
  const dryRun = input.dryRun !== false;
  job.dryRun = dryRun;
  if (dryRun) {
    job.status = 'planned';
    appendRenameLog(job, 'Dry-run only — no InboxKit or Smartlead writes');
    return saveRenameJob(job);
  }
  if (!isApprovedFlag(input.approved)) {
    job.status = 'await_approval';
    appendRenameLog(job, 'Live apply paused — waiting for approved=true');
    saveRenameJob(job);
    await notifyRenameApproval(job);
    return requireRenameJob(job.id);
  }
  saveRenameJob(job);
  return applyPersonaRename(job.id, { approved: true }, vendors);
}

async function notifyRenameApproval(job: PersonaRenameJob): Promise<void> {
  try {
    const ref = await notifyPersonaRenameSlack({
      jobId: job.id,
      clientName: job.clientName || job.companyName || job.inboxkitWorkspaceId,
      renameCount: job.items.length,
      scannedCount: job.scannedCount,
      samples: capSamples(job.items).map((item) => ({
        fromEmail: item.oldEmail,
        toEmail: item.newEmail,
        fromName: `${item.oldFirstName} ${item.oldLastName}`.trim(),
        toName: `${item.newFirstName} ${item.newLastName}`.trim(),
      })),
    });
    if (ref?.ts) {
      const latest = requireRenameJob(job.id);
      latest.slackApprovals = {
        ...(latest.slackApprovals || {}),
        persona_rename: {
          channel: ref.channel,
          ts: ref.ts,
          bodyBlocks: ref.bodyBlocks,
          text: ref.text,
        },
      };
      saveRenameJob(latest);
    }
  } catch (err) {
    appendRenameLog(
      job,
      `Slack approval ping failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    saveRenameJob(job);
  }
}

export async function approvePersonaRename(
  jobId: string,
  extras: Record<string, string> = {},
  messageRef?: SlackMessageRef,
  vendors: PersonaRenameVendors = defaultVendors,
): Promise<PersonaRenameJob> {
  void extras;
  const job = requireRenameJob(jobId);
  const storedRef =
    (job.slackApprovals?.persona_rename as SlackMessageRef | undefined) || messageRef;
  const result = await applyPersonaRename(jobId, { approved: true }, vendors);
  await dismissSlackApprovalMessage(
    storedRef,
    `persona rename for ${job.clientName || job.companyName || jobId}`,
  );
  return result;
}

export async function applyPersonaRename(
  jobId: string,
  answers: { approved?: boolean | string } = {},
  vendors: PersonaRenameVendors = defaultVendors,
): Promise<PersonaRenameJob> {
  if (!isApprovedFlag(answers.approved)) {
    throw new Error(
      'Refusing live persona rename without approved=true (InboxKit + Smartlead writes)',
    );
  }
  const job = requireRenameJob(jobId);
  if (job.status === 'completed') return job;
  if (job.status === 'applying') {
    throw new Error('Rename job is already applying');
  }

  job.dryRun = false;
  job.approvedAt = new Date().toISOString();
  job.status = 'applying';
  job.error = undefined;
  appendRenameLog(job, `Applying ${job.items.length} InboxKit/Smartlead persona update(s)`);
  saveRenameJob(job);

  const wait = vendors.sleep ?? sleep;
  const company = job.companyName || job.clientName || '';
  const microsoftUids: string[] = [];

  try {
    for (const item of job.items) {
      if (isPowerGryd(item.smartleadClientId)) {
        item.skipSmartlead = true;
        item.skipReason = 'powergryd';
        item.error = 'skipped PowerGRYD Smartlead client';
        skippedMutation(item);
        continue;
      }

      try {
        const nameChanged =
          item.oldFirstName !== item.newFirstName || item.oldLastName !== item.newLastName;
        if (nameChanged) {
          await vendors.updateMailbox(item.workspaceId, {
            uid: item.mailboxUid,
            firstName: item.newFirstName,
            lastName: item.newLastName,
          });
          item.inboxkitNameUpdated = true;
        } else {
          item.inboxkitNameUpdated = false;
        }

        if (item.changeUsername) {
          await vendors.changeMailboxUsername(
            item.workspaceId,
            item.mailboxUid,
            item.newUsername,
          );
          item.inboxkitUsernameUpdated = true;
        } else {
          item.inboxkitUsernameUpdated = false;
        }

        if (item.skipSmartlead) {
          appendRenameLog(
            job,
            `InboxKit updated ${item.oldEmail} → ${item.newEmail}; Smartlead skipped (${item.skipReason})`,
          );
        } else if (item.smartleadAccountId) {
          const fromName = `${item.newFirstName} ${item.newLastName}`.trim();
          await vendors.updateEmailAccountPersona(item.smartleadAccountId, {
            fromName,
            signature: buildSignaturePlain(item.newFirstName, item.newLastName, company),
          });
          item.smartleadUpdated = true;
          if (item.changeUsername) item.smartleadEmailStale = true;
        }

        if (item.changeUsername && item.platform === 'MICROSOFT') {
          microsoftUids.push(item.mailboxUid);
        }

        if (
          item.changeUsername &&
          item.platform !== 'MICROSOFT' &&
          item.newEmail &&
          item.newEmail !== item.oldEmail
        ) {
          await addGoogleAccountIfMissing(job, item, vendors);
        }

        item.error = undefined;
      } catch (err) {
        item.error = err instanceof Error ? err.message : String(err);
        appendRenameLog(job, `Rename failed for ${item.oldEmail}: ${item.error}`);
      }
      await wait(400);
    }

    if (microsoftUids.length) {
      try {
        const sequencerUid = await vendors.ensureSmartleadSequencer(job.inboxkitWorkspaceId);
        await vendors.exportMailboxesToSequencer(
          job.inboxkitWorkspaceId,
          sequencerUid,
          microsoftUids,
        );
        for (const item of job.items) {
          if (microsoftUids.includes(item.mailboxUid)) item.microsoftExportQueued = true;
        }
        appendRenameLog(
          job,
          `Queued InboxKit→Smartlead export for ${microsoftUids.length} Microsoft mailbox(es)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        appendRenameLog(job, `Microsoft export after rename failed: ${message}`);
        for (const item of job.items) {
          if (microsoftUids.includes(item.mailboxUid) && !item.error) {
            item.error = `InboxKit export: ${message}`;
          }
        }
      }
    }

    const failures = job.items.filter((i) => i.error).length;
    job.status = failures === job.items.length && job.items.length > 0 ? 'failed' : 'completed';
    if (job.status === 'failed') {
      job.error = { message: `Every rename failed (${failures})` };
    }
    appendRenameLog(
      job,
      `Rename apply finished — ${job.items.length - failures} updated, ${failures} failed`,
    );
    return saveRenameJob(job);
  } catch (err) {
    job.status = 'failed';
    job.error = { message: err instanceof Error ? err.message : String(err) };
    appendRenameLog(job, `Rename apply aborted: ${job.error.message}`);
    saveRenameJob(job);
    await notifyFailure({
      step: 'persona_rename',
      clientName: job.clientName,
      message: job.error.message,
      jobId: job.id,
    }).catch(() => undefined);
    return job;
  }
}

function skippedMutation(item: PersonaRenameItem): void {
  item.inboxkitNameUpdated = false;
  item.inboxkitUsernameUpdated = false;
  item.smartleadUpdated = false;
}

async function addGoogleAccountIfMissing(
  job: PersonaRenameJob,
  item: PersonaRenameItem,
  vendors: PersonaRenameVendors,
): Promise<void> {
  const existing = await vendors.listEmailAccounts();
  const already = existing.some((a) => accountEmail(a) === item.newEmail);
  if (already) {
    item.googleAccountAdded = false;
    return;
  }
  assertNotPowerGryd(asClientId(item.smartleadClientId));
  const creds = await vendors.getMailboxCredentials(item.workspaceId, item.mailboxUid);
  const password = creds.app_password || creds.password;
  if (!password) {
    throw new Error('Missing SMTP/app password for new Smartlead address');
  }
  const smtp = smtpDefaultsForPlatform(item.platform === 'MICROSOFT' ? 'MICROSOFT' : 'GOOGLE');
  const accountId = await vendors.addEmailAccount({
    fromName: `${item.newFirstName} ${item.newLastName}`.trim(),
    fromEmail: item.newEmail,
    password,
    smtpHost: smtp.smtpHost,
    smtpPort: smtp.smtpPort,
    imapHost: smtp.imapHost,
    imapPort: smtp.imapPort,
    type: smtp.type,
    signature: buildSignaturePlain(item.newFirstName, item.newLastName, job.companyName || job.clientName),
    clientId: item.smartleadClientId ?? undefined,
  });
  try {
    await vendors.enableWarmup(accountId);
  } catch {
    // warmup may already be on
  }
  item.googleAccountAdded = true;
  appendRenameLog(job, `Added Smartlead account for new address ${item.newEmail}`);
}

export function listPersonaRenameSummaries() {
  return listRenameJobs().map(summarizePersonaRename);
}

export function getPersonaRenameSummary(id: string) {
  const job = getRenameJob(id);
  if (!job) return null;
  return { ...summarizePersonaRename(job), logs: job.logs.slice(-40) };
}
