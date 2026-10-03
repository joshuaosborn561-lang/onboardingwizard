import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  findPersonaViolations,
  forbiddenPersonaTokens,
  hasPersonaViolation,
  tokenizePersonaText,
} from './personaGuards.js';

describe('forbiddenPersonaTokens', () => {
  it('keeps client surnames and drops legal suffixes', () => {
    const tokens = forbiddenPersonaTokens({
      clientName: 'Peterson Roofing LLC',
      companyName: 'Peterson Roofing',
      staffNames: ['Kyle Peterson', 'Cayden'],
    });
    assert.ok(tokens.includes('peterson'));
    assert.ok(tokens.includes('kyle'));
    assert.ok(tokens.includes('cayden'));
    assert.ok(!tokens.includes('llc'));
    assert.ok(!tokens.includes('company'));
  });

  it('ignores short and numeric junk', () => {
    const tokens = forbiddenPersonaTokens({ extra: ['Al', '42', 'Ed'] });
    assert.deepEqual(tokens, []);
  });
});

describe('findPersonaViolations', () => {
  const forbidden = forbiddenPersonaTokens({
    clientName: 'Peterson Roofing',
    staffNames: ['Kyle'],
  });

  it('flags client names in display name, username, and local-part', () => {
    const hits = findPersonaViolations(
      {
        firstName: 'Kyle',
        lastName: 'Peterson',
        username: 'kyle.peterson',
        email: 'kyle.peterson@tryroof.info',
      },
      forbidden,
    );
    const fields = hits.map((h) => h.field);
    assert.ok(fields.includes('firstName'));
    assert.ok(fields.includes('lastName'));
    assert.ok(fields.includes('username'));
    assert.ok(fields.includes('email'));
  });

  it('does not flag a made-up persona', () => {
    assert.equal(
      hasPersonaViolation(
        {
          firstName: 'Marcus',
          lastName: 'Whitaker',
          username: 'marcus.whitaker',
          email: 'marcus.whitaker@tryroof.info',
        },
        forbidden,
      ),
      false,
    );
  });

  it('flags digits in the username', () => {
    const hits = findPersonaViolations(
      { firstName: 'Marcus', lastName: 'Whitaker', username: 'marcus2' },
      forbidden,
    );
    assert.ok(hits.some((h) => h.reason === 'digits_in_username'));
  });

  it('tokenizes dotted local-parts as whole words only', () => {
    const bits = tokenizePersonaText('kyle.peterson');
    assert.ok(bits.includes('kyle'));
    assert.ok(bits.includes('peterson'));
    assert.ok(!bits.includes('pete'));
  });
});
