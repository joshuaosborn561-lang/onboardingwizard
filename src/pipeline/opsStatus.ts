import { capSamples, CHICAGO_TIME_ZONE, isChicagoWeekday } from '../lib/standards.js';
import { listJobs } from '../store/jobs.js';
import {
  loadCancellationLog,
  loadLastRetry,
  loadLastSweep,
  loadRetryState,
  loadStatusSnapshot,
  saveStatusSnapshot,
} from '../store/opsState.js';

export interface StatusSample {
  kind: 'approval' | 'failed' | 'stuck' | 'decision';
  id?: string;
  detail: string;
}

export interface CompactOpsStatus {
  ok: true;
  at: string;
  chicago: { now: string; weekday: boolean };
  dryRunDefault: boolean;
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    pendingApprovals: number;
    failed: number;
    samples: StatusSample[];
  };
  lastSweep: {
    at?: string;
    dryRun?: boolean;
    skipped?: string;
    counts: Record<string, number>;
    samples: Record<string, string[]>;
  } | null;
  lastRetry: {
    at?: string;
    dryRun?: boolean;
    skipped?: string;
    counts: Record<string, number>;
    samples: Record<string, string[]>;
  } | null;
  stuck: StatusSample[];
  needsDecision: StatusSample[];
  cancellationLog: { total: number; byState: Record<string, number> };
}

function dryRunDefault(): boolean {
  const env = process.env.SWEEP_DRY_RUN?.trim().toLowerCase();
  return !(env === 'false' || env === '0' || env === 'no');
}

export function buildOpsStatus(now = new Date()): CompactOpsStatus {
  const jobs = listJobs();
  const byStatus: Record<string, number> = {};
  const jobSamples: StatusSample[] = [];
  let pendingApprovals = 0;
  let failed = 0;
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    if (job.pendingPrompt) {
      pendingApprovals += 1;
      jobSamples.push({
        kind: 'approval',
        id: job.id,
        detail: `${job.status} · ${job.pendingPrompt.type} · ${job.companyName || job.websiteUrl}`,
      });
    }
    if (job.status === 'failed') {
      failed += 1;
      jobSamples.push({
        kind: 'failed',
        id: job.id,
        detail: `${job.error?.step || 'failed'}: ${job.error?.message || 'no message'}`,
      });
    }
  }

  const lastSweep = loadLastSweep();
  const lastRetry = loadLastRetry();
  const retryItems = loadRetryState().filter((item) => !item.done);
  const stuck: StatusSample[] = retryItems
    .filter(
      (item) =>
        item.errorClass === 'permanent' ||
        (item.attempts >= item.maxAttempts && item.maxAttempts > 0),
    )
    .map((item) => ({
      kind: 'stuck' as const,
      id: item.email,
      detail: `${item.kind} ${item.email} · ${item.errorClass || 'unknown'} · ${item.lastError || 'capped'}`,
    }));

  const needsDecision: StatusSample[] = [];
  for (const sample of lastSweep?.samples.needsDecision || []) {
    needsDecision.push({ kind: 'decision', detail: sample });
  }
  for (const sample of lastRetry?.samples.needsDecision || []) {
    needsDecision.push({ kind: 'decision', detail: sample });
  }
  for (const job of jobs) {
    if (job.pendingPrompt) {
      needsDecision.push({
        kind: 'decision',
        id: job.id,
        detail: `Job ${job.id} waiting on ${job.pendingPrompt.type}`,
      });
    }
  }

  const log = loadCancellationLog();
  const byState: Record<string, number> = {};
  for (const row of log) {
    byState[row.state] = (byState[row.state] || 0) + 1;
  }

  const status: CompactOpsStatus = {
    ok: true,
    at: now.toISOString(),
    chicago: {
      now: now.toLocaleString('en-US', { timeZone: CHICAGO_TIME_ZONE }),
      weekday: isChicagoWeekday(now),
    },
    dryRunDefault: dryRunDefault(),
    jobs: {
      total: jobs.length,
      byStatus,
      pendingApprovals,
      failed,
      samples: capSamples(jobSamples),
    },
    lastSweep: lastSweep
      ? {
          at: lastSweep.at,
          dryRun: lastSweep.dryRun,
          skipped: lastSweep.skipped,
          counts: lastSweep.counts,
          samples: lastSweep.samples,
        }
      : null,
    lastRetry: lastRetry
      ? {
          at: lastRetry.at,
          dryRun: lastRetry.dryRun,
          skipped: lastRetry.skipped,
          counts: lastRetry.counts,
          samples: lastRetry.samples,
        }
      : null,
    stuck: capSamples(stuck),
    needsDecision: capSamples(needsDecision),
    cancellationLog: { total: log.length, byState },
  };
  saveStatusSnapshot(status);
  return status;
}

export function getOpsStatus(): CompactOpsStatus {
  return loadStatusSnapshot<CompactOpsStatus>() || buildOpsStatus();
}
