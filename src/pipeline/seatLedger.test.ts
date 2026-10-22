import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { STATUS_SAMPLE_CAP } from '../lib/standards.js';
import {
  GENERIC_CLIENT,
  WARM_READY_DAYS,
  absorbCancellationLog,
  addUtcDays,
  buildLedgerEventsResponse,
  buildLedgerResponse,
  ledgerForbidsClientAssign,
  ledgerProviderOf,
  loadSeatLedger,
  parseLedgerEventsQuery,
  parseLedgerQuery,
  type SeatLedgerRow,
} from '../store/seatLedger.js';
import { deriveLedgerStatus, syncSeatLedger } from './seatLedger.js';
import type { IkSeat } from './inventoryPlan.js';

process.env.DATA_DIR = process.env.DATA_DIR || mkdtempSync(join(tmpdir(), 'ledger-test-'));

function seat(partial: Partial<IkSeat> & Pick<IkSeat, 'email' | 'lifecycle'>): IkSeat {
  return {
    uid: partial.uid || partial.email,
    workspaceId: partial.workspaceId || 'ws-1',
    workspaceName: partial.workspaceName || 'Acme',
    domain: partial.domain || 'example.info',
    platform: partial.platform || 'GOOGLE',
    provider: partial.provider || 'inboxkit_google',
    status: partial.status || partial.lifecycle,
    firstName: partial.firstName || 'Marcus',
    lastName: partial.lastName || 'Whitaker',
    username: partial.username || 'marcus',
    ...partial,
  };
}

test('ledger providers are inboxkit_google / inboxkit_m365 / inboxkit_azure', () => {
  assert.equal(ledgerProviderOf('GOOGLE'), 'inboxkit_google');
  assert.equal(ledgerProviderOf('GMAIL'), 'inboxkit_google');
  assert.equal(ledgerProviderOf('M365'), 'inboxkit_m365');
  assert.equal(ledgerProviderOf('MICROSOFT'), 'inboxkit_m365');
  assert.equal(ledgerProviderOf('AZURE'), 'inboxkit_azure');
  assert.equal(ledgerProviderOf('inboxkit azure'), 'inboxkit_azure');
});

test('ledger statuses drop in_sl and use bought → warming → warm', () => {
  const now = new Date('2026-10-05T13:00:00Z');
  assert.equal(
    deriveLedgerStatus({ lifecycle: 'active', inSmartlead: false, now }),
    'bought',
  );
  assert.equal(
    deriveLedgerStatus({
      lifecycle: 'active',
      inSmartlead: true,
      slImportedAt: '2026-10-01T00:00:00.000Z',
      now,
    }),
    'warming',
  );
  assert.equal(
    deriveLedgerStatus({
      lifecycle: 'active',
      inSmartlead: true,
      slImportedAt: '2026-09-01T00:00:00.000Z',
      now,
    }),
    'warm',
  );
  assert.equal(
    deriveLedgerStatus({ lifecycle: 'scheduled_for_cancellation', inSmartlead: true, now }),
    'scheduled_cancel',
  );
  assert.equal(deriveLedgerStatus({ lifecycle: 'cancelled', inSmartlead: true, now }), 'lapsed');
  assert.equal(
    deriveLedgerStatus({ lifecycle: 'cancelled', inSmartlead: false, now, deleted: true }),
    'deleted',
  );
  assert.notEqual(
    deriveLedgerStatus({ lifecycle: 'active', inSmartlead: true, slImportedAt: now.toISOString(), now }),
    'in_sl',
  );
  assert.equal(WARM_READY_DAYS, 21);
  assert.equal(addUtcDays('2026-10-01T00:00:00.000Z', 21), '2026-10-22T00:00:00.000Z');
});

test('sync writes ik_workspace_id, sl_account_id, powergryd and emits new-buy / scheduled-cancel events', () => {
  const now = new Date('2026-10-05T13:26:00Z');
  const synced = syncSeatLedger({
    seats: [
      seat({
        email: 'new@example.info',
        lifecycle: 'active',
        workspaceId: 'ws-sales',
        provider: 'inboxkit_m365',
        platform: 'MICROSOFT',
      }),
      seat({
        email: 'soon@example.info',
        lifecycle: 'scheduled_for_cancellation',
        workspaceId: 'ws-sales',
        cancelDate: '2026-11-15',
        provider: 'inboxkit_google',
      }),
    ],
    slAccounts: [{ id: 77, email: 'soon@example.info', clientId: 345263 }],
    ownershipByEmail: new Map([
      ['new@example.info', { client: 345263, genericDedicated: true, powergryd: false, known: true }],
      ['soon@example.info', { client: 345263, genericDedicated: true, powergryd: false, known: true }],
    ]),
    now,
    existing: [],
    persist: false,
  });
  const bought = synced.rows.find((r) => r.email === 'new@example.info');
  const scheduled = synced.rows.find((r) => r.email === 'soon@example.info');
  assert.equal(bought?.status, 'bought');
  assert.equal(bought?.ik_workspace_id, 'ws-sales');
  assert.equal(bought?.provider, 'inboxkit_m365');
  assert.equal(bought?.powergryd, false);
  assert.equal(bought?.generic_dedicated, true);
  assert.equal(scheduled?.status, 'scheduled_cancel');
  assert.equal(scheduled?.sl_account_id, 77);
  assert.equal(scheduled?.scheduled_cancel_at, '2026-11-15');
  assert.equal(scheduled?.scheduled_cancel_due_at, '2026-11-16T00:00:00.000Z');
  assert.ok(synced.events.some((e) => e.type === 'new_buy' && e.email === 'new@example.info'));
  assert.ok(
    synced.events.some(
      (e) => e.type === 'scheduled_cancel' && e.email === 'soon@example.info' && e.cancel_date === '2026-11-15',
    ),
  );
  assert.ok(!synced.rows.some((r) => (r.status as string) === 'in_sl'));
});

test('GET /api/ledger defaults to counts + ≤10 samples; export=1 returns full JSON', () => {
  const rows: SeatLedgerRow[] = Array.from({ length: 15 }, (_, i) => ({
    email: `user${i}@example.info`,
    domain: 'example.info',
    provider: i % 2 ? 'inboxkit_m365' : 'inboxkit_google',
    client: i === 0 ? GENERIC_CLIENT : 345263,
    powergryd: false,
    ik_workspace_id: 'ws-1',
    status: 'bought',
    updated_at: '2026-10-05T13:00:00.000Z',
  }));
  const summary = buildLedgerResponse(parseLedgerQuery({}), rows);
  assert.equal(summary.ok, true);
  assert.equal(summary.counts.total, 15);
  assert.equal(summary.samples.length, STATUS_SAMPLE_CAP);
  assert.equal(summary.rows, undefined);

  const exported = buildLedgerResponse(parseLedgerQuery({ export: '1', client: 'generic' }), rows);
  assert.equal(exported.counts.total, 1);
  assert.equal(exported.rows?.length, 1);
  assert.equal(exported.rows?.[0]?.client, GENERIC_CLIENT);
});

test('GET /api/ledger/events?since= returns only later events', () => {
  const events = [
    {
      id: 'new_buy:a@x.info:2026-10-01T00:00:00.000Z',
      at: '2026-10-01T00:00:00.000Z',
      type: 'new_buy' as const,
      count: 1,
      domains: ['x.info'],
      client: 345263 as const,
    },
    {
      id: 'scheduled_cancel:b@x.info:2026-10-05T12:00:00.000Z',
      at: '2026-10-05T12:00:00.000Z',
      type: 'scheduled_cancel' as const,
      count: 1,
      domains: ['x.info'],
      client: GENERIC_CLIENT,
      cancel_date: '2026-11-01',
    },
  ];
  const since = buildLedgerEventsResponse(
    parseLedgerEventsQuery({ since: '2026-10-04T00:00:00.000Z' }),
    events,
  );
  assert.equal(since.count, 1);
  assert.equal(since.events[0]?.type, 'scheduled_cancel');
  assert.equal(since.events[0]?.client, GENERIC_CLIENT);
});

test('absorbCancellationLog folds the old cancel log into ledger rows', () => {
  const { rows, absorbed } = absorbCancellationLog(
    [
      {
        mailboxEmail: 'soon@example.info',
        domain: 'example.info',
        clientId: 345263,
        workspaceId: 'ws-1',
        renewalOrCancelDate: '2026-11-15',
        reason: 'scheduled',
        state: 'upcoming',
      },
    ],
    [],
    new Date('2026-10-05T13:00:00Z'),
  );
  assert.equal(absorbed, 1);
  assert.equal(rows[0]?.status, 'scheduled_cancel');
  assert.equal(rows[0]?.client, 345263);
  assert.equal(rows[0]?.renewal_date, '2026-11-15');
  assert.equal(rows[0]?.scheduled_cancel_due_at, '2026-11-16T00:00:00.000Z');
});

test('scheduled-cancel due date is persisted and survives a ledger reload', () => {
  const now = new Date('2026-10-05T13:26:00Z');
  const first = syncSeatLedger({
    seats: [
      seat({
        email: 'soon@example.info',
        lifecycle: 'scheduled_for_cancellation',
        cancelDate: '2026-11-15',
      }),
    ],
    slAccounts: [],
    ownershipByEmail: new Map([
      ['soon@example.info', { client: 345263, genericDedicated: true, powergryd: false, known: true }],
    ]),
    now,
    existing: [],
    persist: true,
  });
  assert.equal(first.rows[0]?.scheduled_cancel_due_at, '2026-11-16T00:00:00.000Z');

  const reloaded = loadSeatLedger();
  assert.equal(reloaded[0]?.scheduled_cancel_due_at, '2026-11-16T00:00:00.000Z');
  assert.equal(reloaded[0]?.scheduled_cancel_at, '2026-11-15');
});

test('due scheduled-cancel delete_ik marks the ledger row deleted', () => {
  const now = new Date('2026-10-05T13:26:00Z');
  const synced = syncSeatLedger({
    seats: [
      seat({
        email: 'due@gone.info',
        lifecycle: 'scheduled_for_cancellation',
        domain: 'gone.info',
        cancelDate: '2026-10-04',
      }),
    ],
    slAccounts: [],
    ownershipByEmail: new Map([
      ['due@gone.info', { client: 345263, genericDedicated: true, powergryd: false, known: true }],
    ]),
    actions: [
      {
        type: 'delete_ik',
        email: 'due@gone.info',
        domain: 'gone.info',
        reason: 'due cleanup',
      },
    ],
    now,
    existing: [],
    persist: false,
  });
  assert.equal(synced.rows[0]?.status, 'deleted');
  assert.equal(synced.rows[0]?.scheduled_cancel_due_at, '2026-10-05T00:00:00.000Z');
});

test('lapse_handoff emits a Deliverability lapse event and marks lapsed', () => {
  const now = new Date('2026-10-05T13:26:00Z');
  const synced = syncSeatLedger({
    seats: [
      seat({
        email: 'linked@stay.info',
        lifecycle: 'scheduled_for_cancellation',
        cancelDate: '2026-10-01',
      }),
    ],
    slAccounts: [{ id: 22, email: 'linked@stay.info', clientId: 345263 }],
    ownershipByEmail: new Map([
      ['linked@stay.info', { client: 345263, genericDedicated: true, powergryd: false, known: true }],
    ]),
    actions: [
      {
        type: 'lapse_handoff',
        email: 'linked@stay.info',
        reason: 'campaign-linked',
        domain: 'example.info',
      },
    ],
    now,
    existing: [],
    persist: false,
  });
  assert.equal(synced.rows[0]?.status, 'lapsed');
  assert.ok(synced.events.some((e) => e.type === 'lapse' && e.email === 'linked@stay.info'));
});

test('ledgerForbidsClientAssign is true for generic and PowerGRYD rows', () => {
  const rows: SeatLedgerRow[] = [
    {
      email: 'pool@neutral.info',
      domain: 'neutral.info',
      provider: 'inboxkit_google',
      client: GENERIC_CLIENT,
      powergryd: false,
      ik_workspace_id: 'ws-mixed',
      status: 'warming',
      updated_at: '2026-10-05T13:00:00.000Z',
    },
    {
      email: 'pg@x.info',
      domain: 'x.info',
      provider: 'inboxkit_google',
      client: 592842,
      powergryd: true,
      ik_workspace_id: 'ws-mixed',
      status: 'warm',
      updated_at: '2026-10-05T13:00:00.000Z',
    },
  ];
  assert.equal(ledgerForbidsClientAssign('pool@neutral.info', rows), true);
  assert.equal(ledgerForbidsClientAssign('pg@x.info', rows), true);
  assert.equal(ledgerForbidsClientAssign('other@x.info', rows), false);
});
