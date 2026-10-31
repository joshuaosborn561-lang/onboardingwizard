/**
 * Combined onboarding sweeps: ONE cron service runs the weekday inventory sweep
 * and the Microsoft export / new-buy chase in a single pass, instead of two
 * services (client-onboarding-sweep and client-onboarding-retry) that each
 * boot, each report, and each page on failure.
 *
 * Same behavior as before: default dry-run (no mutation, no spend), the sweep
 * still self-skips outside its 8:26am Chicago window, the retry still self-skips
 * outside weekday business hours. The only new things are the single entry
 * point and where the result goes: one row per Chicago day in the Supabase queue
 * claude.bot_wake_queue (bot 'onboarding', kind 'sweeps_summary') when either
 * ran, and a failure row (kind 'sweeps_failed') if either threw. No Slack.
 */
import pg from 'pg';

export interface SweepLikeReport {
  kind: string;
  dryRun: boolean;
  skipped?: string | null;
  counts: Record<string, number>;
  samples?: unknown;
  dwGenericSeen?: unknown;
}

export interface QueueItem {
  kind: 'sweeps_summary' | 'sweeps_failed';
  dedupeKey: string;
  headline: string;
  payload: Record<string, unknown>;
}

export interface SweepsDeps {
  runSweep: () => Promise<SweepLikeReport>;
  runRetry: () => Promise<SweepLikeReport>;
  enqueue: ((item: QueueItem) => Promise<boolean>) | null;
  now: Date;
  log?: (line: string) => void;
}

export interface SweepsResult {
  ok: boolean;
  sweep: SweepLikeReport | { error: string };
  retry: SweepLikeReport | { error: string };
  queued: string[];
}

export function chicagoYmd(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(at);
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);
const ranFor = (r: SweepLikeReport | { error: string }): boolean => !('error' in r) && !r.skipped;

export async function runCombinedSweeps(deps: SweepsDeps): Promise<SweepsResult> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const ymd = chicagoYmd(deps.now);
  const queued: string[] = [];
  const attempt = async (name: string, fn: () => Promise<SweepLikeReport>): Promise<SweepLikeReport | { error: string }> => {
    try { return await fn(); } catch (e) { log(`[sweeps] ${name} failed: ${errMsg(e)}`); return { error: errMsg(e) }; }
  };
  // Sequential on purpose: both walk InboxKit and Smartlead, so no doubled API load.
  const sweep = await attempt('sweep', deps.runSweep);
  const retry = await attempt('retry', deps.runRetry);
  const failed = [['sweep', sweep], ['retry', retry]].filter(([, r]) => 'error' in (r as object)) as [string, { error: string }][];

  if (deps.enqueue) {
    try {
      if (failed.length) {
        const key = `sweeps-failed:${ymd}:${deps.now.getUTCHours()}`;
        if (await deps.enqueue({
          kind: 'sweeps_failed', dedupeKey: key,
          headline: `Onboarding sweeps: ${failed.map(([n]) => n).join(' and ')} failed`,
          payload: { source: 'onboarding-sweeps', failed: Object.fromEntries(failed.map(([n, r]) => [n, r.error])), at: deps.now.toISOString() },
        })) queued.push(key);
      }
      if (ranFor(sweep) || ranFor(retry)) {
        const key = `sweeps-summary:${ymd}`;
        const part = (r: SweepLikeReport | { error: string }) => ('error' in r ? { error: r.error } : { skipped: r.skipped ?? null, dryRun: r.dryRun, counts: r.counts });
        if (await deps.enqueue({
          kind: 'sweeps_summary', dedupeKey: key,
          headline: `Onboarding sweeps ${ymd}: sweep ${ranFor(sweep) ? 'ran' : 'skipped'}, retry ${ranFor(retry) ? 'ran' : 'skipped'}`,
          payload: { source: 'onboarding-sweeps', date: ymd, sweep: part(sweep), retry: part(retry), note: 'Dry-run unless --live. First summary of the day only; later runs do not overwrite it.' },
        })) queued.push(key);
      }
    } catch (e) {
      log(`[sweeps] queue write failed: ${errMsg(e)}`);
    }
  }
  return { ok: failed.length === 0, sweep, retry, queued };
}

/** Insert-only sink for claude.bot_wake_queue via WAKE_QUEUE_DATABASE_URL (role wake_queue_writer). Null when unset. */
export function createQueueSink(env: NodeJS.ProcessEnv = process.env): ((item: QueueItem) => Promise<boolean>) | null {
  const url = env.WAKE_QUEUE_DATABASE_URL;
  if (!url) return null;
  const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000 });
  const sink = async (item: QueueItem): Promise<boolean> => {
    const r = await pool.query(
      `insert into claude.bot_wake_queue (bot, kind, dedupe_key, headline, payload, source)
       values ('onboarding', $1, $2, $3, $4::jsonb, 'onboarding-sweeps') on conflict (bot, dedupe_key) do nothing returning id`,
      [item.kind, item.dedupeKey, item.headline.slice(0, 500), JSON.stringify(item.payload)]);
    return (r.rowCount ?? 0) > 0;
  };
  (sink as unknown as { end: () => Promise<void> }).end = () => pool.end();
  return sink;
}
