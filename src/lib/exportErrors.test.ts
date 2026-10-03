import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyExportError,
  nextRetryAt,
  PERMANENT_RETRY_CAP,
  retryCapFor,
  TRANSIENT_RETRY_CAP,
} from './exportErrors.js';

test('classifies Microsoft blocked as permanent and verify failures as transient', () => {
  assert.equal(classifyExportError('Connection blocked by Microsoft'), 'permanent');
  assert.equal(classifyExportError("Connection couldn't be verified"), 'transient');
  assert.equal(classifyExportError('Connection could not be verified'), 'transient');
  assert.equal(classifyExportError('Exported but not yet visible in Smartlead'), 'transient');
  assert.equal(retryCapFor('permanent'), PERMANENT_RETRY_CAP);
  assert.equal(retryCapFor('transient'), TRANSIENT_RETRY_CAP);
});

test('backoff grows after each attempt', () => {
  const from = new Date('2026-10-05T13:26:00Z');
  const first = nextRetryAt(1, from);
  const second = nextRetryAt(2, from);
  assert.equal(first.getTime() - from.getTime(), 15 * 60_000);
  assert.equal(second.getTime() - from.getTime(), 30 * 60_000);
});
