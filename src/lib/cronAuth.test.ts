import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cronAuthError, cronSecretConfigured, isCronAuthorized } from './cronAuth.js';

test('CRON_SECRET unset refuses every caller', () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(cronSecretConfigured(), false);
  assert.equal(isCronAuthorized('anything'), false);
  assert.equal(cronAuthError().error, 'CRON_SECRET is required');
  if (prev === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prev;
});

test('CRON_SECRET is header-only — wrong or empty header is unauthorized', () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'expected-secret';
  assert.equal(isCronAuthorized('expected-secret'), true);
  assert.equal(isCronAuthorized('wrong'), false);
  assert.equal(isCronAuthorized(undefined), false);
  assert.equal(isCronAuthorized(''), false);
  assert.equal(cronAuthError().error, 'unauthorized');
  if (prev === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = prev;
});

test('ledger routes sit behind CRON_SECRET header auth', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../api/routes.ts'),
    'utf8',
  );
  assert.match(src, /apiRouter\.get\('\/ledger', requireCron/);
  assert.match(src, /apiRouter\.get\('\/ledger\/events', requireCron/);
});
