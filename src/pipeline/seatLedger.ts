import { scheduledCancelDueAt } from '../lib/scheduledCancel.js';
import { isPowerGrydClientId } from '../lib/standards.js';
import {
  WARM_READY_DAYS,
  absorbCancellationLog,
  addUtcDays,
  appendLedgerEvents,
  ledgerByEmail,
  ledgerProviderOf,
  loadLedgerEvents,
  loadSeatLedger,
  saveSeatLedger,
  type LedgerClient,
  type LedgerEvent,
  type LedgerProvider,
  type SeatLedgerRow,
  type SeatLedgerStatus,
} from '../store/seatLedger.js';
import { loadCancellationLog } from '../store/opsState.js';
import {
  normalizeEmail,
  type IkSeat,
  type SlAccount,
  type SweepAction,
} from './inventoryPlan.js';

export function deriveLedgerStatus(input: {
  lifecycle: IkSeat['lifecycle'];
  inSmartlead: boolean;
  slImportedAt?: string;
  now: Date;
  deleted?: boolean;
}): SeatLedgerStatus {
  if (input.deleted) return 'deleted';
  if (input.lifecycle === 'cancelled') return 'lapsed';
  if (input.lifecycle === 'scheduled_for_cancellation') return 'scheduled_cancel';
  if (input.inSmartlead && input.slImportedAt) {
    const ready = Date.parse(addUtcDays(input.slImportedAt, WARM_READY_DAYS));
    return input.now.getTime() >= ready ? 'warm' : 'warming';
  }
  if (input.inSmartlead) return 'warming';
  return 'bought';
}

export function buildLedgerEvent(input: {
  type: LedgerEvent['type'];
  at: string;
  email: string;
  domain: string;
  provider?: LedgerProvider;
  client: LedgerClient | null;
  cancelDate?: string;
  ikWorkspaceId?: string;
}): LedgerEvent {
  return {
    id: `${input.type}:${input.email}:${input.at}`,
    at: input.at,
    type: input.type,
    count: 1,
    domains: input.domain ? [input.domain] : [],
    provider: input.provider,
    client: input.client,
    cancel_date: input.cancelDate,
    email: input.email,
    ik_workspace_id: input.ikWorkspaceId,
  };
}

export function syncSeatLedger(input: {
  seats: IkSeat[];
  slAccounts: SlAccount[];
  ownershipByEmail: Map<string, { client: LedgerClient | null; genericDedicated: boolean; powergryd: boolean; known: boolean }>;
  actions?: SweepAction[];
  now?: Date;
  existing?: SeatLedgerRow[];
  persist?: boolean;
}): { rows: SeatLedgerRow[]; events: LedgerEvent[] } {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const existing = ledgerByEmail(input.existing ?? loadSeatLedger());
  const absorbed = absorbCancellationLog(loadCancellationLog(), [...existing.values()], now);
  const byEmail = ledgerByEmail(absorbed.rows);

  const slByEmail = new Map<string, SlAccount>();
  for (const account of input.slAccounts) {
    const email = normalizeEmail(account.email);
    if (email && !slByEmail.has(email)) slByEmail.set(email, account);
  }

  const deletedEmails = new Set(
    (input.actions || [])
      .filter((a) => a.type === 'delete_ik' && a.email)
      .map((a) => normalizeEmail(a.email!)),
  );
  const lapseEmails = new Set(
    (input.actions || [])
      .filter((a) => a.type === 'lapse_handoff' && a.email)
      .map((a) => normalizeEmail(a.email!)),
  );

  const events: LedgerEvent[] = [];
  const seen = new Set<string>();

  for (const seat of input.seats) {
    const email = normalizeEmail(seat.email);
    if (!email) continue;
    seen.add(email);
    const prev = byEmail.get(email);
    const sl = slByEmail.get(email);
    const ownership = input.ownershipByEmail.get(email);
    const client = ownership?.client ?? prev?.client ?? null;
    if (client == null) continue;

    const provider = seat.provider || ledgerProviderOf(seat.platform);
    const importedAt = sl ? prev?.sl_imported_at || at : prev?.sl_imported_at;
    const deleted = deletedEmails.has(email) || prev?.status === 'deleted';
    let status = deriveLedgerStatus({
      lifecycle: seat.lifecycle,
      inSmartlead: Boolean(sl),
      slImportedAt: importedAt,
      now,
      deleted,
    });
    if (!deleted && lapseEmails.has(email)) status = 'lapsed';
    const cancelDate =
      seat.lifecycle === 'scheduled_for_cancellation'
        ? seat.cancelDate || prev?.scheduled_cancel_at
        : prev?.scheduled_cancel_at;
    const dueDate =
      seat.lifecycle === 'scheduled_for_cancellation'
        ? scheduledCancelDueAt(cancelDate, prev?.scheduled_cancel_due_at)
        : prev?.scheduled_cancel_due_at;

    const row: SeatLedgerRow = {
      email,
      domain: (seat.domain || '').toLowerCase(),
      provider,
      client,
      generic_dedicated: ownership?.genericDedicated ?? prev?.generic_dedicated,
      powergryd: ownership?.powergryd === true || prev?.powergryd === true || isPowerGrydClientId(client),
      ik_workspace_id: seat.workspaceId,
      sl_account_id: sl?.id ?? prev?.sl_account_id,
      bought_at: prev?.bought_at || at,
      sl_imported_at: importedAt,
      warm_ready_at: importedAt ? addUtcDays(importedAt, WARM_READY_DAYS) : prev?.warm_ready_at,
      scheduled_cancel_at: cancelDate,
      scheduled_cancel_due_at: dueDate,
      renewal_date: seat.cancelDate || prev?.renewal_date,
      status,
      cancel_reason: prev?.cancel_reason,
      cancel_state:
        status === 'scheduled_cancel'
          ? 'upcoming'
          : status === 'lapsed'
            ? 'due'
            : status === 'deleted'
              ? 'deleted_IK'
              : prev?.cancel_state,
      updated_at: at,
    };
    byEmail.set(email, row);

    if (row.powergryd) continue;
    const isNewBuy = !prev && seat.lifecycle !== 'cancelled';
    const newlyScheduled =
      seat.lifecycle === 'scheduled_for_cancellation' && prev?.status !== 'scheduled_cancel';
    if (isNewBuy) {
      events.push(
        buildLedgerEvent({
          type: 'new_buy',
          at,
          email,
          domain: row.domain,
          provider: row.provider,
          client: row.client,
          ikWorkspaceId: row.ik_workspace_id,
        }),
      );
    }
    if (newlyScheduled) {
      events.push(
        buildLedgerEvent({
          type: 'scheduled_cancel',
          at,
          email,
          domain: row.domain,
          provider: row.provider,
          client: row.client,
          cancelDate: row.scheduled_cancel_at || row.renewal_date,
          ikWorkspaceId: row.ik_workspace_id,
        }),
      );
    }
    if (lapseEmails.has(email) && prev?.status !== 'lapsed') {
      events.push(
        buildLedgerEvent({
          type: 'lapse',
          at,
          email,
          domain: row.domain,
          provider: row.provider,
          client: row.client,
          cancelDate: row.scheduled_cancel_due_at || row.scheduled_cancel_at || row.renewal_date,
          ikWorkspaceId: row.ik_workspace_id,
        }),
      );
    }
  }

  for (const [email, row] of byEmail) {
    if (seen.has(email)) continue;
    if (deletedEmails.has(email) && row.status !== 'deleted') {
      byEmail.set(email, { ...row, status: 'deleted', cancel_state: 'deleted_IK', updated_at: at });
    }
  }

  const rows = [...byEmail.values()];
  if (input.persist) {
    saveSeatLedger(rows);
    const existingEvents = new Set(loadLedgerEvents().map((e) => e.id));
    appendLedgerEvents(events.filter((e) => !existingEvents.has(e.id)));
  }
  return { rows, events };
}
