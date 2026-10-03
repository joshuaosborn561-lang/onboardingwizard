/**
 * InboxKit → Smartlead Microsoft export error classification.
 * Permanent errors are not retried past the first recorded failure.
 */

export type ExportErrorClass = 'permanent' | 'transient';

const PERMANENT = [
  /connection blocked by microsoft/i,
  /blocked by microsoft/i,
  /account disabled/i,
  /mailbox not found/i,
  /user not found/i,
  /invalid credentials/i,
  /access denied/i,
  /forbidden/i,
];

const TRANSIENT = [
  /connection couldn['’]?t be verified/i,
  /connection could not be verified/i,
  /couldn['’]?t be verified/i,
  /timeout/i,
  /timed out/i,
  /temporar/i,
  /try again/i,
  /rate limit/i,
  /429/,
  /5\d\d/,
  /network/i,
  /econnreset/i,
  /not yet visible/i,
];

export function classifyExportError(message: string | undefined | null): ExportErrorClass {
  const text = String(message || '').trim();
  if (!text) return 'transient';
  if (PERMANENT.some((re) => re.test(text))) return 'permanent';
  if (TRANSIENT.some((re) => re.test(text))) return 'transient';
  return 'transient';
}

export const TRANSIENT_RETRY_CAP = 8;
export const PERMANENT_RETRY_CAP = 1;

/** Backoff minutes after attempt n (1-based). */
export const RETRY_BACKOFF_MINUTES = [15, 30, 60, 120, 240, 480, 480, 480] as const;

export function nextRetryAt(attempts: number, from: Date = new Date()): Date {
  const idx = Math.max(0, Math.min(RETRY_BACKOFF_MINUTES.length - 1, attempts - 1));
  return new Date(from.getTime() + RETRY_BACKOFF_MINUTES[idx]! * 60_000);
}

export function retryCapFor(errorClass: ExportErrorClass): number {
  return errorClass === 'permanent' ? PERMANENT_RETRY_CAP : TRANSIENT_RETRY_CAP;
}
