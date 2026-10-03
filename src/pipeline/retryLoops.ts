import { isChicagoBusinessHours } from '../lib/chicagoTime.js';
import { CHICAGO_TIME_ZONE, capSamples, isChicagoWeekday } from '../lib/standards.js';
import {
  classifyExportError,
  nextRetryAt,
  retryCapFor,
} from '../lib/exportErrors.js';
import { listJobs } from '../store/jobs.js';
import {
  loadRetryState,
  saveRetryReport,
  saveRetryState,
  shouldAlert,
  type RetryItem,
  type SweepReportFile,
} from '../store/opsState.js';
import { getSequencerExportStatus } from '../vendors/inboxkit.js';
import { assignAccountToClient, buildSignaturePlain, enableWarmup, listEmailAccounts } from '../vendors/smartlead.js';
import { notifyOpsAlert } from '../vendors/slack.js';
import { normalizeEmail } from './inventoryPlan.js';
import {
  jobsBlockingSmartleadLoad,
  liveVendorDeps,
  resolveDryRun,
  type SweepRunOptions,
} from './inventorySweep.js';
import { buildOpsStatus } from './opsStatus.js';

function slIndex(
  rows: Awaited<ReturnType<typeof listEmailAccounts>>,
): Map<string, { id: number; clientId?: number }> {
  const map = new Map<string, { id: number; clientId?: number }>();
  for (const row of rows) {
    const email = normalizeEmail(String(row.from_email || row.email || ''));
    const id = Number(row.id);
    if (!email || !Number.isFinite(id)) continue;
    map.set(email, {
      id,
      clientId: row.client_id != null ? Number(row.client_id) : undefined,
    });
  }
  return map;
}

function seedNewBuyChases(nowIso: string): RetryItem[] {
  const blocked = jobsBlockingSmartleadLoad();
  const existing = loadRetryState();
  const byKey = new Map(existing.map((item) => [item.key, item]));
  for (const job of listJobs()) {
    const chaseable =
      Boolean(job.smartleadLoadApprovedAt) ||
      job.status === 'load_smartlead' ||
      job.status === 'create_smartlead_client' ||
      job.status === 'notify_complete' ||
      job.status === 'completed' ||
      (job.status === 'failed' && job.error?.step === 'load_smartlead');
    if (!chaseable || !job.inboxkitWorkspaceId) continue;
    for (const mailbox of job.mailboxes) {
      if (mailbox.status !== 'active') continue;
      const email = normalizeEmail(mailbox.email);
      if (!email || blocked.has(email)) continue;
      const needsImport = !mailbox.smartleadLoaded || !mailbox.smartleadAccountId;
      const needsTag = mailbox.smartleadLoaded && job.smartleadClientId && !mailbox.smartleadAccountId;
      if (!needsImport && !needsTag) continue;
      const kind = mailbox.platform === 'MICROSOFT' ? 'microsoft_export' : 'new_buy_chase';
      const key = `${kind}:${job.inboxkitWorkspaceId}:${mailbox.uid}`;
      if (byKey.has(key) && !byKey.get(key)!.done) continue;
      byKey.set(key, {
        key,
        kind,
        workspaceId: job.inboxkitWorkspaceId,
        workspaceName: job.companyName || job.brand?.clientName,
        mailboxUid: mailbox.uid,
        email,
        platform: mailbox.platform,
        smartleadClientId: job.smartleadClientId,
        firstName: mailbox.firstName,
        lastName: mailbox.lastName,
        attempts: byKey.get(key)?.attempts ?? 0,
        maxAttempts: retryCapFor('transient'),
        createdAt: byKey.get(key)?.createdAt ?? nowIso,
        done: false,
      });
    }
  }
  const next = [...byKey.values()];
  saveRetryState(next);
  return next;
}

async function finalizeIfPresent(
  item: RetryItem,
  sl: Map<string, { id: number; clientId?: number }>,
  dryRun: boolean,
): Promise<boolean> {
  const found = sl.get(normalizeEmail(item.email));
  if (!found) return false;
  if (dryRun) return true;
  try {
    await enableWarmup(found.id);
  } catch {
    // already on
  }
  if (item.smartleadClientId != null && found.clientId !== item.smartleadClientId) {
    const signature = buildSignaturePlain(
      item.firstName || '',
      item.lastName || '',
      item.workspaceName || '',
    );
    await assignAccountToClient(found.id, item.smartleadClientId, signature);
  }
  return true;
}

async function attemptItem(
  item: RetryItem,
  sl: Map<string, { id: number; clientId?: number }>,
  dryRun: boolean,
  now: Date,
): Promise<{ item: RetryItem; failure?: string; stuck?: string }> {
  if (await finalizeIfPresent(item, sl, dryRun)) {
    return { item: { ...item, done: true, doneAt: now.toISOString(), lastError: undefined } };
  }

  if (dryRun) {
    return { item };
  }

  const deps = liveVendorDeps();
  try {
    if (item.kind === 'microsoft_export' || item.platform === 'MICROSOFT') {
      await deps.exportMicrosoft({
        type: 'export_microsoft',
        email: item.email,
        uid: item.mailboxUid,
        workspaceId: item.workspaceId,
        workspaceName: item.workspaceName,
        platform: 'MICROSOFT',
        smartleadClientId: item.smartleadClientId,
        firstName: item.firstName,
        lastName: item.lastName,
        reason: 'retry microsoft export',
      });
      const statuses = await getSequencerExportStatus(item.workspaceId, {
        mailboxUids: [item.mailboxUid],
        limit: 20,
      });
      const latest = statuses[0];
      const status = String(latest?.status || '').toLowerCase();
      const err = latest?.error_message || '';
      if (status === 'failed' || status === 'errored' || status === 'cancelled') {
        throw new Error(err || `InboxKit export ${status}`);
      }
      const again = slIndex(await listEmailAccounts());
      if (await finalizeIfPresent(item, again, dryRun)) {
        return { item: { ...item, done: true, doneAt: now.toISOString() } };
      }
      throw new Error(err || 'Exported but not yet visible in Smartlead');
    }

    await deps.importGoogle({
      type: 'import_google',
      email: item.email,
      uid: item.mailboxUid,
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      platform: 'GOOGLE',
      smartleadClientId: item.smartleadClientId,
      firstName: item.firstName,
      lastName: item.lastName,
      reason: 'retry google import / new-buy chase',
    });
    return { item: { ...item, done: true, doneAt: now.toISOString() } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = classifyExportError(message);
    const attempts = item.attempts + 1;
    const maxAttempts = retryCapFor(errorClass);
    const updated: RetryItem = {
      ...item,
      attempts,
      maxAttempts,
      lastError: message,
      errorClass,
      lastAttemptAt: now.toISOString(),
      nextRetryAt: nextRetryAt(attempts, now).toISOString(),
    };
    const capped = attempts >= maxAttempts || errorClass === 'permanent';
    return {
      item: updated,
      failure: `${item.email}: ${message}`,
      stuck: capped ? `${item.email} ${errorClass} after ${attempts} attempt(s)` : undefined,
    };
  }
}

export async function runRetryLoops(opts: SweepRunOptions = {}): Promise<SweepReportFile> {
  const now = opts.now ?? new Date();
  const dryRun = resolveDryRun(opts.dryRun);
  const chicagoNow = now.toLocaleString('en-US', { timeZone: CHICAGO_TIME_ZONE });
  const weekday = isChicagoWeekday(now);
  const counts: Record<string, number> = {
    pending: 0,
    due: 0,
    finalized: 0,
    retried: 0,
    stuck: 0,
    needsDecision: 0,
    failures: 0,
  };
  const samples: Record<string, string[]> = {
    imports: [],
    stuck: [],
    needsDecision: [],
    failures: [],
  };

  const base = (): SweepReportFile => ({
    kind: 'retry',
    at: now.toISOString(),
    dryRun,
    chicago: { now: chicagoNow, weekday },
    counts,
    samples,
  });

  if ((!weekday || !isChicagoBusinessHours(now)) && !(dryRun && opts.ignoreSweepWindow)) {
    const report = { ...base(), skipped: weekday ? 'outside_business_hours' : 'weekend' };
    saveRetryReport(report);
    buildOpsStatus();
    return report;
  }

  const nowIso = now.toISOString();
  let items = seedNewBuyChases(nowIso);
  counts.pending = items.filter((i) => !i.done).length;

  let sl = new Map<string, { id: number; clientId?: number }>();
  try {
    sl = slIndex(await listEmailAccounts());
  } catch (err) {
    const report = {
      ...base(),
      failures: [`Smartlead list failed: ${err instanceof Error ? err.message : String(err)}`],
    };
    report.counts.failures = 1;
    report.samples.failures = capSamples(report.failures || []);
    saveRetryReport(report);
    buildOpsStatus();
    try {
      await notifyOpsAlert({
        title: 'Onboarding retry failed',
        counts: 'Could not list Smartlead accounts',
        samples: report.samples.failures,
      });
    } catch {
      // non-fatal
    }
    return report;
  }

  const due = items.filter((item) => {
    if (item.done) return false;
    if (item.errorClass === 'permanent') return false;
    if (item.attempts >= item.maxAttempts && item.maxAttempts > 0) return false;
    if (!item.nextRetryAt) return true;
    return Date.parse(item.nextRetryAt) <= now.getTime();
  });
  counts.due = due.length;

  const next: RetryItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    if (!due.some((d) => d.key === item.key)) {
      next.push(item);
      if (!item.done && (item.errorClass === 'permanent' || item.attempts >= item.maxAttempts)) {
        counts.stuck += 1;
        samples.stuck.push(`${item.email} ${item.errorClass || 'capped'}`);
      }
      continue;
    }
    const result = await attemptItem(item, sl, dryRun, now);
    next.push(result.item);
    if (result.item.done) {
      counts.finalized += 1;
      samples.imports.push(item.email);
    } else {
      counts.retried += 1;
      if (result.failure) {
        counts.failures += 1;
        samples.failures.push(result.failure);
      }
      if (result.stuck) {
        counts.stuck += 1;
        samples.stuck.push(result.stuck);
      }
    }
  }

  saveRetryState(next);
  samples.imports = capSamples(samples.imports);
  samples.stuck = capSamples(samples.stuck);
  samples.failures = capSamples(samples.failures);
  samples.needsDecision = capSamples(samples.needsDecision);

  const report: SweepReportFile = { ...base() };
  saveRetryReport(report);
  buildOpsStatus();
  if (samples.stuck.length || samples.failures.length || samples.needsDecision.length) {
    if (shouldAlert(`retry:${now.toISOString().slice(0, 10)}:${counts.stuck}:${counts.failures}`)) {
      try {
        await notifyOpsAlert({
          title: dryRun ? 'Onboarding retry needs attention (dry-run)' : 'Onboarding retry needs attention',
          counts: `${counts.stuck} stuck · ${counts.failures} failure(s)`,
          samples: capSamples([...samples.failures, ...samples.stuck, ...samples.needsDecision]),
        });
      } catch (err) {
        console.error('[retry-alert] slack failed', err);
      }
    }
  }
  return report;
}
