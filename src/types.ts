export type JobStep =
  | 'ingest'
  | 'generate_domains'
  | 'await_porkbun'
  | 'check_domains'
  | 'await_domain_approval'
  | 'register_domains'
  | 'await_porkbun_funds'
  | 'await_inboxkit_workspace'
  | 'provision_mailboxes'
  | 'await_ns'
  | 'await_mailbox_plan'
  | 'buy_mailboxes'
  | 'await_mailboxes'
  | 'await_smartlead_load'
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
    }
  | {
      type: 'domain_approval';
      message: string;
      availableDomains: Array<{
        domain: string;
        costCents?: number;
      }>;
      /** Preferred batch to approve from Slack (usually 20). */
      recommendedDomains: string[];
      suggestedInboxCount: number;
      suggestedGoogleRatio: number;
    }
  | {
      type: 'porkbun_funds';
      message: string;
      remainingDomains: string[];
      registeredCount: number;
      estimatedCostUsd?: number;
      balanceUsd?: number;
    }
  | {
      type: 'mailbox_plan';
      message: string;
      plan: MailboxPlanSlot[];
      googleCount: number;
      microsoftCount: number;
    }
  | {
      type: 'smartlead_load';
      message: string;
      mailboxCount: number;
      sampleSignatures: string[];
    };

export type Platform = 'GOOGLE' | 'MICROSOFT';

/** One planned inbox: domain + platform + pre-assigned unique identity. */
export interface MailboxPlanSlot {
  domain: string;
  platform: Platform;
  firstName: string;
  lastName: string;
  username: string;
}

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
  selected?: boolean;
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
  /** Client main site — Porkbun/InboxKit domains forward here. */
  forwardToUrl: string;
  /** Company line in Smartlead signature (First Last\\nCompany). */
  companyName: string;
  inboxCount: number;
  googleRatio: number;
  /** When true, pause for human approval before register / buy / Smartlead. */
  manualApproval: boolean;
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
  /** Platform + identity assignment per inbox, set before NS wait / buy. */
  mailboxPlan?: MailboxPlanSlot[];
  mailboxes: MailboxRecord[];
  smartleadClientId?: number;
  /** Slack approval message refs so we can remove buttons after approve. */
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
  forwardToUrl: string;
  companyName: string;
  inboxCount: number;
  googleRatio: number;
  manualApproval?: boolean;
}): OnboardingJob {
  const now = new Date().toISOString();
  return {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    status: 'ingest',
    websiteUrl: input.websiteUrl,
    forwardToUrl: input.forwardToUrl,
    companyName: input.companyName,
    inboxCount: input.inboxCount,
    googleRatio: input.googleRatio,
    manualApproval: input.manualApproval !== false,
    candidates: [],
    registeredDomains: [],
    pendingPrompt: null,
    inboxkitOrderIds: [],
    expectedMailboxCount: 0,
    mailboxes: [],
    logs: [],
  };
}
