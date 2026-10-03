import type { DomainKind } from '../lib/namingGuards.js';
import { STATUS_SAMPLE_CAP } from '../lib/standards.js';
import type { Platform } from '../types.js';

export type PersonaRenameStep =
  | 'planned'
  | 'await_approval'
  | 'applying'
  | 'completed'
  | 'failed';

export interface PersonaRenameItem {
  mailboxUid: string;
  workspaceId: string;
  platform: Platform | string;
  mailboxStatus: string;
  oldEmail: string;
  oldUsername: string;
  oldFirstName: string;
  oldLastName: string;
  newEmail: string;
  newUsername: string;
  newFirstName: string;
  newLastName: string;
  reasons: string[];
  changeUsername: boolean;
  domainKind?: DomainKind;
  smartleadAccountId?: number;
  smartleadClientId?: number | null;
  skipSmartlead?: boolean;
  skipReason?: string;
  inboxkitNameUpdated?: boolean;
  inboxkitUsernameUpdated?: boolean;
  smartleadUpdated?: boolean;
  smartleadEmailStale?: boolean;
  microsoftExportQueued?: boolean;
  googleAccountAdded?: boolean;
  error?: string;
}

export interface PersonaRenameSkip {
  uid?: string;
  email?: string;
  reason: string;
}

export interface PersonaRenameJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PersonaRenameStep;
  dryRun: boolean;
  approvedAt?: string;
  inboxkitWorkspaceId: string;
  onboardingJobId?: string;
  companyName: string;
  clientName: string;
  forbiddenTokens: string[];
  scannedCount: number;
  items: PersonaRenameItem[];
  skipped: PersonaRenameSkip[];
  suggestedGenericDomains?: string[];
  logs: Array<{ at: string; message: string }>;
  slackApprovals?: Partial<
    Record<
      string,
      {
        channel: string;
        ts: string;
        bodyBlocks: Array<Record<string, unknown>>;
        text: string;
      }
    >
  >;
  error?: { message: string };
}

export const PERSONA_RENAME_SAMPLE_LIMIT = STATUS_SAMPLE_CAP;
