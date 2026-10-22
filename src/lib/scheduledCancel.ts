import { SCHEDULED_CANCEL_DUE_OFFSET_DAYS } from './standards.js';
import { addUtcDays } from '../store/seatLedger.js';

/** Persistable due date = InboxKit cancel/renewal date + 1 day. */
export function scheduledCancelDueAt(
  cancelDate?: string,
  existingDue?: string,
): string | undefined {
  const source = cancelDate?.trim();
  if (source) {
    const parsed = Date.parse(source);
    if (Number.isFinite(parsed)) {
      return addUtcDays(source, SCHEDULED_CANCEL_DUE_OFFSET_DAYS);
    }
  }
  return existingDue?.trim() || undefined;
}

export function isScheduledCancelDue(dueAt: string | undefined, now: Date): boolean {
  if (!dueAt) return false;
  const dueMs = Date.parse(dueAt);
  return Number.isFinite(dueMs) && now.getTime() >= dueMs;
}
