import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POWERGRYD_SMARTLEAD_CLIENT_ID } from '../lib/standards.js';
import {
  classifyIkLifecycle,
  planInventoryActions,
  type IkSeat,
  type SlAccount,
} from './inventoryPlan.js';

function seat(partial: Partial<IkSeat> & Pick<IkSeat, 'email' | 'lifecycle'>): IkSeat {
  return {
    uid: partial.uid || partial.email,
    workspaceId: partial.workspaceId || 'ws-1',
    workspaceName: partial.workspaceName || 'Acme',
    domain: partial.domain || 'example.info',
    platform: partial.platform || 'GOOGLE',
    status: partial.status || partial.lifecycle,
    firstName: partial.firstName || 'Marcus',
    lastName: partial.lastName || 'Whitaker',
    username: partial.username || 'marcus',
    ...partial,
  };
}

test('classify scheduled_for_cancellation before cancelled/active', () => {
  assert.equal(
    classifyIkLifecycle('active', 'scheduled'),
    'scheduled_for_cancellation',
  );
  assert.equal(classifyIkLifecycle('scheduled_for_cancellation'), 'scheduled_for_cancellation');
  assert.equal(classifyIkLifecycle('cancelled'), 'cancelled');
  assert.equal(classifyIkLifecycle('active'), 'active');
  assert.equal(classifyIkLifecycle('provisioning'), 'other');
});

test('ACTIVE missing from Smartlead plans Google import or Microsoft export', () => {
  const map = new Map<string, number>([['ws-1', 100]]);
  const planned = planInventoryActions({
    seats: [
      seat({ email: 'marcus@example.info', lifecycle: 'active', platform: 'GOOGLE' }),
      seat({
        email: 'elena@example.info',
        uid: 'ms-1',
        lifecycle: 'active',
        platform: 'MICROSOFT',
      }),
    ],
    slAccounts: [],
    workspaceClientId: map,
  });
  assert.equal(planned.actions.filter((a) => a.type === 'import_google').length, 1);
  assert.equal(planned.actions.filter((a) => a.type === 'export_microsoft').length, 1);
  assert.deepEqual(
    planned.actions.map((a) => a.email).sort(),
    ['elena@example.info', 'marcus@example.info'],
  );
});

test('already in Smartlead with warmup and matching client is a no-op', () => {
  const planned = planInventoryActions({
    seats: [seat({ email: 'marcus@example.info', lifecycle: 'active' })],
    slAccounts: [{ id: 9, email: 'marcus@example.info', clientId: 100, warmupEnabled: true }],
    workspaceClientId: new Map([['ws-1', 100]]),
  });
  assert.deepEqual(planned.actions, []);
  assert.equal(planned.needsDecision.length, 0);
});

test('CANCELLED deletes IK + SL; Porkbun off only when every seat on the domain is cancelled', () => {
  const seats = [
    seat({
      email: 'a@gone.info',
      lifecycle: 'cancelled',
      domain: 'gone.info',
      uid: 'a',
    }),
    seat({
      email: 'b@gone.info',
      lifecycle: 'cancelled',
      domain: 'gone.info',
      uid: 'b',
    }),
    seat({
      email: 'keep@stay.info',
      lifecycle: 'cancelled',
      domain: 'stay.info',
      uid: 'c',
    }),
    seat({
      email: 'live@stay.info',
      lifecycle: 'active',
      domain: 'stay.info',
      uid: 'd',
    }),
  ];
  const sl: SlAccount[] = [
    { id: 1, email: 'a@gone.info', clientId: 100 },
    { id: 2, email: 'keep@stay.info', clientId: 100 },
  ];
  const planned = planInventoryActions({
    seats,
    slAccounts: sl,
    workspaceClientId: new Map([['ws-1', 100]]),
  });
  assert.equal(planned.actions.filter((a) => a.type === 'delete_ik').length, 3);
  assert.equal(planned.actions.filter((a) => a.type === 'delete_sl').length, 2);
  const porkbun = planned.actions.filter((a) => a.type === 'porkbun_autorenew_off');
  assert.deepEqual(porkbun.map((a) => a.domain), ['gone.info']);
  assert.ok(!porkbun.some((a) => a.domain === 'stay.info'));
});

test('scheduled_for_cancellation is left alone and only logged as upcoming', () => {
  const planned = planInventoryActions({
    seats: [
      seat({
        email: 'soon@example.info',
        lifecycle: 'scheduled_for_cancellation',
        status: 'active',
        cancellationStatus: 'scheduled',
      }),
    ],
    slAccounts: [{ id: 3, email: 'soon@example.info', clientId: 100, warmupEnabled: true }],
    workspaceClientId: new Map([['ws-1', 100]]),
  });
  assert.equal(planned.actions.filter((a) => a.type === 'log_cancellation').length, 1);
  assert.equal(planned.actions[0]?.logState, 'upcoming');
  assert.equal(planned.actions.filter((a) => a.type === 'delete_ik' || a.type === 'delete_sl').length, 0);
  assert.equal(planned.actions.filter((a) => a.type === 'import_google').length, 0);
});

test('PowerGRYD seats are skipped and never imported or deleted', () => {
  const planned = planInventoryActions({
    seats: [
      seat({
        email: 'pg@example.info',
        lifecycle: 'cancelled',
        workspaceId: 'ws-pg',
      }),
      seat({ email: 'pg-active@example.info', lifecycle: 'active', workspaceId: 'ws-pg' }),
    ],
    slAccounts: [
      {
        id: 4,
        email: 'pg@example.info',
        clientId: POWERGRYD_SMARTLEAD_CLIENT_ID,
      },
    ],
    workspaceClientId: new Map([['ws-pg', POWERGRYD_SMARTLEAD_CLIENT_ID]]),
  });
  assert.ok(planned.actions.every((a) => a.type !== 'delete_ik' && a.type !== 'import_google'));
  assert.ok(planned.skipped.some((s) => s.reason.includes('PowerGRYD')));
});

test('pending job Smartlead-load approval blocks import', () => {
  const planned = planInventoryActions({
    seats: [seat({ email: 'new@example.info', lifecycle: 'active' })],
    slAccounts: [],
    workspaceClientId: new Map([['ws-1', 100]]),
    blockedEmails: new Set(['new@example.info']),
  });
  assert.equal(planned.actions.length, 0);
  assert.ok(planned.needsDecision.some((d) => /Smartlead load approval/i.test(d.reason)));
});

test('never re-tags an account that already has a client', () => {
  const planned = planInventoryActions({
    seats: [seat({ email: 'marcus@example.info', lifecycle: 'active' })],
    slAccounts: [{ id: 9, email: 'marcus@example.info', clientId: 200, warmupEnabled: true }],
    workspaceClientId: new Map([['ws-1', 100]]),
  });
  assert.equal(planned.actions.filter((a) => a.type === 'tag_client').length, 0);
  assert.ok(planned.needsDecision.some((d) => /will not re-tag/i.test(d.reason)));
});

test('only tags untagged accounts from a single-client workspace', () => {
  const planned = planInventoryActions({
    seats: [seat({ email: 'marcus@example.info', lifecycle: 'active' })],
    slAccounts: [{ id: 9, email: 'marcus@example.info', warmupEnabled: true }],
    workspaceClientId: new Map([['ws-1', 100]]),
    clientNameById: new Map([[100, 'Acme Co']]),
  });
  const tags = planned.actions.filter((a) => a.type === 'tag_client');
  assert.equal(tags.length, 1);
  assert.equal(tags[0]?.smartleadClientId, 100);
  assert.equal(tags[0]?.clientName, 'Acme Co');
});

test('unmapped and MIXED seats are flagged and never imported untagged', () => {
  const unmapped = planInventoryActions({
    seats: [seat({ email: 'open@example.info', lifecycle: 'active', workspaceId: 'ws-unknown' })],
    slAccounts: [],
    workspaceClientId: new Map(),
  });
  assert.equal(unmapped.actions.filter((a) => a.type === 'import_google').length, 0);
  assert.ok(unmapped.needsDecision.some((d) => /Unmapped/i.test(d.reason)));

  const mixed = planInventoryActions({
    seats: [
      seat({
        email: 'pool@example.info',
        lifecycle: 'active',
        workspaceId: 'ws-mixed',
        workspaceName: 'DW Generic Pool',
      }),
    ],
    slAccounts: [],
    workspaceClientId: new Map([['ws-mixed', 100]]),
    mixedWorkspaceIds: new Set(['ws-mixed']),
  });
  assert.equal(mixed.actions.filter((a) => a.type === 'import_google' || a.type === 'tag_client').length, 0);
  assert.ok(mixed.needsDecision.some((d) => /MIXED/i.test(d.reason)));
});

test('PowerGRYD domains are excluded even when the seat is not in Smartlead', () => {
  const planned = planInventoryActions({
    seats: [
      seat({
        email: 'new@pg-domain.info',
        lifecycle: 'active',
        domain: 'pg-domain.info',
        workspaceId: 'ws-1',
      }),
    ],
    slAccounts: [
      {
        id: 4,
        email: 'existing@pg-domain.info',
        clientId: POWERGRYD_SMARTLEAD_CLIENT_ID,
      },
    ],
    workspaceClientId: new Map([['ws-1', 100]]),
  });
  assert.equal(planned.actions.length, 0);
  assert.ok(planned.skipped.some((s) => s.reason.includes('PowerGRYD')));
});

test('plan is idempotent when re-run against the same inventory', () => {
  const input = {
    seats: [seat({ email: 'marcus@example.info', lifecycle: 'active' })],
    slAccounts: [{ id: 9, email: 'marcus@example.info', clientId: 100, warmupEnabled: true }],
    workspaceClientId: new Map([['ws-1', 100]]),
  };
  const first = planInventoryActions(input);
  const second = planInventoryActions(input);
  assert.deepEqual(first, second);
});
