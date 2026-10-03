import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { STATUS_SAMPLE_CAP } from '../lib/standards.js';

const dir = mkdtempSync(join(tmpdir(), 'ops-status-'));
process.env.DATA_DIR = dir;

test('GET /api/status builder caps samples at 10', async () => {
  mkdirSync(join(dir, 'jobs'), { recursive: true });
  mkdirSync(join(dir, 'ops'), { recursive: true });
  for (let i = 0; i < 15; i++) {
    writeFileSync(
      join(dir, 'jobs', `job${i}.json`),
      JSON.stringify({
        id: `job${i}`,
        createdAt: `2026-10-05T0${i % 9}:00:00.000Z`,
        updatedAt: `2026-10-05T0${i % 9}:00:00.000Z`,
        status: 'failed',
        websiteUrl: 'https://example.com',
        forwardToUrl: 'https://example.com',
        companyName: `Client ${i}`,
        inboxCount: 0,
        googleRatio: 0.5,
        manualApproval: true,
        candidates: [],
        registeredDomains: [],
        inboxkitOrderIds: [],
        expectedMailboxCount: 0,
        mailboxes: [],
        logs: [],
        error: { step: 'failed', message: `boom ${i}` },
      }),
    );
  }
  process.env.DATA_DIR = dir;
  const { buildOpsStatus } = await import('./opsStatus.js');
  const status = buildOpsStatus(new Date('2026-10-05T13:26:00Z'));
  assert.equal(status.ok, true);
  assert.ok(status.jobs.samples.length <= STATUS_SAMPLE_CAP);
  assert.ok(status.stuck.length <= STATUS_SAMPLE_CAP);
  assert.ok(status.needsDecision.length <= STATUS_SAMPLE_CAP);
  assert.equal(status.jobs.failed, 15);
});
