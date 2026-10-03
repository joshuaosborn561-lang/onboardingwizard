import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDomainCandidates } from './domainNaming.js';
import { generateGenericDomains } from './genericDomains.js';
import { collectForbiddenTokens, domainHasClientToken } from './namingGuards.js';

const FAKE = {
  websiteUrl: 'https://northwindsolar.example',
  clientName: 'Northwind Solar',
  brandWords: ['northwind', 'solar'],
  forbiddenTokens: collectForbiddenTokens({
    clientName: 'Northwind Solar',
    websiteUrl: 'https://northwindsolar.example',
    brandWords: ['northwind', 'solar'],
    staffNames: ['Renee Colfax'],
    industry: 'residential solar',
  }),
};

test('generic domains are unique letters-only .info names without client tokens', () => {
  const domains = generateGenericDomains({ forbiddenTokens: FAKE.forbiddenTokens, limit: 24 });
  assert.ok(domains.length >= 16);
  assert.equal(new Set(domains).size, domains.length);
  for (const domain of domains) {
    assert.match(domain, /^[a-z]+\.info$/);
    assert.equal(domainHasClientToken(domain, FAKE.forbiddenTokens), false);
    assert.doesNotMatch(domain, /northwind|solar|renee|colfax/);
  }
});

test('buildDomainCandidates prefers generic names and keeps branded as fallback', () => {
  const rows = buildDomainCandidates(FAKE, { genericLimit: 12, brandedLimit: 4 });
  const generic = rows.filter((r) => r.kind === 'generic');
  const branded = rows.filter((r) => r.kind === 'branded');
  assert.ok(generic.length >= 8);
  assert.ok(rows[0]?.kind === 'generic');
  assert.ok(branded.every((r) => /northwindsolar/.test(r.domain)));
});
