import { config } from '../config.js';
import {
  extractHealthHandoff,
  isNotFoundError,
  parseDeliverabilityHandoff,
  type DeliverabilityLicenseHandoff,
} from '../lib/deliverabilityCoord.js';
import { isScheduledCancelDue, scheduledCancelDueAt } from '../lib/scheduledCancel.js';
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
  filterUnalertedItems,
  loadWorkspaceClientMap,
  markPorkbunPendingDone,
  pendingPorkbunDomains,
  saveSweepReport,
  saveWorkspaceClientMap,
  setWorkspaceClientBinding,
  shouldSendWeekdayDigest,
  upsertCancellationLog,
  upsertPorkbunPending,
  upsertRetryItem,
  upsertWorkspaceDeleteFlag,
  type RetryItem,
  type SweepReportFile,
  type WorkspaceClientBinding,
} from '../store/opsState.js';
import {
  isMixedWorkspace,
  seedClientNameById,
  seedMappedClientIds,
  seedMixedWorkspaceIds,
  seedWorkspaceById,
} from '../lib/workspaceClientSeed.js';
import type { OnboardingJob } from '../types.js';
import {
  deleteMailboxes,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  getMailboxCredentials,
  getMailboxDetails,
  listAllWorkspaceMailboxes,
  listDomains,
  listWorkspaces,
  removeDomains,
} from '../vendors/inboxkit.js';
import { disableDomainAutoRenew, type PorkbunCredentials } from '../vendors/porkbun.js';
import {
  addEmailAccount,
  assignAccountToClient,
  buildSignaturePlain,
  deleteEmailAccount,
  enableWarmup,
  getEmailAccount,
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
  resolveSeatOwnership,
  workspaceMentionsDwGeneric,
  type IkSeat,
  type SlAccount,
  type SweepAction,
  type SweepDecision,
} from './inventoryPlan.js';
import { syncSeatLedger } from './seatLedger.js';
import { buildOpsStatus } from './opsStatus.js';
import { ledgerByEmail, ledgerProviderOf, loadSeatLedger } from '../store/seatLedger.js';
import { getEmailAccountCampaignLinks } from '../vendors/smartlead.js';

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
  removeIkDomain: (action: SweepAction) => Promise<void>;
  flagWorkspaceDelete: (action: SweepAction) => Promise<void>;
  /** Re-check before delete. False = already gone — skip with no error. */
  ikMailboxExists?: (action: SweepAction) => Promise<boolean>;
  slAccountExists?: (action: SweepAction) => Promise<boolean>;
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

export interface WorkspaceClientResolution {
  workspaceClientId: Map<string, number>;
  mixedWorkspaceIds: Set<string>;
  clientNameById: Map<number, string>;
}

export function mergeWorkspaceClientMap(
  jobs: OnboardingJob[],
  workspaces: Array<{ uid: string; name?: string }>,
  clients: Array<{ id: number; name?: string }>,
  opts: { persist?: boolean } = {},
): Map<string, number> {
  return resolveWorkspaceClients(jobs, workspaces, clients, opts).workspaceClientId;
}

export function resolveWorkspaceClients(
  jobs: OnboardingJob[],
  workspaces: Array<{ uid: string; name?: string }>,
  clients: Array<{ id: number; name?: string }>,
  opts: { persist?: boolean } = {},
): WorkspaceClientResolution {
  const persisted = loadWorkspaceClientMap();
  const out = new Map<string, number>();
  const next: Record<string, WorkspaceClientBinding> = { ...persisted };
  const mixedWorkspaceIds = seedMixedWorkspaceIds();
  const clientNameById = seedClientNameById();
  const seedById = seedWorkspaceById();

  for (const [workspaceId, clientId] of seedMappedClientIds()) {
    if (isPowerGrydClientId(clientId) || mixedWorkspaceIds.has(workspaceId)) continue;
    out.set(workspaceId, clientId);
    const seed = seedById.get(workspaceId);
    if (seed?.smartleadClientName) clientNameById.set(clientId, seed.smartleadClientName);
    if (!next[workspaceId] || next[workspaceId]!.source === 'name_match') {
      next[workspaceId] = {
        smartleadClientId: clientId,
        name: seed?.smartleadClientName || seed?.inboxkitWorkspaceName,
        source: 'seed',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  for (const [workspaceId, binding] of Object.entries(persisted)) {
    if (isPowerGrydClientId(binding.smartleadClientId)) continue;
    if (mixedWorkspaceIds.has(workspaceId) || isMixedWorkspace(workspaceId, binding.name)) {
      delete next[workspaceId];
      out.delete(workspaceId);
      continue;
    }
    out.set(workspaceId, binding.smartleadClientId);
    if (binding.name) clientNameById.set(binding.smartleadClientId, binding.name);
  }

  for (const job of jobs) {
    const workspaceId = job.inboxkitWorkspaceId?.trim();
    const clientId = job.smartleadClientId;
    if (!workspaceId || clientId == null || !Number.isFinite(clientId)) continue;
    if (isPowerGrydClientId(clientId)) continue;
    if (mixedWorkspaceIds.has(workspaceId) || isMixedWorkspace(workspaceId, job.companyName)) continue;
    out.set(workspaceId, clientId);
    const clientName = job.companyName || job.brand?.clientName;
    if (clientName) clientNameById.set(clientId, clientName);
    if (!next[workspaceId] || next[workspaceId]!.source === 'name_match') {
      next[workspaceId] = {
        smartleadClientId: clientId,
        name: clientName,
        source: 'job',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  for (const workspace of workspaces) {
    if (out.has(workspace.uid)) continue;
    if (seedById.has(workspace.uid)) continue;
    if (mixedWorkspaceIds.has(workspace.uid) || isMixedWorkspace(workspace.uid, workspace.name)) {
      continue;
    }
    const client = clients.find((c) => c.name && namesMatch(c.name, workspace.name || ''));
    if (!client || isPowerGrydClientId(client.id)) continue;
    out.set(workspace.uid, client.id);
    if (client.name) clientNameById.set(client.id, client.name);
    next[workspace.uid] = {
      smartleadClientId: client.id,
      name: client.name,
      source: 'name_match',
      updatedAt: new Date().toISOString(),
    };
  }

  if (opts.persist !== false) {
    saveWorkspaceClientMap(next);
  }
  return { workspaceClientId: out, mixedWorkspaceIds, clientNameById };
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
    renewal_date?: string;
    prepaid_until?: string;
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
        provider: ledgerProviderOf(row.platform),
        status: String(row.status || ''),
        cancellationStatus: row.mailbox_cancellation_status,
        lifecycle: classifyIkLifecycle(row.status, row.mailbox_cancellation_status),
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        username: row.username || '',
        sequencerStatus: row.sequencer_status,
        cancelDate: row.renewal_date || row.prepaid_until || row.cancellation_date || row.cancel_at,
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
    wouldRemoveIkDomain: 0,
    wouldFlagWorkspace: 0,
    wouldLapse: 0,
    alreadyGone: 0,
    skippedDeliverability: 0,
    skippedReserved: 0,
    scheduledDue: 0,
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
          if (opts.deps.ikMailboxExists && !(await opts.deps.ikMailboxExists(action))) {
            break;
          }
          await opts.deps.deleteIk(action);
          break;
        case 'delete_sl':
          if (opts.deps.slAccountExists && !(await opts.deps.slAccountExists(action))) {
            break;
          }
          await opts.deps.deleteSl(action);
          break;
        case 'porkbun_autorenew_off':
          if (action.domain) {
            try {
              await opts.deps.porkbunAutoRenewOff(action.domain);
              markPorkbunPendingDone(action.domain);
            } catch (err) {
              upsertPorkbunPending(
                action.domain,
                action.reason,
                err instanceof Error ? err.message : String(err),
              );
              throw err;
            }
          }
          break;
        case 'remove_ik_domain':
          await opts.deps.removeIkDomain(action);
          break;
        case 'flag_workspace_delete':
          await opts.deps.flagWorkspaceDelete(action);
          break;
        case 'lapse_handoff':
        case 'mark_deleted':
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
  if (dryRun) return;
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
    if (
      action.type !== 'delete_ik' &&
      action.type !== 'delete_sl' &&
      action.type !== 'lapse_handoff' &&
      action.type !== 'mark_deleted'
    ) {
      continue;
    }
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

function queueRetryItems(actions: SweepAction[], dryRun: boolean): void {
  if (dryRun) return;
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
      smartleadClientId:
        action.ledgerClient === 'generic' ? undefined : action.smartleadClientId,
      firstName: action.firstName,
      lastName: action.lastName,
      attempts: 0,
      maxAttempts: retryCapFor('transient'),
      createdAt: now,
    };
    upsertRetryItem(item);
  }
}

function signatureCompany(action: SweepAction): string {
  if (action.clientName?.trim()) return action.clientName.trim();
  if (action.smartleadClientId != null) {
    const mapped = seedClientNameById().get(action.smartleadClientId);
    if (mapped) return mapped;
  }
  return '';
}

function persistPorkbunPending(actions: SweepAction[], dryRun: boolean): void {
  if (dryRun) return;
  for (const action of actions) {
    if (action.type !== 'porkbun_autorenew_off' || !action.domain) continue;
    upsertPorkbunPending(action.domain, action.reason);
  }
}

function seatNeedsCampaignCheck(
  seat: IkSeat,
  now: Date,
  ledger: ReturnType<typeof ledgerByEmail>,
): boolean {
  if (seat.lifecycle === 'cancelled') return true;
  if (seat.lifecycle !== 'scheduled_for_cancellation') return false;
  const existing = ledger.get(normalizeEmail(seat.email));
  const dueAt = scheduledCancelDueAt(
    seat.cancelDate || existing?.scheduled_cancel_at || existing?.renewal_date,
    existing?.scheduled_cancel_due_at,
  );
  return isScheduledCancelDue(dueAt, now);
}

async function campaignLinksForCleanup(
  seats: IkSeat[],
  slAccounts: SlAccount[],
  now: Date,
): Promise<Map<number, { linked: boolean; unknown: boolean }>> {
  const map = new Map<number, { linked: boolean; unknown: boolean }>();
  const ledger = ledgerByEmail(loadSeatLedger());
  const slByEmail = new Map<string, SlAccount[]>();
  for (const account of slAccounts) {
    const email = normalizeEmail(account.email);
    const list = slByEmail.get(email) ?? [];
    list.push(account);
    slByEmail.set(email, list);
  }
  for (const seat of seats) {
    if (!seatNeedsCampaignCheck(seat, now, ledger)) continue;
    for (const account of slByEmail.get(normalizeEmail(seat.email)) ?? []) {
      if (map.has(account.id)) continue;
      try {
        map.set(account.id, await getEmailAccountCampaignLinks(account.id));
      } catch {
        map.set(account.id, { linked: true, unknown: true });
      }
    }
  }
  return map;
}

function ownershipMapFor(
  seats: IkSeat[],
  slAccounts: SlAccount[],
  workspaceClientId: Map<string, number>,
  mixedWorkspaceIds: Set<string>,
): Map<string, ReturnType<typeof resolveSeatOwnership>> {
  const slByEmail = new Map<string, SlAccount[]>();
  for (const account of slAccounts) {
    const email = normalizeEmail(account.email);
    const list = slByEmail.get(email) ?? [];
    list.push(account);
    slByEmail.set(email, list);
  }
  const ledger = ledgerByEmail();
  const out = new Map<string, ReturnType<typeof resolveSeatOwnership>>();
  for (const seat of seats) {
    const email = normalizeEmail(seat.email);
    const mixedWorkspace =
      mixedWorkspaceIds.has(seat.workspaceId) || workspaceMentionsDwGeneric(seat.workspaceName);
    out.set(
      email,
      resolveSeatOwnership({
        seat,
        matches: slByEmail.get(email) ?? [],
        mappedClient: mixedWorkspace ? undefined : workspaceClientId.get(seat.workspaceId),
        mixedWorkspace,
        existing: ledger.get(email),
      }),
    );
  }
  return out;
}

function mergePendingPorkbun(actions: SweepAction[]): SweepAction[] {
  const have = new Set(
    actions
      .filter((a) => a.type === 'porkbun_autorenew_off' && a.domain)
      .map((a) => a.domain!.toLowerCase()),
  );
  const extra: SweepAction[] = [];
  for (const pending of pendingPorkbunDomains()) {
    if (have.has(pending.domain.toLowerCase())) continue;
    extra.push({
      type: 'porkbun_autorenew_off',
      domain: pending.domain,
      reason: pending.reason || 'Retry Porkbun auto-renew off',
    });
  }
  return extra.length ? [...actions, ...extra] : actions;
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
      const company = signatureCompany(action);
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
        clientId: action.ledgerClient === 'generic' ? undefined : action.smartleadClientId,
        tags: action.slTags,
      });
      try {
        await enableWarmup(id);
      } catch {
        // already on
      }
      if (action.ledgerClient !== 'generic' && action.smartleadClientId != null) {
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
        signatureCompany(action),
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
    async ikMailboxExists(action) {
      if (!action.workspaceId || !action.uid) return false;
      try {
        const row = await getMailboxDetails(action.workspaceId, action.uid);
        return Boolean(row?.uid);
      } catch (err) {
        if (isNotFoundError(err)) return false;
        throw err;
      }
    },
    async slAccountExists(action) {
      if (!action.smartleadAccountId) return false;
      try {
        const row = await getEmailAccount(action.smartleadAccountId);
        return Number.isFinite(Number(row?.id ?? action.smartleadAccountId));
      } catch (err) {
        if (isNotFoundError(err)) return false;
        throw err;
      }
    },
    async porkbunAutoRenewOff(domain) {
      const creds = porkbunCreds();
      if (!creds) throw new Error('Porkbun credentials missing — cannot disable auto-renew');
      await disableDomainAutoRenew(domain, creds);
    },
    async removeIkDomain(action) {
      if (!action.workspaceId || !action.domain) throw new Error('remove_ik_domain missing ids');
      await removeDomains(action.workspaceId, [action.domain]);
    },
    async flagWorkspaceDelete(action) {
      if (!action.workspaceId) throw new Error('flag_workspace_delete missing workspace');
      upsertWorkspaceDeleteFlag({
        workspaceId: action.workspaceId,
        workspaceName: action.workspaceName,
        reason: action.reason,
      });
    },
  };
}

async function maybeAlert(report: SweepReportFile, now: Date): Promise<void> {
  if (report.dryRun) return;
  if (!report.chicago.weekday) return;
  const stuck = report.samples.stuck || [];
  const decisions = report.samples.needsDecision || [];
  const failures = report.samples.failures || report.failures || [];
  if (!stuck.length && !decisions.length && !failures.length) return;
  if (!shouldSendWeekdayDigest('sweep', now)) return;
  const fresh = filterUnalertedItems([...failures, ...decisions, ...stuck], now);
  if (!fresh.length) return;
  const lines = [
    failures.length ? `${failures.length} failure(s)` : '',
    decisions.length ? `${decisions.length} need a decision` : '',
    stuck.length ? `${stuck.length} stuck` : '',
  ].filter(Boolean);
  try {
    await notifyOpsAlert({
      title: `Onboarding ${report.kind} needs attention`,
      counts: lines.join(' · '),
      samples: capSamples(fresh),
    });
  } catch (err) {
    console.error('[ops-alert] slack failed', err);
  }
}

export async function loadDeliverabilityHandoff(
  fetchImpl: typeof fetch = fetch,
): Promise<DeliverabilityLicenseHandoff | null> {
  const url = config.deliverabilityHealthUrl();
  if (!url) return null;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    return parseDeliverabilityHandoff(extractHealthHandoff(body));
  } catch {
    return null;
  }
}

export async function collectInventory(opts: { persistMap?: boolean } = {}): Promise<{
  workspaces: Array<{ uid: string; name?: string }>;
  seats: IkSeat[];
  slAccounts: SlAccount[];
  workspaceClientId: Map<string, number>;
  mixedWorkspaceIds: Set<string>;
  clientNameById: Map<number, string>;
  workspaceDomains: Map<string, string[]>;
  dwGenericSeen: boolean;
  clients: Array<{ id: number; name?: string }>;
}> {
  const workspaces = (await listWorkspaces())
    .map((w) => ({ uid: String(w.uid || w.id || ''), name: w.name }))
    .filter((w) => w.uid);
  const dwGenericSeen = workspaces.some((w) => workspaceMentionsDwGeneric(w.name));

  const seats: IkSeat[] = [];
  const workspaceDomains = new Map<string, string[]>();
  for (const workspace of workspaces) {
    const rows = await listAllWorkspaceMailboxes(workspace.uid);
    seats.push(...seatsFromInboxkit(workspace, rows));
    try {
      const listed = await listDomains(workspace.uid, { limit: 200 });
      workspaceDomains.set(
        workspace.uid,
        listed
          .map((d) => String(d.domain || d.name || '').toLowerCase())
          .filter(Boolean),
      );
    } catch {
      const inferred = [
        ...new Set(
          seats
            .filter((s) => s.workspaceId === workspace.uid && s.domain)
            .map((s) => s.domain.toLowerCase()),
        ),
      ];
      workspaceDomains.set(workspace.uid, inferred);
    }
  }

  const [slRows, clients] = await Promise.all([listEmailAccounts(), listClients()]);
  const slAccounts = slAccountsFromVendor(slRows);
  const resolved = resolveWorkspaceClients(listJobs(), workspaces, clients, {
    persist: opts.persistMap === true,
  });
  return {
    workspaces,
    seats,
    slAccounts,
    workspaceClientId: resolved.workspaceClientId,
    mixedWorkspaceIds: resolved.mixedWorkspaceIds,
    clientNameById: resolved.clientNameById,
    workspaceDomains,
    dwGenericSeen,
    clients,
  };
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

  if (!weekday) {
    const report = { ...base(), skipped: 'weekend' };
    if (!dryRun) saveSweepReport(report);
    buildOpsStatus();
    return report;
  }
  if (kind === 'sweep' && !opts.ignoreSweepWindow && !isChicagoSweepWindow(now)) {
    const report = { ...base(), skipped: 'outside_sweep_window' };
    saveSweepReport(report);
    buildOpsStatus();
    return report;
  }

  const inventory = await collectInventory({ persistMap: !dryRun });
  counts.workspaces = inventory.workspaces.length;
  counts.seats = inventory.seats.length;
  if (!inventory.dwGenericSeen) {
    samples.needsDecision.push(`InboxKit workspace "${DW_GENERIC_WORKSPACE_NAME}" not found`);
  }

  const campaignLinks = await campaignLinksForCleanup(
    inventory.seats,
    inventory.slAccounts,
    now,
  );
  const deliverabilityHandoff = await loadDeliverabilityHandoff();
  const planned = planInventoryActions({
    seats: inventory.seats,
    slAccounts: inventory.slAccounts,
    workspaceClientId: inventory.workspaceClientId,
    mixedWorkspaceIds: inventory.mixedWorkspaceIds,
    clientNameById: inventory.clientNameById,
    blockedEmails: jobsBlockingSmartleadLoad(),
    ledgerByEmail: ledgerByEmail(loadSeatLedger()),
    campaignLinksByAccountId: campaignLinks,
    now,
    workspaceDomains: inventory.workspaceDomains,
    deliverabilityHandoff,
  });
  planned.actions = mergePendingPorkbun(planned.actions);

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
  counts.wouldRemoveIkDomain = planned.actions.filter((a) => a.type === 'remove_ik_domain').length;
  counts.wouldFlagWorkspace = planned.actions.filter((a) => a.type === 'flag_workspace_delete').length;
  counts.wouldLapse = planned.actions.filter((a) => a.type === 'lapse_handoff').length;
  counts.alreadyGone = planned.actions.filter((a) => a.type === 'mark_deleted').length;
  counts.skippedDeliverability = planned.skipped.filter((s) =>
    s.reason.includes('Deliverability #275'),
  ).length;
  counts.skippedReserved = planned.skipped.filter((s) =>
    s.reason.includes('reserved: Gabe Lopez'),
  ).length;
  counts.scheduledDue = planned.actions.filter(
    (a) => a.type === 'log_cancellation' && a.logState === 'due',
  ).length;
  counts.scheduledLeftAlone = planned.skipped.filter((s) =>
    s.reason.includes('scheduled_for_cancellation left alone'),
  ).length;
  counts.skippedPowerGryd = planned.skipped.filter((s) => s.reason.includes('PowerGRYD')).length;
  counts.needsDecision = planned.needsDecision.length;
  counts.alreadyInSync = Math.max(
    0,
    inventory.seats.filter((s) => s.lifecycle === 'active').length - counts.activeMissing,
  );

  samples.imports = capSamples(importActions.map(sampleOf));
  samples.cancels = capSamples(
    planned.actions
      .filter(
        (a) =>
          a.type === 'delete_ik' ||
          a.type === 'delete_sl' ||
          a.type === 'remove_ik_domain' ||
          a.type === 'lapse_handoff',
      )
      .map(sampleOf),
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
  persistPorkbunPending(planned.actions, dryRun);
  queueRetryItems(importActions, dryRun);
  syncSeatLedger({
    seats: inventory.seats,
    slAccounts: inventory.slAccounts,
    ownershipByEmail: ownershipMapFor(
      inventory.seats,
      inventory.slAccounts,
      inventory.workspaceClientId,
      inventory.mixedWorkspaceIds,
    ),
    actions: planned.actions,
    now,
    persist: !dryRun,
  });

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
  await maybeAlert(report, now);
  return report;
}

export { setWorkspaceClientBinding };
