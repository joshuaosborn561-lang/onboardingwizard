import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applySweepActions, resolveDryRun, runInventorySweep } from './inventorySweep.js';
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
  };
  const actions: SweepAction[] = [
    { type: 'import_google', email: 'a@x.info', reason: 'test' },
    { type: 'delete_ik', email: 'b@x.info', uid: 'u', workspaceId: 'ws', reason: 'test' },
    { type: 'porkbun_autorenew_off', domain: 'x.info', reason: 'test' },
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
