import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKING_RBL_ZONES,
  SURBL_ZONES,
  checkDomainBlacklists,
  isSurblZone,
  rblQueryName,
  verdictFromListings,
  type DnsLookup,
} from './blacklist.js';

function lookupFromMap(hits: Record<string, string[]>): DnsLookup {
  return async (hostname) => {
    if (hostname in hits) return hits[hostname]!;
    const err = new Error('ENOTFOUND') as NodeJS.ErrnoException;
    err.code = 'ENOTFOUND';
    throw err;
  };
}

test('SURBL zones are ignored and never treated as blockers', () => {
  assert.ok(SURBL_ZONES.every((z) => isSurblZone(z)));
  assert.ok(BLOCKING_RBL_ZONES.every((z) => !isSurblZone(z)));
  assert.equal(isSurblZone('multi.surbl.org'), true);
  assert.equal(isSurblZone('dbl.spamhaus.org'), false);
});

test('SURBL-only listing is not a blocker', async () => {
  const domain = 'cedarharbor.info';
  const verdict = await checkDomainBlacklists(
    domain,
    lookupFromMap({
      [rblQueryName(domain, 'multi.surbl.org')]: ['127.0.0.2'],
    }),
  );
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.ignoredSurbl, true);
});

test('Spamhaus or URIBL listing is a blocker', async () => {
  const domain = 'listedexample.info';
  const spamhaus = await checkDomainBlacklists(
    domain,
    lookupFromMap({
      [rblQueryName(domain, 'dbl.spamhaus.org')]: ['127.0.1.2'],
    }),
  );
  assert.equal(spamhaus.blocked, true);
  assert.ok(spamhaus.listings.some((l) => l.zone === 'dbl.spamhaus.org' && l.listed && !l.ignored));

  const uribl = await checkDomainBlacklists(
    domain,
    lookupFromMap({
      [rblQueryName(domain, 'multi.uribl.org')]: ['127.0.0.2'],
    }),
  );
  assert.equal(uribl.blocked, true);
});

test('SURBL plus a blocking list is still blocked', () => {
  const verdict = verdictFromListings('mixed.info', [
    { zone: 'multi.surbl.org', listed: true, ignored: true },
    { zone: 'dbl.spamhaus.org', listed: true, ignored: false },
  ]);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.ignoredSurbl, true);
});

test('clean domain and lookup failures are not listings', async () => {
  const clean = await checkDomainBlacklists('maplelane.info', lookupFromMap({}));
  assert.equal(clean.blocked, false);
  assert.equal(clean.ignoredSurbl, false);

  const failing: DnsLookup = async () => {
    throw new Error('timeout');
  };
  const soft = await checkDomainBlacklists('quietgrove.info', failing);
  assert.equal(soft.blocked, false);
});
