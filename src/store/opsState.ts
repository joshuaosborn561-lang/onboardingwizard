import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { CancellationLogState } from '../pipeline/inventoryPlan.js';
import type { ExportErrorClass } from '../lib/exportErrors.js';

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
  source: 'job' | 'manual' | 'name_match';
  updatedAt: string;
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
  [key: string]: { lastAlertedAt: string };
}

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function shouldAlert(key: string, now = Date.now()): boolean {
  const file = path.join(opsDir(), 'alert-cooldown.json');
  const store = readJson<AlertStore>(file, {});
  const prev = store[key];
  if (prev && now - Date.parse(prev.lastAlertedAt) < ALERT_COOLDOWN_MS) return false;
  store[key] = { lastAlertedAt: new Date(now).toISOString() };
  writeJson(file, store);
  return true;
}
