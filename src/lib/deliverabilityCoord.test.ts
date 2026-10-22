import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './http.js';
import {
  GABE_LOPEZ_RESERVED_NOTE,
  deliverabilityAlreadyDeleted,
  deliverabilityOwnedEmails,
  extractHealthHandoff,
  isGabeLopezReserved,
  isNotFoundError,
  parseDeliverabilityHandoff,
} from './deliverabilityCoord.js';

const monday = new Date('2026-10-05T13:26:00Z'); // Monday Chicago

const handoff = parseDeliverabilityHandoff({
  at: '2026-10-05T13:16:00.000Z',
  ymd: '2026-10-05',
  deleted: 1,
  deletedEmails: ['gone@x.info'],
  clients: [
    {
      clientName: 'TechEvo',
      clientId: 77,
      stillConnected: [{ email: 'ada@x.info' }, { email: 'gone@x.info' }],
      upcomingCancellations: [{ email: 'soon@x.info', cancelDate: '2026-11-01' }],
    },
  ],
});

test('parses Deliverability #275 /health handoff and scopes ownership to today', () => {
  assert.ok(handoff);
  const owned = deliverabilityOwnedEmails(handoff, monday);
  assert.equal(owned.has('ada@x.info'), true);
  assert.equal(owned.has('gone@x.info'), true);
  assert.equal(owned.has('soon@x.info'), false);
  assert.equal(deliverabilityAlreadyDeleted(handoff, 'gone@x.info', monday), true);
  assert.equal(deliverabilityAlreadyDeleted(handoff, 'ada@x.info', monday), false);

  const tuesday = new Date('2026-10-06T13:26:00Z');
  assert.equal(deliverabilityOwnedEmails(handoff, tuesday).size, 0);
  assert.equal(
    parseDeliverabilityHandoff(extractHealthHandoff({ inboxkitLicenseHandoff: handoff }))?.ymd,
    '2026-10-05',
  );
});

test('Gabe Lopez reserved note matches; other notes do not', () => {
  assert.equal(isGabeLopezReserved({ note: GABE_LOPEZ_RESERVED_NOTE }), true);
  assert.equal(isGabeLopezReserved({ cancel_reason: 'Reserved: Gabe Lopez' }), true);
  assert.equal(isGabeLopezReserved({ note: 'reserved: someone else' }), false);
  assert.equal(isGabeLopezReserved({ note: '' }), false);
});

test('404 / already-deleted vendor errors are treated as gone, not failures', () => {
  assert.equal(isNotFoundError(new ApiError('missing', 404, null)), true);
  assert.equal(isNotFoundError(new Error('Mailbox not found')), true);
  assert.equal(isNotFoundError(new Error('already deleted')), true);
  assert.equal(isNotFoundError(new ApiError('nope', 500, null)), false);
});
