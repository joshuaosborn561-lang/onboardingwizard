import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import {
  capSamples,
  isPowerGrydClientId,
  SCHEDULED_CANCEL_DUE_OFFSET_DAYS,
  STATUS_SAMPLE_CAP,
} from '../lib/standards.js';

export interface AbsorbableCancelLog {
  mailboxEmail: string;
  domain: string;
  clientId?: number;
  workspaceId: string;
  renewalOrCancelDate?: string;
  reason: string;
  state: string;
}

export const GENERIC_CLIENT = 'generic' as const;
export const GENERIC_SMARTLEAD_TAG = 'GENERIC';
export const WARM_READY_DAYS = 21;

export type LedgerClient = number | typeof GENERIC_CLIENT;
export type LedgerProvider = 'inboxkit_google' | 'inboxkit_m365' | 'inboxkit_azure';
export type SeatLedgerStatus =
  | 'bought'
  | 'warming'
  | 'warm'
  | 'scheduled_cancel'
  | 'lapsed'
  | 'deleted';

export type LedgerEventType = 'new_buy' | 'scheduled_cancel' | 'lapse';

export interface SeatLedgerRow {
  email: string;
  domain: string;
  provider: LedgerProvider;
  client: LedgerClient;
  generic_dedicated?: boolean;
  powergryd: boolean;
  ik_workspace_id: string;
  sl_account_id?: number;
  bought_at?: string;
  sl_imported_at?: string;
  warm_ready_at?: string;
  scheduled_cancel_at?: string;
  /** cancel/renewal date + 1 day; persisted so due cleanup survives restarts. */
  scheduled_cancel_due_at?: string;
  renewal_date?: string;
  status: SeatLedgerStatus;
  cancel_reason?: string;
  /** Free-text ledger note (e.g. `reserved: Gabe Lopez`). */
  note?: string;
  cancel_state?: string;
  updated_at: string;
}

export interface LedgerEvent {
  id: string;
  at: string;
  type: LedgerEventType;
  count: number;
  domains: string[];
  provider?: LedgerProvider;
  client: LedgerClient | null;
  cancel_date?: string;
  email?: string;
  ik_workspace_id?: string;
}

export interface LedgerQuery {
  status?: string;
  client?: string;
  provider?: string;
  domain?: string;
  email?: string;
  workspace?: string;
  powergryd?: boolean;
  exportAll?: boolean;
}

export interface LedgerEventsQuery {
  since?: string;
  exportAll?: boolean;
}

function opsDir(): string {
  const dir = path.resolve(config.dataDir, 'ops');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

export function seatLedgerPath(): string {
  return path.join(opsDir(), 'seat-ledger.json');
}

export function ledgerEventsPath(): string {
  return path.join(opsDir(), 'ledger-events.json');
}

export function isGenericClient(client: unknown): client is typeof GENERIC_CLIENT {
  return client === GENERIC_CLIENT || client === 'GENERIC';
}

export function parseLedgerClient(value: unknown): LedgerClient | null {
  if (isGenericClient(value)) return GENERIC_CLIENT;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ledgerProviderOf(raw?: string): LedgerProvider {
  const p = String(raw || '').toUpperCase();
  if (p.includes('AZURE')) return 'inboxkit_azure';
  if (
    p.includes('MICROSOFT') ||
    p.includes('OUTLOOK') ||
    p === 'MS' ||
    p === 'M365' ||
    p.includes('OFFICE')
  ) {
    return 'inboxkit_m365';
  }
  return 'inboxkit_google';
}

export function addUtcDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function loadSeatLedger(): SeatLedgerRow[] {
  return readJson<SeatLedgerRow[]>(seatLedgerPath(), []);
}

export function saveSeatLedger(rows: SeatLedgerRow[]): void {
  writeJson(seatLedgerPath(), rows);
}

export function loadLedgerEvents(): LedgerEvent[] {
  return readJson<LedgerEvent[]>(ledgerEventsPath(), []);
}

export function saveLedgerEvents(events: LedgerEvent[]): void {
  writeJson(ledgerEventsPath(), events);
}

export function ledgerByEmail(rows: SeatLedgerRow[] = loadSeatLedger()): Map<string, SeatLedgerRow> {
  const map = new Map<string, SeatLedgerRow>();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (email) map.set(email, row);
  }
  return map;
}

export function loadSeatByEmail(email: string): SeatLedgerRow | undefined {
  return ledgerByEmail().get(email.trim().toLowerCase());
}

/** Deliverability owns client_id on free-pool generics — never assign/fix it. */
export function ledgerForbidsClientAssign(email: string, rows?: SeatLedgerRow[]): boolean {
  const row = (rows ? ledgerByEmail(rows) : ledgerByEmail()).get(email.trim().toLowerCase());
  if (!row) return false;
  return row.client === GENERIC_CLIENT || row.powergryd === true || isPowerGrydClientId(row.client);
}

export function upsertSeatLedger(row: SeatLedgerRow, rows?: SeatLedgerRow[]): SeatLedgerRow[] {
  const list = rows ?? loadSeatLedger();
  const email = row.email.trim().toLowerCase();
  const next = { ...row, email };
  const idx = list.findIndex((item) => item.email.toLowerCase() === email);
  if (idx >= 0) list[idx] = { ...list[idx], ...next };
  else list.push(next);
  saveSeatLedger(list);
  return list;
}

export function appendLedgerEvents(events: LedgerEvent[]): LedgerEvent[] {
  if (!events.length) return loadLedgerEvents();
  const all = loadLedgerEvents();
  const seen = new Set(all.map((e) => e.id));
  for (const event of events) {
    if (seen.has(event.id)) continue;
    all.push(event);
    seen.add(event.id);
  }
  saveLedgerEvents(all);
  return all;
}

function rowMatches(row: SeatLedgerRow, query: LedgerQuery): boolean {
  if (query.status && row.status !== query.status) return false;
  if (query.provider && row.provider !== query.provider) return false;
  if (query.domain && row.domain.toLowerCase() !== query.domain.toLowerCase()) return false;
  if (query.email && row.email.toLowerCase() !== query.email.toLowerCase()) return false;
  if (query.workspace && row.ik_workspace_id !== query.workspace) return false;
  if (query.powergryd === true && !row.powergryd) return false;
  if (query.powergryd === false && row.powergryd) return false;
  if (query.client) {
    if (isGenericClient(query.client)) {
      if (row.client !== GENERIC_CLIENT) return false;
    } else if (String(row.client) !== String(query.client)) {
      return false;
    }
  }
  return true;
}

export function parseLedgerQuery(input: Record<string, unknown>): LedgerQuery {
  const flag = input.export ?? input.full;
  const power = input.powergryd;
  return {
    status: input.status != null ? String(input.status) : undefined,
    client: input.client != null ? String(input.client) : undefined,
    provider: input.provider != null ? String(input.provider) : undefined,
    domain: input.domain != null ? String(input.domain) : undefined,
    email: input.email != null ? String(input.email) : undefined,
    workspace: input.workspace != null ? String(input.workspace) : undefined,
    powergryd:
      power === true || power === 'true' || power === '1'
        ? true
        : power === false || power === 'false' || power === '0'
          ? false
          : undefined,
    exportAll: flag === true || flag === 'true' || flag === '1' || flag === 'yes',
  };
}

export function parseLedgerEventsQuery(input: Record<string, unknown>): LedgerEventsQuery {
  const flag = input.export ?? input.full;
  return {
    since: input.since != null && String(input.since).trim() ? String(input.since) : undefined,
    exportAll: flag === true || flag === 'true' || flag === '1' || flag === 'yes',
  };
}

export function buildLedgerResponse(
  query: LedgerQuery,
  rows: SeatLedgerRow[] = loadSeatLedger(),
): {
  ok: true;
  counts: {
    total: number;
    byStatus: Record<string, number>;
    byClient: Record<string, number>;
    byProvider: Record<string, number>;
  };
  filters: LedgerQuery;
  samples: SeatLedgerRow[];
  rows?: SeatLedgerRow[];
} {
  const matched = rows.filter((row) => rowMatches(row, query));
  const byStatus: Record<string, number> = {};
  const byClient: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const row of matched) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    const clientKey = String(row.client);
    byClient[clientKey] = (byClient[clientKey] || 0) + 1;
    byProvider[row.provider] = (byProvider[row.provider] || 0) + 1;
  }
  const body: {
    ok: true;
    counts: {
      total: number;
      byStatus: Record<string, number>;
      byClient: Record<string, number>;
      byProvider: Record<string, number>;
    };
    filters: LedgerQuery;
    samples: SeatLedgerRow[];
    rows?: SeatLedgerRow[];
  } = {
    ok: true,
    counts: { total: matched.length, byStatus, byClient, byProvider },
    filters: query,
    samples: capSamples(matched, STATUS_SAMPLE_CAP),
  };
  if (query.exportAll) body.rows = matched;
  return body;
}

export function buildLedgerEventsResponse(
  query: LedgerEventsQuery,
  events: LedgerEvent[] = loadLedgerEvents(),
): {
  ok: true;
  since: string | null;
  count: number;
  samples: LedgerEvent[];
  events: LedgerEvent[];
} {
  const sinceMs = query.since ? Date.parse(query.since) : NaN;
  const matched = events.filter((event) => {
    if (!Number.isFinite(sinceMs)) return true;
    return Date.parse(event.at) >= sinceMs;
  });
  const exported = query.exportAll || Number.isFinite(sinceMs);
  return {
    ok: true,
    since: query.since || null,
    count: matched.length,
    samples: capSamples(matched, STATUS_SAMPLE_CAP),
    events: exported ? matched : capSamples(matched, STATUS_SAMPLE_CAP),
  };
}

/** Fold historical cancellation-log rows into the ledger (source of truth). */
export function absorbCancellationLog(
  log: AbsorbableCancelLog[],
  rows: SeatLedgerRow[] = loadSeatLedger(),
  now = new Date(),
): { rows: SeatLedgerRow[]; absorbed: number } {
  const byEmail = ledgerByEmail(rows);
  let absorbed = 0;
  const at = now.toISOString();
  for (const entry of log) {
    const email = String(entry.mailboxEmail || '').trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email);
    const scheduled = entry.state === 'upcoming';
    const deleted = entry.state === 'deleted_IK' || entry.state === 'deleted_SL';
    const status: SeatLedgerStatus = deleted
      ? 'deleted'
      : scheduled
        ? 'scheduled_cancel'
        : 'lapsed';
    const client = parseLedgerClient(entry.clientId) ?? existing?.client;
    if (client == null) continue;
    const next: SeatLedgerRow = {
      email,
      domain: (entry.domain || existing?.domain || '').toLowerCase(),
      provider: existing?.provider || 'inboxkit_google',
      client,
      generic_dedicated: existing?.generic_dedicated,
      powergryd: existing?.powergryd === true || isPowerGrydClientId(client),
      ik_workspace_id: entry.workspaceId || existing?.ik_workspace_id || '',
      sl_account_id: existing?.sl_account_id,
      bought_at: existing?.bought_at,
      sl_imported_at: existing?.sl_imported_at,
      warm_ready_at: existing?.warm_ready_at,
      scheduled_cancel_at: entry.renewalOrCancelDate || existing?.scheduled_cancel_at,
      scheduled_cancel_due_at: entry.renewalOrCancelDate
        ? addUtcDays(entry.renewalOrCancelDate, SCHEDULED_CANCEL_DUE_OFFSET_DAYS)
        : existing?.scheduled_cancel_due_at,
      renewal_date: entry.renewalOrCancelDate || existing?.renewal_date,
      status,
      cancel_reason: entry.reason || existing?.cancel_reason,
      note: existing?.note,
      cancel_state: entry.state,
      updated_at: at,
    };
    byEmail.set(email, existing ? { ...existing, ...next, updated_at: at } : next);
    absorbed += 1;
  }
  return { rows: [...byEmail.values()], absorbed };
}
