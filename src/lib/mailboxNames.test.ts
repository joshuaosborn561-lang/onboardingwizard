import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allocateNeutralIdentities } from './mailboxNames.js';

describe('allocateNeutralIdentities', () => {
  it('avoids reserved and forbidden tokens', () => {
    const identities = allocateNeutralIdentities(8, {
      reservedUsernames: ['marcus.whitaker'],
      reservedFirst: ['Marcus'],
      reservedLast: ['Whitaker'],
      forbiddenTokens: ['peterson', 'kyle', 'cayden'],
    });
    assert.equal(identities.length, 8);
    const users = new Set(identities.map((i) => i.username.toLowerCase()));
    assert.equal(users.size, 8);
    assert.ok(!users.has('marcus.whitaker'));
    for (const id of identities) {
      const blob = `${id.first_name} ${id.last_name} ${id.username}`.toLowerCase();
      assert.ok(!blob.includes('peterson'));
      assert.ok(!blob.includes('kyle'));
      assert.ok(!/\d/.test(id.username));
    }
  });
});
