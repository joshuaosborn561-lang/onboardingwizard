import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { POWERGRYD_SMARTLEAD_CLIENT_ID } from '../lib/standards.js';
import { GENERIC_CLIENT, ledgerForbidsClientAssign, type SeatLedgerRow } from '../store/seatLedger.js';
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

test('retry finalize must not assign a client on ledger-generic seats', () => {
  const rows: SeatLedgerRow[] = [
    {
      email: 'pool@neutral.info',
      domain: 'neutral.info',
      provider: 'inboxkit_google',
      client: GENERIC_CLIENT,
      powergryd: false,
      ik_workspace_id: 'ws-mixed',
      status: 'warming',
      updated_at: '2026-10-05T13:00:00.000Z',
    },
  ];
  assert.equal(ledgerForbidsClientAssign('pool@neutral.info', rows), true);
});
