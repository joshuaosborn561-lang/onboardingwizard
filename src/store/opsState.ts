import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { CancellationLogState } from '../pipeline/inventoryPlan.js';
import type { ExportErrorClass } from '../lib/exportErrors.js';
import { CHICAGO_TIME_ZONE, isChicagoWeekday } from '../lib/standards.js';

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

export interface CancellationLogEntry {
  mailboxEmail: string;
  domain: string;
  clientId?: number;
  ikStatus: string;
  workspaceId: string;
  workspaceName?: string;
  renewalOrCancelDate?: string;
  reason: string;
  state: CancellationLogState;
  updatedAt: string;
}

export interface WorkspaceClientBinding {
  smartleadClientId: number;
  name?: string;
  source: 'job' | 'manual' | 'name_match' | 'seed';
  updatedAt: string;
}

export interface PorkbunPendingAction {
  domain: string;
  reason: string;
  attempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  done?: boolean;
}

export interface RetryItem {
  key: string;
  kind: 'microsoft_export' | 'new_buy_chase';
  workspaceId: string;
  workspaceName?: string;
  mailboxUid: string;
  email: string;
  platform: 'GOOGLE' | 'MICROSOFT';
  smartleadClientId?: number;
  firstName?: string;
  lastName?: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  errorClass?: ExportErrorClass;
  nextRetryAt?: string;
  lastAttemptAt?: string;
  createdAt: string;
  done?: boolean;
  doneAt?: string;
}

export interface SweepReportFile {
  kind: 'sweep' | 'retry';
  at: string;
  dryRun: boolean;
  skipped?: string;
  chicago: { now: string; weekday: boolean };
  dwGenericSeen?: boolean;
  counts: Record<string, number>;
  samples: Record<string, string[]>;
  failures?: string[];
}

export function cancellationLogPath(): string {
  return path.join(opsDir(), 'cancellation-log.json');
}

export function loadCancellationLog(): CancellationLogEntry[] {
  return readJson<CancellationLogEntry[]>(cancellationLogPath(), []);
}

export function upsertCancellationLog(entry: CancellationLogEntry): CancellationLogEntry[] {
  const log = loadCancellationLog();
  const idx = log.findIndex(
    (row) => row.mailboxEmail.toLowerCase() === entry.mailboxEmail.toLowerCase(),
  );
  if (idx >= 0) log[idx] = { ...log[idx], ...entry };
  else log.push(entry);
  writeJson(cancellationLogPath(), log);
  return log;
}

export function loadWorkspaceClientMap(): Record<string, WorkspaceClientBinding> {
  return readJson<Record<string, WorkspaceClientBinding>>(
    path.join(opsDir(), 'workspace-client-map.json'),
    {},
  );
}

export function saveWorkspaceClientMap(map: Record<string, WorkspaceClientBinding>): void {
  writeJson(path.join(opsDir(), 'workspace-client-map.json'), map);
}

export function setWorkspaceClientBinding(
  workspaceId: string,
  binding: Omit<WorkspaceClientBinding, 'updatedAt'>,
): void {
  const map = loadWorkspaceClientMap();
  map[workspaceId] = { ...binding, updatedAt: new Date().toISOString() };
  saveWorkspaceClientMap(map);
}

export function loadRetryState(): RetryItem[] {
  return readJson<RetryItem[]>(path.join(opsDir(), 'retry-state.json'), []);
}

export function saveRetryState(items: RetryItem[]): void {
  writeJson(path.join(opsDir(), 'retry-state.json'), items);
}

export function upsertRetryItem(item: RetryItem): void {
  const items = loadRetryState();
  const idx = items.findIndex((row) => row.key === item.key);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  saveRetryState(items);
}

export function saveSweepReport(report: SweepReportFile): void {
  writeJson(path.join(opsDir(), 'last-sweep.json'), report);
}

export function loadLastSweep(): SweepReportFile | null {
  return readJson<SweepReportFile | null>(path.join(opsDir(), 'last-sweep.json'), null);
}

export function saveRetryReport(report: SweepReportFile): void {
  writeJson(path.join(opsDir(), 'last-retry.json'), report);
}

export function loadLastRetry(): SweepReportFile | null {
  return readJson<SweepReportFile | null>(path.join(opsDir(), 'last-retry.json'), null);
}

export function saveStatusSnapshot(status: unknown): void {
  writeJson(path.join(opsDir(), 'status.json'), status);
}

export function loadStatusSnapshot<T = unknown>(): T | null {
  return readJson<T | null>(path.join(opsDir(), 'status.json'), null);
}

interface AlertStore {
  [key: string]: { lastAlertedAt: string; chicagoDate?: string };
}

export function chicagoDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Stable digest key — no date or counts in the key. At most one per weekday. */
export function weekdayDigestKey(kind: 'sweep' | 'retry'): string {
  return `digest:${kind}`;
}

export function shouldSendWeekdayDigest(
  kind: 'sweep' | 'retry',
  now: Date = new Date(),
): boolean {
  if (!isChicagoWeekday(now)) return false;
  const key = weekdayDigestKey(kind);
  const file = path.join(opsDir(), 'alert-cooldown.json');
  const store = readJson<AlertStore>(file, {});
  const date = chicagoDateKey(now);
  const prev = store[key];
  if (prev?.chicagoDate === date) return false;
  store[key] = { lastAlertedAt: now.toISOString(), chicagoDate: date };
  writeJson(file, store);
  return true;
}

/** Per-item Slack dedupe. Already-alerted items are omitted. */
export function filterUnalertedItems(items: string[], now: Date = new Date()): string[] {
  const file = path.join(opsDir(), 'alert-items.json');
  const store = readJson<AlertStore>(file, {});
  const fresh: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key) continue;
    if (store[key]) continue;
    store[key] = { lastAlertedAt: now.toISOString() };
    fresh.push(key);
  }
  if (fresh.length) writeJson(file, store);
  return fresh;
}

/** @deprecated Prefer weekdayDigestKey — kept for older callers. */
export function shouldAlert(key: string, now = Date.now()): boolean {
  const file = path.join(opsDir(), 'alert-cooldown.json');
  const store = readJson<AlertStore>(file, {});
  const prev = store[key];
  if (prev) return false;
  store[key] = { lastAlertedAt: new Date(now).toISOString() };
  writeJson(file, store);
  return true;
}

export function loadPorkbunPending(): PorkbunPendingAction[] {
  return readJson<PorkbunPendingAction[]>(path.join(opsDir(), 'porkbun-pending.json'), []);
}

export function savePorkbunPending(items: PorkbunPendingAction[]): void {
  writeJson(path.join(opsDir(), 'porkbun-pending.json'), items);
}

export function upsertPorkbunPending(
  domain: string,
  reason: string,
  err?: string,
): PorkbunPendingAction {
  const now = new Date().toISOString();
  const items = loadPorkbunPending();
  const idx = items.findIndex((row) => row.domain.toLowerCase() === domain.toLowerCase() && !row.done);
  const next: PorkbunPendingAction = {
    domain: domain.toLowerCase(),
    reason,
    attempts: (idx >= 0 ? items[idx]!.attempts : 0) + (err ? 1 : 0),
    lastError: err,
    createdAt: idx >= 0 ? items[idx]!.createdAt : now,
    updatedAt: now,
    done: false,
  };
  if (idx >= 0) items[idx] = next;
  else items.push(next);
  savePorkbunPending(items);
  return next;
}

export function markPorkbunPendingDone(domain: string): void {
  const now = new Date().toISOString();
  const items = loadPorkbunPending().map((row) =>
    row.domain.toLowerCase() === domain.toLowerCase()
      ? { ...row, done: true, updatedAt: now, lastError: undefined }
      : row,
  );
  savePorkbunPending(items);
}

export function pendingPorkbunDomains(): PorkbunPendingAction[] {
  return loadPorkbunPending().filter((row) => !row.done);
}
