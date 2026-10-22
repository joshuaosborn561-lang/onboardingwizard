import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEmptyJob } from '../types.js';
import {
  accountClientId,
  assertAccountNotPowerGryd,
  assertNotPowerGryd,
  capSamples,
  CHICAGO_TIME_ZONE,
  INBOXES_PER_DOMAIN,
  isChicagoWeekday,
  webhookMayAdvanceJobs,
  isPowerGrydAccount,
  isPowerGrydClientId,
  parseSmartleadClientId,
  POWERGRYD_SMARTLEAD_CLIENT_ID,
  STATUS_SAMPLE_CAP,
  SCHEDULED_CANCEL_DUE_OFFSET_DAYS,
  WEEKDAY_CRON_DOW,
  WEEKDAY_SWEEP_LOCAL_TIME,
} from './standards.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('inbox cap and PowerGRYD id match STANDARDS', () => {
  assert.equal(INBOXES_PER_DOMAIN, 2);
  assert.equal(POWERGRYD_SMARTLEAD_CLIENT_ID, 592842);
  assert.equal(STATUS_SAMPLE_CAP, 10);
  assert.equal(WEEKDAY_SWEEP_LOCAL_TIME, '08:26');
  assert.equal(WEEKDAY_CRON_DOW, '1-5');
  assert.equal(CHICAGO_TIME_ZONE, 'America/Chicago');
  assert.equal(SCHEDULED_CANCEL_DUE_OFFSET_DAYS, 1);
});

test('PowerGRYD helper refuses 592842 and allows other client ids', () => {
  assert.equal(isPowerGrydClientId(592842), true);
  assert.equal(isPowerGrydClientId('592842'), true);
  assert.equal(isPowerGrydClientId(1), false);
  assert.equal(isPowerGrydClientId(undefined), false);
  assert.throws(() => assertNotPowerGryd(592842), /PowerGRYD/);
  assert.doesNotThrow(() => assertNotPowerGryd(100));
});

test('PowerGRYD refuse covers accounts already tagged 592842, not just assignment', () => {
  assert.equal(parseSmartleadClientId('592842'), 592842);
  assert.equal(accountClientId({ client_id: 592842 }), 592842);
  assert.equal(accountClientId({ clientId: '548610' }), 548610);
  assert.equal(accountClientId({ client: { id: 592842 } }), 592842);
  assert.equal(isPowerGrydAccount({ client_id: 592842 }), true);
  assert.equal(isPowerGrydAccount({ client_id: 548610 }), false);
  assert.throws(() => assertAccountNotPowerGryd({ client_id: 592842 }), /tagged PowerGRYD/);
  assert.doesNotThrow(() => assertAccountNotPowerGryd({ client_id: 345263 }));
  assert.doesNotThrow(() => assertAccountNotPowerGryd({ client_id: null }));
});

test('createEmptyJob ignores manualApproval=false (spend gate stays locked)', () => {
  const job = createEmptyJob({
    id: 'test',
    websiteUrl: 'https://example.com',
    forwardToUrl: 'https://example.com',
    companyName: 'Example',
    inboxCount: 4,
    googleRatio: 0.5,
    manualApproval: false,
  });
  assert.equal(job.manualApproval, true);
});

test('Chicago weekday helper treats Sat/Sun as off', () => {
  // 2026-10-03 is Saturday; 2026-10-05 is Monday (fixed instants).
  const saturdayUtc = new Date('2026-10-03T18:00:00Z');
  const mondayUtc = new Date('2026-10-05T14:00:00Z');
  assert.equal(isChicagoWeekday(saturdayUtc), false);
  assert.equal(isChicagoWeekday(mondayUtc), true);
  assert.equal(webhookMayAdvanceJobs(saturdayUtc), false);
  assert.equal(webhookMayAdvanceJobs(mondayUtc), true);
});

test('sample cap never returns more than 10', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(capSamples(items), items.slice(0, 10));
});

test('ONBOARDING_SOP and AGENTS still encode STANDARDS and spend gates', () => {
  const sop = readRepo('ONBOARDING_SOP.md');
  const agents = readRepo('AGENTS.md');
  const onboarding = readRepo('src/pipeline/onboarding.ts');
  const routes = readRepo('src/api/routes.ts');

  for (const text of [sop, agents]) {
    assert.match(text, /Never spend money without explicit/);
    assert.match(text, /592842/);
    assert.match(text, /PowerGRYD/);
    assert.match(text, /America\/Chicago/);
    assert.match(text, /DW Generic/);
    assert.match(text, /SURBL/);
    assert.match(text, /max 2/i);
  }

  assert.match(sop, /manualApproval is hard-locked/i);
  assert.match(agents, /manualApproval` is hard-locked/);
  assert.match(onboarding, /manualApproval: true/);
  assert.match(routes, /manualApproval = true/);
  assert.match(onboarding, /assertNotPowerGryd/);
  assert.match(sop, /already\s+tagged `592842`/);
  assert.match(agents, /already tagged `592842`/);
  assert.match(readRepo('src/api/routes.ts'), /x-cron-secret/);
  assert.match(readRepo('src/lib/cronAuth.ts'), /if \(!secret\) return false/);
  assert.match(sop, /not[\s\S]{0,40}standing-[\s\n]*approved/i);
  assert.match(agents, /not standing-approved/);
  assert.doesNotMatch(sop, /confirmed=true` on a[\s\S]{0,20}per-job trim/);
  assert.doesNotMatch(agents, /confirmed=true` on the existing per-job trim/);

  const smartlead = readRepo('src/vendors/smartlead.ts');
  assert.match(smartlead, /assertEmailAccountNotPowerGryd/);
  assert.match(smartlead, /assertAccountNotPowerGryd/);
  assert.match(smartlead, /assertNotPowerGryd\(input\.clientId\)/);
});
