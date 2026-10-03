import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { webhookMayAdvanceJobs } from '../lib/standards.js';
import { applySweepActions, resolveDryRun, runInventorySweep, seatsFromInboxkit } from './inventorySweep.js';
import { seatLedgerPath } from '../store/seatLedger.js';
import type { SweepAction, SweepApplyDeps } from './inventorySweep.js';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'sweep-test-'));

test('resolveDryRun defaults true and ignores --live unless env unlocks it', () => {
  const prev = process.env.SWEEP_DRY_RUN;
  delete process.env.SWEEP_DRY_RUN;
  assert.equal(resolveDryRun(), true);
  assert.equal(resolveDryRun(true), true);
  assert.equal(resolveDryRun(false), true);
  process.env.SWEEP_DRY_RUN = 'false';
  assert.equal(resolveDryRun(false), false);
  assert.equal(resolveDryRun(true), true);
  if (prev === undefined) delete process.env.SWEEP_DRY_RUN;
  else process.env.SWEEP_DRY_RUN = prev;
});

test('applySweepActions in dry-run never calls vendor mutators', async () => {
  const calls: string[] = [];
  const deps: SweepApplyDeps = {
    importGoogle: async () => {
      calls.push('importGoogle');
    },
    exportMicrosoft: async () => {
      calls.push('exportMicrosoft');
    },
    tagClient: async () => {
      calls.push('tagClient');
    },
    enableWarmup: async () => {
      calls.push('enableWarmup');
    },
    deleteIk: async () => {
      calls.push('deleteIk');
    },
    deleteSl: async () => {
      calls.push('deleteSl');
    },
    porkbunAutoRenewOff: async () => {
      calls.push('porkbun');
    },
    removeIkDomain: async () => {
      calls.push('removeIkDomain');
    },
    flagWorkspaceDelete: async () => {
      calls.push('flagWorkspace');
    },
  };
  const actions: SweepAction[] = [
    { type: 'import_google', email: 'a@x.info', reason: 'test' },
    { type: 'delete_ik', email: 'b@x.info', uid: 'u', workspaceId: 'ws', reason: 'test' },
    { type: 'porkbun_autorenew_off', domain: 'x.info', reason: 'test' },
    { type: 'remove_ik_domain', domain: 'x.info', workspaceId: 'ws', reason: 'test' },
    { type: 'flag_workspace_delete', workspaceId: 'ws', reason: 'test' },
  ];
  const dry = await applySweepActions(actions, { dryRun: true, deps });
  assert.equal(dry.applied, 0);
  assert.deepEqual(calls, []);
});

test('weekend sweep skips without vendor work', async () => {
  const report = await runInventorySweep({
    dryRun: true,
    now: new Date('2026-10-03T13:26:00Z'),
  });
  assert.equal(report.skipped, 'weekend');
  assert.equal(report.dryRun, true);
  assert.equal(report.chicago.weekday, false);
});

test('weekend never runs even with ignoreSweepWindow / dry-run', async () => {
  const report = await runInventorySweep({
    dryRun: true,
    ignoreSweepWindow: true,
    now: new Date('2026-10-03T13:26:00Z'),
  });
  assert.equal(report.skipped, 'weekend');
});

test('Saturday America/Chicago is a no-op even when scheduled-cancel seats would be due', async () => {
  // 2026-10-03 13:26 UTC is Saturday morning in America/Chicago.
  const report = await runInventorySweep({
    dryRun: true,
    ignoreSweepWindow: true,
    now: new Date('2026-10-03T13:26:00Z'),
  });
  assert.equal(report.skipped, 'weekend');
  assert.equal(report.chicago.weekday, false);
  assert.equal(report.dryRun, true);
  assert.equal(report.counts.wouldDeleteIk, 0);
  assert.equal(report.counts.wouldDeleteSl, 0);
  assert.equal(report.counts.applied, 0);
});

test('webhooks do not advance jobs on Saturday/Sunday Chicago', () => {
  assert.equal(webhookMayAdvanceJobs(new Date('2026-10-03T18:00:00Z')), false);
  assert.equal(webhookMayAdvanceJobs(new Date('2026-10-05T14:00:00Z')), true);
});

test('dry-run weekend skip does not persist a seat ledger file', async () => {
  const report = await runInventorySweep({
    dryRun: true,
    now: new Date('2026-10-03T13:26:00Z'),
  });
  assert.equal(report.skipped, 'weekend');
  assert.equal(existsSync(seatLedgerPath()), false);
});

test('cancellation date prefers renewal_date / prepaid_until', () => {
  const seats = seatsFromInboxkit({ uid: 'ws-1', name: 'Acme' }, [
    {
      uid: 'm1',
      email: 'marcus@example.info',
      username: 'marcus',
      domain_name: 'example.info',
      status: 'scheduled_for_cancellation',
      cancellation_date: '2026-01-01',
      cancel_at: '2026-01-02',
      renewal_date: '2026-11-15',
    },
    {
      uid: 'm2',
      email: 'elena@example.info',
      username: 'elena',
      domain_name: 'example.info',
      status: 'cancelled',
      prepaid_until: '2026-12-01',
      platform: 'AZURE',
    },
  ]);
  assert.equal(seats[0]?.cancelDate, '2026-11-15');
  assert.equal(seats[1]?.cancelDate, '2026-12-01');
  assert.equal(seats[0]?.provider, 'inboxkit_google');
  assert.equal(seats[1]?.provider, 'inboxkit_azure');
});
