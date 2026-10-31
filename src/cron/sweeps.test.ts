import assert from 'node:assert/strict';
import test from 'node:test';
import { chicagoYmd, runCombinedSweeps, type QueueItem, type SweepLikeReport } from './sweeps.js';

const rep = (kind: string, skipped: string | null = null): SweepLikeReport => ({ kind, dryRun: true, skipped, counts: { seats: 3 } });
const NOW = new Date('2026-11-02T13:26:00Z'); // Mon 8:26am CT

function harness(over: Partial<Parameters<typeof runCombinedSweeps>[0]> = {}) {
  const items: QueueItem[] = []; const seen = new Set<string>(); const calls: string[] = [];
  const deps = {
    now: NOW, log: () => {},
    runSweep: async () => { calls.push('sweep'); return rep('sweep'); },
    runRetry: async () => { calls.push('retry'); return rep('retry'); },
    enqueue: async (i: QueueItem) => { if (seen.has(i.dedupeKey)) return false; seen.add(i.dedupeKey); items.push(i); return true; },
    ...over,
  };
  return { deps, items, calls };
}

test('runs sweep then retry once each and queues one summary for the day', async () => {
  const h = harness();
  const r = await runCombinedSweeps(h.deps);
  assert.deepEqual(h.calls, ['sweep', 'retry']);
  assert.equal(r.ok, true);
  assert.equal(h.items.length, 1);
  assert.equal(h.items[0].kind, 'sweeps_summary');
  assert.equal(h.items[0].dedupeKey, 'sweeps-summary:2026-11-02');
  await runCombinedSweeps(h.deps);
  assert.equal(h.items.length, 1, 'second run the same day does not add another summary');
});

test('both skipped means nothing is queued', async () => {
  const h = harness({ runSweep: async () => rep('sweep', 'outside_sweep_window'), runRetry: async () => rep('retry', 'outside_business_hours') });
  const r = await runCombinedSweeps(h.deps);
  assert.equal(r.ok, true); assert.equal(h.items.length, 0);
});

test('a failing half does not stop the other and queues a failure row, ok=false', async () => {
  const h = harness({ runSweep: async () => { throw new Error('inboxkit 500'); } });
  const r = await runCombinedSweeps(h.deps);
  assert.deepEqual(h.calls, ['retry']);
  assert.equal(r.ok, false);
  assert.deepEqual(h.items.map((i) => i.kind).sort(), ['sweeps_failed', 'sweeps_summary']);
  const failed = h.items.find((i) => i.kind === 'sweeps_failed')!;
  assert.match(JSON.stringify(failed.payload), /inboxkit 500/);
});

test('no sink and a throwing sink never break the run', async () => {
  const a = await runCombinedSweeps(harness({ enqueue: null }).deps);
  assert.equal(a.ok, true);
  const b = await runCombinedSweeps(harness({ enqueue: async () => { throw new Error('db down'); } }).deps);
  assert.equal(b.ok, true); assert.deepEqual(b.queued, []);
});

test('chicagoYmd uses Chicago local date', () => {
  assert.equal(chicagoYmd(new Date('2026-11-03T03:30:00Z')), '2026-11-02');
});
