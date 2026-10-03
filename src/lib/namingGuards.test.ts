import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertMaxInboxesPerDomain,
  remainingInboxSlots,
  takeMaxInboxesPerDomain,
  classifyDomainKind,
  collectForbiddenTokens,
  domainHasClientToken,
  guardMailboxPlan,
  isLettersOnlyUsername,
  parseStaffNames,
  personaHitTokens,
  shouldForwardDomain,
} from './namingGuards.js';
import { INBOXES_PER_DOMAIN } from './opsRules.js';

const FAKE_CLIENT = {
  clientName: 'Northwind Solar',
  companyName: 'Northwind Solar',
  websiteUrl: 'https://northwindsolar.example',
  staffNames: ['Renee Colfax'],
  brandWords: ['northwind', 'solar'],
  industry: 'residential solar',
};

test('collects client and staff tokens, never treating them as senders', () => {
  const tokens = collectForbiddenTokens(FAKE_CLIENT);
  for (const token of ['northwind', 'solar', 'renee', 'colfax']) {
    assert.ok(tokens.includes(token), `missing ${token}`);
  }
});

test('parseStaffNames splits comma and newline lists', () => {
  assert.deepEqual(parseStaffNames('Renee Colfax, Jordan Hale'), ['Renee Colfax', 'Jordan Hale']);
  assert.deepEqual(parseStaffNames('Renee Colfax\nJordan Hale'), ['Renee Colfax', 'Jordan Hale']);
});

test('rejects client/staff personas and rewrites to a made-up identity', () => {
  const result = guardMailboxPlan(
    [
      {
        domain: 'cedarharbor.info',
        platform: 'GOOGLE',
        firstName: 'Renee',
        lastName: 'Colfax',
        username: 'reneecolfax',
      },
      {
        domain: 'cedarharbor.info',
        platform: 'GOOGLE',
        firstName: 'Northwind',
        lastName: 'Solar',
        username: 'northwindsolar',
      },
    ],
    FAKE_CLIENT,
  );
  assert.equal(result.rewritten.length, 2);
  for (const slot of result.plan) {
    assert.equal(personaHitTokens(slot, collectForbiddenTokens(FAKE_CLIENT)).length, 0);
    assert.ok(isLettersOnlyUsername(slot.username));
    assert.doesNotMatch(slot.username, /\d/);
    assert.doesNotMatch(`${slot.firstName} ${slot.lastName}`.toLowerCase(), /renee|colfax|northwind|solar/);
  }
  assert.equal(new Set(result.plan.map((s) => s.username)).size, 2);
});

test('keeps a neutral made-up persona such as Marcus Whitaker', () => {
  const result = guardMailboxPlan(
    [
      {
        domain: 'cedarharbor.info',
        platform: 'GOOGLE',
        firstName: 'Marcus',
        lastName: 'Whitaker',
        username: 'marcuswhitaker',
      },
      {
        domain: 'cedarharbor.info',
        platform: 'GOOGLE',
        firstName: 'Elena',
        lastName: 'Croft',
        username: 'elenacroft',
      },
    ],
    FAKE_CLIENT,
  );
  assert.equal(result.rewritten.length, 0);
  assert.equal(result.plan[0]?.username, 'marcuswhitaker');
  assert.equal(result.plan[1]?.username, 'elenacroft');
});

test('rejects dotted or underscored usernames as not letters-only', () => {
  assert.equal(isLettersOnlyUsername('marcuswhitaker'), true);
  assert.equal(isLettersOnlyUsername('marcus.whitaker'), false);
  assert.equal(isLettersOnlyUsername('marcus_whitaker'), false);
});

test('detects client/staff names as substrings in concatenated usernames', () => {
  const tokens = collectForbiddenTokens({
    clientName: 'Peterson Roofing',
    staffNames: ['Kyle Smith'],
  });
  const hits = personaHitTokens({ username: 'kylesmith' }, tokens);
  assert.ok(hits.includes('kyle'), `expected kyle in ${hits.join(',')}`);
  assert.ok(hits.includes('smith'), `expected smith in ${hits.join(',')}`);
});

test('rewrites usernames that contain digits or are not unique', () => {
  const result = guardMailboxPlan(
    [
      {
        domain: 'maplelane.info',
        platform: 'GOOGLE',
        firstName: 'Marcus',
        lastName: 'Whitaker',
        username: 'marcus2',
      },
      {
        domain: 'maplelane.info',
        platform: 'GOOGLE',
        firstName: 'Elena',
        lastName: 'Croft',
        username: 'marcuswhitaker',
      },
    ],
    FAKE_CLIENT,
  );
  assert.ok(result.rewritten.length >= 1);
  assert.ok(result.plan.every((s) => isLettersOnlyUsername(s.username)));
  assert.equal(new Set(result.plan.map((s) => s.username)).size, 2);
});

test('takeMaxInboxesPerDomain and remaining slots cap buy/sync/restore at 2', () => {
  const kept = takeMaxInboxesPerDomain([
    { domain: 'cedarharbor.info', id: 1 },
    { domain: 'cedarharbor.info', id: 2 },
    { domain: 'cedarharbor.info', id: 3 },
    { domain: 'maplelane.info', id: 4 },
  ]);
  assert.deepEqual(
    kept.map((r) => r.id),
    [1, 2, 4],
  );
  assert.equal(remainingInboxSlots(0), 2);
  assert.equal(remainingInboxSlots(2), 0);
  assert.equal(remainingInboxSlots(5), 0);
});

test('rejects more than 2 inboxes on one domain', () => {
  assert.equal(INBOXES_PER_DOMAIN, 2);
  assert.throws(
    () =>
      assertMaxInboxesPerDomain([
        { domain: 'cedarharbor.info' },
        { domain: 'cedarharbor.info' },
        { domain: 'cedarharbor.info' },
      ]),
    /Max 2 inboxes per domain/,
  );
  assert.doesNotThrow(() =>
    assertMaxInboxesPerDomain([{ domain: 'cedarharbor.info' }, { domain: 'cedarharbor.info' }]),
  );
});

test('generic domains have no client tokens and do not forward', () => {
  const tokens = collectForbiddenTokens(FAKE_CLIENT);
  assert.equal(classifyDomainKind('cedarharbor.info', tokens), 'generic');
  assert.equal(domainHasClientToken('cedarharbor.info', tokens), false);
  assert.equal(shouldForwardDomain('generic'), false);
  assert.equal(classifyDomainKind('trynorthwindsolar.info', tokens), 'branded');
  assert.equal(shouldForwardDomain('branded'), true);
});
