import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { refusePorkbunDomainDelete } from '../vendors/porkbun.js';
import { SCHEDULED_CANCEL_DUE_OFFSET_DAYS } from './standards.js';
import { isScheduledCancelDue, scheduledCancelDueAt } from './scheduledCancel.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('due date is cancel/renewal + 1 day and survives a missing recompute source', () => {
  assert.equal(SCHEDULED_CANCEL_DUE_OFFSET_DAYS, 1);
  assert.equal(scheduledCancelDueAt('2026-11-15'), '2026-11-16T00:00:00.000Z');
  assert.equal(
    scheduledCancelDueAt('2026-11-15T12:00:00.000Z'),
    '2026-11-16T12:00:00.000Z',
  );
  assert.equal(scheduledCancelDueAt(undefined, '2026-11-16T00:00:00.000Z'), '2026-11-16T00:00:00.000Z');
  assert.equal(isScheduledCancelDue('2026-10-05T00:00:00.000Z', new Date('2026-10-05T13:26:00Z')), true);
  assert.equal(isScheduledCancelDue('2026-10-06T00:00:00.000Z', new Date('2026-10-05T13:26:00Z')), false);
  assert.equal(isScheduledCancelDue(undefined, new Date('2026-10-05T13:26:00Z')), false);
});

test('Porkbun domain delete is refused; vendor has auto-renew off only', () => {
  assert.throws(() => refusePorkbunDomainDelete('gone.info'), /never delete the domain/i);
  const porkbun = readFileSync(join(repoRoot, 'src/vendors/porkbun.ts'), 'utf8');
  assert.match(porkbun, /updateAutoRenew/);
  assert.doesNotMatch(porkbun, /domain\/delete/i);
  const inboxkit = readFileSync(join(repoRoot, 'src/vendors/inboxkit.ts'), 'utf8');
  assert.doesNotMatch(inboxkit, /workspaces\/delete|workspaces\/remove/);
});
