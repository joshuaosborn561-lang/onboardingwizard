/**
 * Coordinate onboarding sweep deletes with Deliverability wizard PR #275
 * (Monday 8:16am CT InboxKit license sweep). Reads are optional; never spend.
 */

import { chicagoDateKey } from '../store/opsState.js';

export const GABE_LOPEZ_RESERVED_NOTE = 'reserved: Gabe Lopez';

export interface DeliverabilityHandoffSeat {
  email?: string;
  inboxkitStatus?: string;
  cancelDate?: string | null;
  slAccountId?: number | null;
}

export interface DeliverabilityHandoffClient {
  clientId?: number | null;
  clientName?: string;
  stillConnected?: DeliverabilityHandoffSeat[];
  upcomingCancellations?: DeliverabilityHandoffSeat[];
}

/** Shape of `inboxkitLicenseHandoff` on Deliverability /health (D226). */
export interface DeliverabilityLicenseHandoff {
  at: string;
  ymd: string;
  deleted: number;
  deletedEmails: string[];
  clients: DeliverabilityHandoffClient[];
}

export function isGabeLopezReserved(row?: {
  note?: string;
  cancel_reason?: string;
} | null): boolean {
  const blob = `${row?.note || ''} ${row?.cancel_reason || ''}`;
  return /reserved:\s*gabe\s+lopez/i.test(blob);
}

export function parseDeliverabilityHandoff(raw: unknown): DeliverabilityLicenseHandoff | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<DeliverabilityLicenseHandoff>;
  if (typeof row.at !== 'string' || typeof row.ymd !== 'string') return null;
  return {
    at: row.at,
    ymd: row.ymd,
    deleted: Number.isFinite(row.deleted) ? Number(row.deleted) : 0,
    deletedEmails: Array.isArray(row.deletedEmails)
      ? row.deletedEmails.map((email) => String(email).trim().toLowerCase()).filter(Boolean)
      : [],
    clients: Array.isArray(row.clients) ? row.clients : [],
  };
}

function emailsFromSeats(seats: DeliverabilityHandoffSeat[] | undefined): string[] {
  return (seats || [])
    .map((seat) => String(seat.email || '').trim().toLowerCase())
    .filter(Boolean);
}

/** Seats Deliverability deletes that Chicago day (`stillConnected` + already deleted). */
export function deliverabilityOwnedEmails(
  handoff: DeliverabilityLicenseHandoff | null | undefined,
  now: Date,
): Set<string> {
  const out = new Set<string>();
  if (!handoff || handoff.ymd !== chicagoDateKey(now)) return out;
  for (const email of handoff.deletedEmails) out.add(email);
  for (const client of handoff.clients) {
    for (const email of emailsFromSeats(client.stillConnected)) out.add(email);
  }
  return out;
}

export function deliverabilityAlreadyDeleted(
  handoff: DeliverabilityLicenseHandoff | null | undefined,
  email: string,
  now: Date,
): boolean {
  if (!handoff || handoff.ymd !== chicagoDateKey(now)) return false;
  return handoff.deletedEmails.includes(email.trim().toLowerCase());
}

export function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = Number((err as { status?: unknown }).status);
    if (status === 404) return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /\b404\b|not found|does not exist|no longer exists|already deleted/i.test(message);
}

export function extractHealthHandoff(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  const rec = payload as Record<string, unknown>;
  return rec.inboxkitLicenseHandoff ?? rec.inboxkit_license_handoff ?? null;
}
