import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SPEND_APPROVE_GATES,
  extractBearerToken,
  signApproveToken,
  verifyApproveToken,
  verifyPersonaRenameApproveToken,
} from './approveToken.js';

describe('approval gates', () => {
  it('keeps the four onboarding spend/load gates unchanged', () => {
    assert.deepEqual([...SPEND_APPROVE_GATES], [
      'domain_approval',
      'mailbox_plan',
      'smartlead_load',
      'porkbun_funds',
    ]);
  });

  it('signs and verifies persona_rename without dropping spend gates', () => {
    process.env.SLACK_ACTION_SECRET = 'test-secret-for-persona-rename';
    const token = signApproveToken('rename-job-1', 'persona_rename');
    const parsed = verifyApproveToken(token);
    assert.ok(parsed);
    assert.equal(parsed?.gate, 'persona_rename');
    assert.equal(parsed?.jobId, 'rename-job-1');

    const spend = signApproveToken('onboard-1', 'mailbox_plan');
    const spendParsed = verifyApproveToken(spend);
    assert.equal(spendParsed?.gate, 'mailbox_plan');
    assert.equal(verifyPersonaRenameApproveToken(token, 'rename-job-1'), true);
    assert.equal(verifyPersonaRenameApproveToken(token, 'other-job'), false);
    assert.equal(verifyPersonaRenameApproveToken(spend, 'rename-job-1'), false);
    assert.equal(extractBearerToken('Bearer abc.def'), 'abc.def');
  });
});
