import { config } from '../config.js';
import { isChicagoSweepWindow } from '../lib/chicagoTime.js';
import {
  CHICAGO_TIME_ZONE,
  DW_GENERIC_WORKSPACE_NAME,
  assertNotPowerGryd,
  capSamples,
  isChicagoWeekday,
  isPowerGrydClientId,
} from '../lib/standards.js';
import { retryCapFor } from '../lib/exportErrors.js';
import { listJobs } from '../store/jobs.js';
import {
  loadWorkspaceClientMap,
  saveSweepReport,
  saveWorkspaceClientMap,
  setWorkspaceClientBinding,
  shouldAlert,
  upsertCancellationLog,
  upsertRetryItem,
  type RetryItem,
  type SweepReportFile,
  type WorkspaceClientBinding,
} from '../store/opsState.js';
import type { OnboardingJob } from '../types.js';
import {
  deleteMailboxes,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  getMailboxCredentials,
  listAllWorkspaceMailboxes,
  listWorkspaces,
} from '../vendors/inboxkit.js';
import { disableDomainAutoRenew, type PorkbunCredentials } from '../vendors/porkbun.js';
import {
  addEmailAccount,
  assignAccountToClient,
  buildSignaturePlain,
  deleteEmailAccount,
  enableWarmup,
  listClients,
  listEmailAccounts,
  smtpDefaultsForPlatform,
  type SmartleadEmailAccount,
} from '../vendors/smartlead.js';
import { notifyOpsAlert } from '../vendors/slack.js';
import {
  classifyIkLifecycle,
  mailboxEmail,
  namesMatch,
  normalizeEmail,
  planInventoryActions,
  platformOf,
  workspaceMentionsDwGeneric,
  type IkSeat,
  type SlAccount,
  type SweepAction,
  type SweepDecision,
} from './inventoryPlan.js';
import { buildOpsStatus } from './opsStatus.js';

export interface SweepRunOptions {
  dryRun?: boolean;
  now?: Date;
  /** When true, skip the 08:00 Chicago hour check (still weekday-gated). */
  ignoreSweepWindow?: boolean;
  kind?: 'sweep' | 'retry';
}

export interface SweepApplyDeps {
  importGoogle: (action: SweepAction) => Promise<void>;
  exportMicrosoft: (action: SweepAction) => Promise<void>;
  tagClient: (action: SweepAction) => Promise<void>;
  enableWarmup: (action: SweepAction) => Promise<void>;
  deleteIk: (action: SweepAction) => Promise<void>;
  deleteSl: (action: SweepAction) => Promise<void>;
  porkbunAutoRenewOff: (domain: string) => Promise<void>;
}

export function resolveDryRun(requested?: boolean): boolean {
  if (requested === true) return true;
  if (requested === false) {
    const env = process.env.SWEEP_DRY_RUN?.trim().toLowerCase();
    if (env === 'false' || env === '0' || env === 'no') return false;
  }
  return true;
}

export function jobsBlockingSmartleadLoad(jobs: OnboardingJob[] = listJobs()): Set<string> {
  const blocked = new Set<string>();
  for (const job of jobs) {
    const waiting =
      job.pendingPrompt?.type === 'smartlead_load' || job.status === 'await_smartlead_load';
    if (!waiting) continue;
    for (const mailbox of job.mailboxes) {
      if (mailbox.email) blocked.add(normalizeEmail(mailbox.email));
    }
  }
  return blocked;
}

export function mergeWorkspaceClientMap(
  jobs: OnboardingJob[],
  workspaces: Array<{ uid: string; name?: string }>,
  clients: Array<{ id: number; name?: string }>,
): Map<string, number> {
  const persisted = loadWorkspaceClientMap();
  const out = new Map<string, number>();
  const next: Record<string, WorkspaceClientBinding> = { ...persisted };

  for (const [workspaceId, binding] of Object.entries(persisted)) {
    if (isPowerGrydClientId(binding.smartleadClientId)) continue;
    out.set(workspaceId, binding.smartleadClientId);
  }

  for (const job of jobs) {
    const workspaceId = job.inboxkitWorkspaceId?.trim();
    const clientId = job.smartleadClientId;
    if (!workspaceId || clientId == null || !Number.isFinite(clientId)) continue;
    if (isPowerGrydClientId(clientId)) continue;
    out.set(workspaceId, clientId);
    if (!next[workspaceId] || next[workspaceId]!.source === 'name_match') {
      next[workspaceId] = {
        smartleadClientId: clientId,
        name: job.companyName || job.brand?.clientName,
        source: 'job',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  for (const workspace of workspaces) {
    if (out.has(workspace.uid)) continue;
    const client = clients.find((c) => c.name && namesMatch(c.name, workspace.name || ''));
    if (!client || isPowerGrydClientId(client.id)) continue;
    out.set(workspace.uid, client.id);
    next[workspace.uid] = {
      smartleadClientId: client.id,
      name: workspace.name,
      source: 'name_match',
      updatedAt: new Date().toISOString(),
    };
  }

  saveWorkspaceClientMap(next);
  return out;
}

export function seatsFromInboxkit(
  workspace: { uid: string; name?: string },
  rows: Array<{
    uid: string;
    domain_name?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    platform?: string;
    status?: string;
    email?: string;
    mailbox_cancellation_status?: string;
    sequencer_status?: string;
    cancellation_date?: string;
    cancel_at?: string;
  }>,
): IkSeat[] {
  return rows
    .map((row) => {
      const domain = String(row.domain_name || '').toLowerCase();
      const email = mailboxEmail({
        email: row.email,
        username: row.username,
        domain_name: row.domain_name,
      });
      return {
        uid: row.uid,
        email,
        workspaceId: workspace.uid,
        workspaceName: workspace.name || workspace.uid,
        domain,
        platform: platformOf(row.platform),
        status: String(row.status || ''),
        cancellationStatus: row.mailbox_cancellation_status,
        lifecycle: classifyIkLifecycle(row.status, row.mailbox_cancellation_status),
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        username: row.username || '',
        sequencerStatus: row.sequencer_status,
        cancelDate: row.cancellation_date || row.cancel_at,
      };
    })
    .filter((seat) => seat.uid && seat.email);
}

function slAccountsFromVendor(rows: SmartleadEmailAccount[]): SlAccount[] {
  const out: SlAccount[] = [];
  for (const row of rows) {
    const email = normalizeEmail(String(row.from_email || row.email || ''));
    const id = Number(row.id);
    if (!email || !Number.isFinite(id)) continue;
    const warmup = row.warmup_details;
    const warmupEnabled =
      warmup && typeof warmup === 'object'
        ? Boolean(
            (warmup as { warmup_enabled?: unknown; status?: unknown }).warmup_enabled ??
              /active|enabled|true/i.test(String((warmup as { status?: unknown }).status || '')),
          )
        : undefined;
    out.push({
      id,
      email,
      clientId: row.client_id != null ? Number(row.client_id) : undefined,
      warmupEnabled,
    });
  }
  return out;
}

function emptyCounts(): Record<string, number> {
  return {
    workspaces: 0,
    seats: 0,
    activeMissing: 0,
    wouldImportGoogle: 0,
    wouldExportMicrosoft: 0,
    wouldTag: 0,
    wouldWarmup: 0,
    wouldDeleteIk: 0,
    wouldDeleteSl: 0,
    wouldPorkbunOff: 0,
    scheduledLeftAlone: 0,
    skippedPowerGryd: 0,
    alreadyInSync: 0,
    needsDecision: 0,
    failures: 0,
    applied: 0,
  };
}

function sampleOf(action: SweepAction): string {
  return [action.type, action.email || action.domain, action.workspaceName || action.workspaceId]
    .filter(Boolean)
    .join(' ');
}

export async function applySweepActions(
  actions: SweepAction[],
  opts: { dryRun: boolean; deps?: SweepApplyDeps },
): Promise<{ applied: number; failures: string[] }> {
  const failures: string[] = [];
  if (opts.dryRun || !opts.deps) return { applied: 0, failures };
  let applied = 0;
  for (const action of actions) {
    try {
      if (action.smartleadClientId != null) assertNotPowerGryd(action.smartleadClientId);
      switch (action.type) {
        case 'import_google':
          await opts.deps.importGoogle(action);
          break;
        case 'export_microsoft':
          await opts.deps.exportMicrosoft(action);
          break;
        case 'tag_client':
          await opts.deps.tagClient(action);
          break;
        case 'enable_warmup':
          await opts.deps.enableWarmup(action);
          break;
        case 'delete_ik':
          await opts.deps.deleteIk(action);
          break;
        case 'delete_sl':
          await opts.deps.deleteSl(action);
          break;
        case 'porkbun_autorenew_off':
          if (action.domain) await opts.deps.porkbunAutoRenewOff(action.domain);
          break;
        case 'log_cancellation':
          break;
        default:
          break;
      }
      applied += 1;
    } catch (err) {
      failures.push(
        `${action.type} ${action.email || action.domain || ''}: ${
          err instanceof Error ? err.message : String(err)
        }`.trim(),
      );
    }
  }
  return { applied, failures };
}

function persistCancellationLogs(actions: SweepAction[], dryRun: boolean): void {
  const now = new Date().toISOString();
  for (const action of actions) {
    if (!action.email) continue;
    if (action.type === 'log_cancellation') {
      upsertCancellationLog({
        mailboxEmail: action.email,
        domain: action.domain || '',
        clientId: action.smartleadClientId,
        ikStatus: action.logState === 'upcoming' ? 'scheduled_for_cancellation' : 'cancelled',
        workspaceId: action.workspaceId || '',
        workspaceName: action.workspaceName,
        renewalOrCancelDate: action.cancelDate,
        reason: action.reason,
        state: action.logState || 'due',
        updatedAt: now,
      });
      continue;
    }
    if (dryRun) continue;
    if (action.type !== 'delete_ik' && action.type !== 'delete_sl') continue;
    upsertCancellationLog({
      mailboxEmail: action.email,
      domain: action.domain || '',
      clientId: action.smartleadClientId,
      ikStatus: action.type,
      workspaceId: action.workspaceId || '',
      workspaceName: action.workspaceName,
      renewalOrCancelDate: action.cancelDate,
      reason: action.reason,
      state: action.logState || (action.type === 'delete_ik' ? 'deleted_IK' : 'deleted_SL'),
      updatedAt: now,
    });
  }
}

function queueRetryItems(actions: SweepAction[]): void {
  const now = new Date().toISOString();
  for (const action of actions) {
    if (action.type !== 'export_microsoft' && action.type !== 'import_google') continue;
    if (!action.uid || !action.workspaceId || !action.email) continue;
    const kind = action.type === 'export_microsoft' ? 'microsoft_export' : 'new_buy_chase';
    const item: RetryItem = {
      key: `${kind}:${action.workspaceId}:${action.uid}`,
      kind,
      workspaceId: action.workspaceId,
      workspaceName: action.workspaceName,
      mailboxUid: action.uid,
      email: action.email,
      platform: action.platform || (action.type === 'export_microsoft' ? 'MICROSOFT' : 'GOOGLE'),
      smartleadClientId: action.smartleadClientId,
      firstName: action.firstName,
      lastName: action.lastName,
      attempts: 0,
      maxAttempts: retryCapFor('transient'),
      createdAt: now,
    };
    upsertRetryItem(item);
  }
}

function porkbunCreds(): PorkbunCredentials | null {
  const apiKey = config.porkbunApiKey();
  const secretApiKey = config.porkbunSecretApiKey();
  if (!apiKey || !secretApiKey) return null;
  return { apiKey, secretApiKey };
}

export function liveVendorDeps(): SweepApplyDeps {
  return {
    async importGoogle(action) {
      if (!action.workspaceId || !action.uid || !action.email) {
        throw new Error('import_google missing workspace/uid/email');
      }
      if (action.smartleadClientId != null) assertNotPowerGryd(action.smartleadClientId);
      const creds = await getMailboxCredentials(action.workspaceId, action.uid);
      const password = creds.app_password || creds.password;
      if (!password) throw new Error(`Missing SMTP/app password for ${action.email}`);
      const smtp = smtpDefaultsForPlatform('GOOGLE');
      const company = action.workspaceName || '';
      const signature = buildSignaturePlain(action.firstName || '', action.lastName || '', company);
      const id = await addEmailAccount({
        fromName: `${action.firstName || ''} ${action.lastName || ''}`.trim() || action.email,
        fromEmail: action.email,
        password,
        smtpHost: smtp.smtpHost,
        smtpPort: smtp.smtpPort,
        imapHost: smtp.imapHost,
        imapPort: smtp.imapPort,
        type: smtp.type,
        signature,
        clientId: action.smartleadClientId,
      });
      try {
        await enableWarmup(id);
      } catch {
        // already on
      }
      if (action.smartleadClientId != null) {
        await assignAccountToClient(id, action.smartleadClientId, signature);
      }
    },
    async exportMicrosoft(action) {
      if (!action.workspaceId || !action.uid) throw new Error('export_microsoft missing ids');
      const sequencerUid = await ensureSmartleadSequencer(action.workspaceId);
      await exportMailboxesToSequencer(action.workspaceId, sequencerUid, [action.uid]);
    },
    async tagClient(action) {
      if (!action.smartleadAccountId || action.smartleadClientId == null) {
        throw new Error('tag_client missing account/client');
      }
      assertNotPowerGryd(action.smartleadClientId);
      const signature = buildSignaturePlain(
        action.firstName || '',
        action.lastName || '',
        action.workspaceName || '',
      );
      await assignAccountToClient(action.smartleadAccountId, action.smartleadClientId, signature);
    },
    async enableWarmup(action) {
      if (!action.smartleadAccountId) throw new Error('enable_warmup missing account');
      await enableWarmup(action.smartleadAccountId);
    },
    async deleteIk(action) {
      if (!action.workspaceId || !action.uid) throw new Error('delete_ik missing ids');
      await deleteMailboxes(action.workspaceId, [action.uid]);
    },
    async deleteSl(action) {
      if (!action.smartleadAccountId) throw new Error('delete_sl missing account');
      assertNotPowerGryd(action.smartleadClientId);
      await deleteEmailAccount(action.smartleadAccountId, action.smartleadClientId);
    },
    async porkbunAutoRenewOff(domain) {
      const creds = porkbunCreds();
      if (!creds) throw new Error('Porkbun credentials missing — cannot disable auto-renew');
      await disableDomainAutoRenew(domain, creds);
    },
  };
}

async function maybeAlert(report: SweepReportFile): Promise<void> {
  const stuck = report.samples.stuck || [];
  const decisions = report.samples.needsDecision || [];
  const failures = report.samples.failures || report.failures || [];
  if (!stuck.length && !decisions.length && !failures.length) return;
  if (!shouldAlert(`sweep:${report.at.slice(0, 10)}:${failures.length}:${decisions.length}:${stuck.length}`)) {
    return;
  }
  const lines = [
    failures.length ? `${failures.length} failure(s)` : '',
    decisions.length ? `${decisions.length} need a decision` : '',
    stuck.length ? `${stuck.length} stuck` : '',
  ].filter(Boolean);
  try {
    await notifyOpsAlert({
      title: report.dryRun
        ? `Onboarding ${report.kind} needs attention (dry-run)`
        : `Onboarding ${report.kind} needs attention`,
      counts: lines.join(' · '),
      samples: capSamples([...failures, ...decisions, ...stuck]),
    });
  } catch (err) {
    console.error('[ops-alert] slack failed', err);
  }
}

export async function collectInventory(): Promise<{
  workspaces: Array<{ uid: string; name?: string }>;
  seats: IkSeat[];
  slAccounts: SlAccount[];
  workspaceClientId: Map<string, number>;
  dwGenericSeen: boolean;
  clients: Array<{ id: number; name?: string }>;
}> {
  const workspaces = (await listWorkspaces())
    .map((w) => ({ uid: String(w.uid || w.id || ''), name: w.name }))
    .filter((w) => w.uid);
  const dwGenericSeen = workspaces.some((w) => workspaceMentionsDwGeneric(w.name));

  const seats: IkSeat[] = [];
  for (const workspace of workspaces) {
    const rows = await listAllWorkspaceMailboxes(workspace.uid);
    seats.push(...seatsFromInboxkit(workspace, rows));
  }

  const [slRows, clients] = await Promise.all([listEmailAccounts(), listClients()]);
  const slAccounts = slAccountsFromVendor(slRows);
  const workspaceClientId = mergeWorkspaceClientMap(listJobs(), workspaces, clients);
  return { workspaces, seats, slAccounts, workspaceClientId, dwGenericSeen, clients };
}

export async function runInventorySweep(opts: SweepRunOptions = {}): Promise<SweepReportFile> {
  const now = opts.now ?? new Date();
  const dryRun = resolveDryRun(opts.dryRun);
  const kind = opts.kind ?? 'sweep';
  const chicagoNow = now.toLocaleString('en-US', { timeZone: CHICAGO_TIME_ZONE });
  const weekday = isChicagoWeekday(now);
  const counts = emptyCounts();
  const samples: Record<string, string[]> = {
    imports: [],
    cancels: [],
    stuck: [],
    needsDecision: [],
    failures: [],
  };

  const base = (): SweepReportFile => ({
    kind,
    at: now.toISOString(),
    dryRun,
    chicago: { now: chicagoNow, weekday },
    counts,
    samples,
  });

  if (!weekday && !(dryRun && opts.ignoreSweepWindow)) {
    const report = { ...base(), skipped: 'weekend' };
    saveSweepReport(report);
    buildOpsStatus();
    return report;
  }
  if (kind === 'sweep' && !opts.ignoreSweepWindow && !isChicagoSweepWindow(now)) {
    const report = { ...base(), skipped: 'outside_sweep_window' };
    saveSweepReport(report);
    buildOpsStatus();
    return report;
  }

  const inventory = await collectInventory();
  counts.workspaces = inventory.workspaces.length;
  counts.seats = inventory.seats.length;
  if (!inventory.dwGenericSeen) {
    samples.needsDecision.push(`InboxKit workspace "${DW_GENERIC_WORKSPACE_NAME}" not found`);
  }

  const planned = planInventoryActions({
    seats: inventory.seats,
    slAccounts: inventory.slAccounts,
    workspaceClientId: inventory.workspaceClientId,
    blockedEmails: jobsBlockingSmartleadLoad(),
  });

  const importActions = planned.actions.filter(
    (a) => a.type === 'import_google' || a.type === 'export_microsoft',
  );
  counts.activeMissing = importActions.length;
  counts.wouldImportGoogle = planned.actions.filter((a) => a.type === 'import_google').length;
  counts.wouldExportMicrosoft = planned.actions.filter((a) => a.type === 'export_microsoft').length;
  counts.wouldTag = planned.actions.filter((a) => a.type === 'tag_client').length;
  counts.wouldWarmup = planned.actions.filter((a) => a.type === 'enable_warmup').length;
  counts.wouldDeleteIk = planned.actions.filter((a) => a.type === 'delete_ik').length;
  counts.wouldDeleteSl = planned.actions.filter((a) => a.type === 'delete_sl').length;
  counts.wouldPorkbunOff = planned.actions.filter((a) => a.type === 'porkbun_autorenew_off').length;
  counts.scheduledLeftAlone = planned.skipped.filter((s) =>
    s.reason.includes('scheduled_for_cancellation'),
  ).length;
  counts.skippedPowerGryd = planned.skipped.filter((s) => s.reason.includes('PowerGRYD')).length;
  counts.needsDecision = planned.needsDecision.length;
  counts.alreadyInSync = Math.max(
    0,
    inventory.seats.filter((s) => s.lifecycle === 'active').length - counts.activeMissing,
  );

  samples.imports = capSamples(importActions.map(sampleOf));
  samples.cancels = capSamples(
    planned.actions.filter((a) => a.type === 'delete_ik' || a.type === 'delete_sl').map(sampleOf),
  );
  samples.needsDecision = capSamples(
    [
      ...samples.needsDecision,
      ...planned.needsDecision.map((d: SweepDecision) =>
        [d.reason, d.email || d.workspaceName || d.workspaceId].filter(Boolean).join(' — '),
      ),
    ],
  );

  persistCancellationLogs(planned.actions, dryRun);
  queueRetryItems(importActions);

  const apply = await applySweepActions(planned.actions, {
    dryRun,
    deps: dryRun ? undefined : liveVendorDeps(),
  });
  counts.applied = apply.applied;
  counts.failures = apply.failures.length;
  samples.failures = capSamples(apply.failures);

  if (!porkbunCreds() && counts.wouldPorkbunOff > 0) {
    samples.needsDecision = capSamples([
      ...samples.needsDecision,
      'Porkbun credentials missing — cannot disable auto-renew',
    ]);
    counts.needsDecision += 1;
  }

  const report: SweepReportFile = {
    ...base(),
    dwGenericSeen: inventory.dwGenericSeen,
    failures: apply.failures,
  };
  saveSweepReport(report);
  buildOpsStatus();
  await maybeAlert(report);
  return report;
}

export { setWorkspaceClientBinding };
