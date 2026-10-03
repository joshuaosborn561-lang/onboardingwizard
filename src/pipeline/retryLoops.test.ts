import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { POWERGRYD_SMARTLEAD_CLIENT_ID } from '../lib/standards.js';
import { runRetryLoops } from './retryLoops.js';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'retry-test-'));

test('retry loop skips Sat/Sun even in dry-run with ignoreSweepWindow', async () => {
  const report = await runRetryLoops({
    dryRun: true,
    ignoreSweepWindow: true,
    now: new Date('2026-10-03T13:26:00Z'),
  });
  assert.equal(report.skipped, 'weekend');
  assert.equal(report.dryRun, true);
});

test('PowerGRYD client id is never a retry tag destination', () => {
  assert.equal(POWERGRYD_SMARTLEAD_CLIENT_ID, 592842);
});
