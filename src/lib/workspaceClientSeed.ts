import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPowerGrydClientId, POWERGRYD_SMARTLEAD_CLIENT_ID } from './standards.js';

export type SeedWorkspaceStatus = 'mapped' | 'mixed' | 'unknown';

export interface SeedWorkspace {
  inboxkitWorkspaceId: string;
  inboxkitWorkspaceName: string;
  smartleadClientId: number | null;
  smartleadClientName: string | null;
  status: SeedWorkspaceStatus;
}

export interface WorkspaceClientSeed {
  excludedSmartleadClientId: number;
  workspaces: SeedWorkspace[];
}

export const DW_GENERIC_WORKSPACE_ID = '81e7f800-4203-4892-a40d-18648b89b90c';

function seedPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../data/workspace-client-seed.json');
}

let cached: WorkspaceClientSeed | null = null;

export function loadWorkspaceClientSeed(): WorkspaceClientSeed {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(seedPath(), 'utf8')) as WorkspaceClientSeed;
  cached = {
    excludedSmartleadClientId: raw.excludedSmartleadClientId ?? POWERGRYD_SMARTLEAD_CLIENT_ID,
    workspaces: (raw.workspaces || []).filter(
      (row) => !isPowerGrydClientId(row.smartleadClientId),
    ),
  };
  return cached;
}

export function seedWorkspaceById(): Map<string, SeedWorkspace> {
  const map = new Map<string, SeedWorkspace>();
  for (const row of loadWorkspaceClientSeed().workspaces) {
    map.set(row.inboxkitWorkspaceId, row);
  }
  return map;
}

export function seedMappedClientIds(): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of loadWorkspaceClientSeed().workspaces) {
    if (row.status !== 'mapped') continue;
    if (row.smartleadClientId == null || isPowerGrydClientId(row.smartleadClientId)) continue;
    map.set(row.inboxkitWorkspaceId, row.smartleadClientId);
  }
  return map;
}

export function seedMixedWorkspaceIds(): Set<string> {
  const ids = new Set<string>();
  for (const row of loadWorkspaceClientSeed().workspaces) {
    if (row.status === 'mixed') ids.add(row.inboxkitWorkspaceId);
  }
  ids.add(DW_GENERIC_WORKSPACE_ID);
  return ids;
}

export function seedClientNameById(): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of loadWorkspaceClientSeed().workspaces) {
    if (row.smartleadClientId == null || !row.smartleadClientName) continue;
    if (isPowerGrydClientId(row.smartleadClientId)) continue;
    map.set(row.smartleadClientId, row.smartleadClientName);
  }
  return map;
}

export function isMixedWorkspace(workspaceId?: string, workspaceName?: string): boolean {
  if (workspaceId && seedMixedWorkspaceIds().has(workspaceId)) return true;
  const name = String(workspaceName || '').toLowerCase();
  return name.includes('dw generic');
}
