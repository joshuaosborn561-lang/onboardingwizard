import { isChicagoWeekday } from '../lib/standards.js';
import { runInventorySweep } from '../pipeline/inventorySweep.js';
import { runRetryLoops } from '../pipeline/retryLoops.js';
import { createQueueSink, runCombinedSweeps } from './sweeps.js';

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function requestedDryRun(): boolean {
  if (argFlag('--live')) return false;
  return true;
}

async function main(): Promise<void> {
  const kind = process.argv[2] === 'retry' ? 'retry' : process.argv[2] === 'sweeps' ? 'sweeps' : 'sweep';
  const dryRun = requestedDryRun();
  const compare = argFlag('--compare') || argFlag('--ignore-window');
  const now = new Date();

  if (!isChicagoWeekday(now)) {
    console.log(
      JSON.stringify({
        ok: true,
        skipped: 'weekend',
        kind,
        dryRun,
        at: now.toISOString(),
      }),
    );
    return;
  }

  if (kind === 'sweeps') {
    // Combined: sweep then retry in one pass (replaces the two separate cron services).
    const sink = createQueueSink();
    const result = await runCombinedSweeps({
      now,
      enqueue: sink,
      runSweep: () => runInventorySweep({ dryRun, now, ignoreSweepWindow: compare }),
      runRetry: () => runRetryLoops({ dryRun, now, ignoreSweepWindow: compare }),
    });
    console.log(JSON.stringify({ ok: result.ok, kind: 'sweeps', dryRun, sweep: result.sweep, retry: result.retry, queued: result.queued }));
    await (sink as unknown as { end?: () => Promise<void> } | null)?.end?.();
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const report =
    kind === 'retry'
      ? await runRetryLoops({ dryRun, now, ignoreSweepWindow: compare })
      : await runInventorySweep({
          dryRun,
          now,
          ignoreSweepWindow: compare,
        });

  console.log(
    JSON.stringify({
      ok: true,
      kind: report.kind,
      dryRun: report.dryRun,
      skipped: report.skipped,
      counts: report.counts,
      samples: report.samples,
      dwGenericSeen: report.dwGenericSeen,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
