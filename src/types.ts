export type JobStep =
  | 'ingest'
  | 'generate_domains'
  | 'await_porkbun'
  | 'register_domains'
  | 'await_inboxkit_workspace'
  | 'provision_mailboxes'
  | 'await_ns'
  | 'buy_mailboxes'
  | 'await_mailboxes'
  | 'load_smartlead'
  | 'create_smartlead_client'
  | 'notify_complete'
  | 'completed'
  | 'failed';

export type PendingPrompt =
  | {
      type: 'porkbun_credentials';
      message: string;
    }
  | {
      type: 'inboxkit_workspace';
      message: string;
      reason: string;
    };

export type Platform = 'GOOGLE' | 'MICROSOFT';

export interface BrandContext {
  websiteUrl: string;
  clientName: string;
  industry: string;
  brandWords: string[];
  summary: string;
  pageTitle: string;
  pageTextSample: string;
}

export interface DomainCandidate {
  domain: string;
  available?: boolean;
  costCents?: number;
  registered?: boolean;
  error?: string;
  nameservers?: string[];
  inboxkitDomainUid?: string;
}

export interface MailboxRecord {
  uid: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  platform: Platform;
  domain: string;
  status: string;
  password?: string;
  appPassword?: string;
  smartleadAccountId?: number;
  smartleadLoaded?: boolean;
  error?: string;
}

export interface OnboardingJob {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStep;
  websiteUrl: string;
  inboxCount: number;
  googleRatio: number;
  brand?: BrandContext;
  candidates: DomainCandidate[];
  registeredDomains: string[];
  pendingPrompt?: PendingPrompt | null;
  porkbun?: {
    apiKey: string;
    secretApiKey: string;
    label?: string;
  };
  inboxkitWorkspaceId?: string;
  inboxkitOrderIds: string[];
  expectedMailboxCount: number;
  /** Platform assignment per domain, set before NS wait / buy. */
  mailboxPlan?: Array<{ domain: string; platform: Platform }>;
  mailboxes: MailboxRecord[];
  smartleadClientId?: number;
  error?: {
    step: JobStep;
    message: string;
    domain?: string;
    mailbox?: string;
  };
  logs: Array<{ at: string; message: string }>;
}

export function createEmptyJob(input: {
  id: string;
  websiteUrl: string;
  inboxCount: number;
  googleRatio: number;
}): OnboardingJob {
  const now = new Date().toISOString();
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    status: 'ingest',
    websiteUrl: input.websiteUrl,
    inboxCount: input.inboxCount,
    googleRatio: input.googleRatio,
    candidates: [],
    registeredDomains: [],
    pendingPrompt: null,
    inboxkitOrderIds: [],
    expectedMailboxCount: 0,
    mailboxes: [],
    logs: [],
  };
}
