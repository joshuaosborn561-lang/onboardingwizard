import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { apiRequest } from '../lib/http.js';
import {
  assertAccountNotPowerGryd,
  assertNotPowerGryd,
  type SmartleadClientTagged,
} from '../lib/standards.js';

const BASE_URL = 'https://server.smartlead.ai/api/v1/';

async function smartlead<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
    retries?: number;
  } = {},
): Promise<T> {
  return apiRequest<T>(BASE_URL, config.smartleadApiKey(), path.replace(/^\//, ''), {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    body: options.body,
    query: options.query,
    retries: options.retries ?? 4,
  });
}

export function buildSignatureHtml(firstName: string, lastName: string, email: string): string {
  const name = `${firstName} ${lastName}`.trim();
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">${name}<br><a href="mailto:${email}">${email}</a></div>`;
}

/**
 * Smartlead signature format:
 *   First Last
 *   Company
 */
export function buildSignaturePlain(firstName: string, lastName: string, company: string): string {
  const name = `${firstName} ${lastName}`.trim();
  const brand = company.trim();
  return brand ? `${name}\n${brand}` : name;
}

export async function addEmailAccount(input: {
  fromName: string;
  fromEmail: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  type: 'GMAIL' | 'OUTLOOK';
  signature: string;
  clientId?: number;
  /** Optional Smartlead tags (e.g. GENERIC for free-pool imports). */
  tags?: string[];
}): Promise<number> {
  assertNotPowerGryd(input.clientId);
  const w = config.warmup;
  const data = await smartlead<{
    email_account?: { id?: number };
    emailAccountId?: number | string;
    id?: number;
    ok?: boolean;
    message?: string;
    warmupKey?: string;
    data?: { id?: number };
  }>('email-accounts/save', {
    method: 'POST',
    body: {
      id: null,
      from_name: input.fromName,
      from_email: input.fromEmail,
      user_name: input.fromEmail,
      password: input.password,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      imap_host: input.imapHost,
      imap_port: input.imapPort,
      max_email_per_day: w.maxEmailPerDay,
      custom_tracking_url: '',
      bcc: '',
      signature: input.signature,
      warmup_enabled: true,
      total_warmup_per_day: w.totalPerDay,
      daily_rampup: w.dailyRampup,
      reply_rate_percentage: w.replyRatePercentage,
      type: input.type,
      client_id: input.clientId ?? null,
      ...(input.tags?.length ? { tags: input.tags } : {}),
    },
  });

  const id =
    data.emailAccountId ?? data.email_account?.id ?? data.id ?? data.data?.id;
  if (id == null || id === '') {
    throw new Error(`Smartlead did not return an email account id: ${JSON.stringify(data)}`);
  }
  return Number(id);
}

export type SmartleadEmailAccount = SmartleadClientTagged & {
  id?: number;
  from_email?: string;
  email?: string;
  from_name?: string;
  client_id?: number | null;
  warmup_details?: unknown;
};

function unwrapEmailAccount(data: unknown): SmartleadEmailAccount {
  if (!data || typeof data !== 'object') return {};
  const row = data as SmartleadEmailAccount & {
    data?: SmartleadEmailAccount;
    email_account?: SmartleadEmailAccount;
  };
  return row.email_account || row.data || row;
}

/** Load one Smartlead account so mutation paths can see its current client tag. */
export async function getEmailAccount(emailAccountId: number): Promise<SmartleadEmailAccount> {
  const data = await smartlead<unknown>(`email-accounts/${emailAccountId}`, { method: 'GET' });
  return unwrapEmailAccount(data);
}

/**
 * Refuse warmup / signature / rename / delete / tag when the account is
 * already tagged PowerGRYD. Pass `known` when the caller already listed it.
 */
export async function assertEmailAccountNotPowerGryd(
  emailAccountId: number,
  known?: SmartleadEmailAccount,
): Promise<SmartleadEmailAccount> {
  const account = known ?? (await getEmailAccount(emailAccountId));
  assertAccountNotPowerGryd(account);
  return account;
}

export type CampaignLinkVerdict = {
  linked: boolean;
  unknown: boolean;
  campaignIds: number[];
};

function extractCampaignIds(source: unknown): number[] | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const row = source as {
    campaign_ids?: unknown;
    campaignIds?: unknown;
    campaigns?: unknown;
  };
  const raw = row.campaign_ids ?? row.campaignIds ?? row.campaigns;
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) return [];
  const ids: number[] = [];
  for (const item of raw) {
    if (typeof item === 'number' && Number.isFinite(item)) ids.push(item);
    else if (typeof item === 'string' && Number.isFinite(Number(item))) ids.push(Number(item));
    else if (item && typeof item === 'object') {
      const id = Number((item as { id?: unknown; campaign_id?: unknown }).id ?? (item as { campaign_id?: unknown }).campaign_id);
      if (Number.isFinite(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Read-only: is this Smartlead account linked to any campaign?
 * Fail closed (unknown/linked) if we cannot tell. Never unlinks.
 */
export async function getEmailAccountCampaignLinks(
  emailAccountId: number,
  knownAccount?: SmartleadEmailAccount,
): Promise<CampaignLinkVerdict> {
  try {
    const account = knownAccount ?? (await getEmailAccount(emailAccountId));
    let ids = extractCampaignIds(account);
    if (ids === undefined) {
      const extra = await smartlead<unknown>(`email-accounts/${emailAccountId}/campaigns`, {
        method: 'GET',
      }).catch(() => null);
      ids = extractCampaignIds(extra) ?? extractCampaignIds({ campaigns: extra });
    }
    if (ids === undefined) {
      return { linked: true, unknown: true, campaignIds: [] };
    }
    return { linked: ids.length > 0, unknown: false, campaignIds: ids };
  } catch {
    return { linked: true, unknown: true, campaignIds: [] };
  }
}

/** Update display name + signature only. Never touches campaigns, PODs, or client assignment. */
export async function updateEmailAccountPersona(
  emailAccountId: number,
  input: { fromName: string; signature: string },
  knownAccount?: SmartleadEmailAccount,
): Promise<void> {
  await assertEmailAccountNotPowerGryd(emailAccountId, knownAccount);
  await smartlead(`email-accounts/${emailAccountId}`, {
    method: 'POST',
    body: {
      from_name: input.fromName,
      signature: input.signature,
    },
  });
}

/** Page size cap documented for GET /email-accounts. */
const ACCOUNT_PAGE_SIZE = 100;

/**
 * List every Smartlead email account on the API key's account. The endpoint
 * silently truncates to the requested page, so walk pages until one comes back
 * short rather than assuming a single large page covers everything.
 */
export async function listEmailAccounts(): Promise<SmartleadEmailAccount[]> {
  const all: SmartleadEmailAccount[] = [];
  for (let offset = 0; ; offset += ACCOUNT_PAGE_SIZE) {
    const data = await smartlead<
      | SmartleadEmailAccount[]
      | { data?: SmartleadEmailAccount[]; email_accounts?: SmartleadEmailAccount[] }
    >('email-accounts/', {
      method: 'GET',
      query: { offset, limit: ACCOUNT_PAGE_SIZE },
    });
    const page = Array.isArray(data) ? data : data.email_accounts || data.data || [];
    all.push(...page);
    if (page.length < ACCOUNT_PAGE_SIZE) return all;
  }
}

export async function enableWarmup(
  emailAccountId: number,
  knownAccount?: SmartleadEmailAccount,
): Promise<void> {
  await assertEmailAccountNotPowerGryd(emailAccountId, knownAccount);
  const w = config.warmup;
  await smartlead(`email-accounts/${emailAccountId}/warmup`, {
    method: 'POST',
    body: {
      warmup_enabled: true,
      total_warmup_per_day: w.totalPerDay,
      daily_rampup: w.dailyRampup,
      reply_rate_percentage: w.replyRatePercentage,
      auto_adjust_warmup: true,
      is_rampup_enabled: true,
    },
  });
}

export async function listClients(): Promise<Array<{ id: number; name?: string; email?: string }>> {
  const data = await smartlead<unknown>('client/', { method: 'GET' });
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? ((data as { data?: unknown; clients?: unknown }).data ??
        (data as { clients?: unknown }).clients ??
        [])
      : [];
  if (!Array.isArray(rows)) return [];
  const out: Array<{ id: number; name?: string; email?: string }> = [];
  for (const row of rows) {
    const r = row as { id?: number; client_id?: number; name?: string; email?: string };
    const id = Number(r.id ?? r.client_id);
    if (!Number.isFinite(id)) continue;
    out.push({ id, name: r.name, email: r.email });
  }
  return out;
}

export function uniqueClientLoginEmail(base: string, slug: string): string {
  const at = base.lastIndexOf('@');
  const local = (at >= 0 ? base.slice(0, at) : base).trim();
  const domain = (at >= 0 ? base.slice(at + 1) : 'gmail.com').trim() || 'gmail.com';
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'client';
  return `${local}${clean}@${domain}`;
}

export async function createClient(input: {
  name: string;
  email: string;
  password?: string;
}): Promise<number> {
  // Smartlead's DB requires a password — omitting it returns HTML 500, not 403.
  const password = input.password || `Sg${nanoid(14)}!`;
  const data = await smartlead<{
    client?: { id?: number };
    clientId?: number;
    id?: number;
    data?: { id?: number };
    ok?: boolean;
  }>('client/save', {
    method: 'POST',
    retries: 1,
    body: {
      name: input.name,
      email: input.email,
      password,
      permission: ['campaigns', 'email_accounts', 'leads', 'analytics'],
    },
  });

  const id = data.clientId ?? data.client?.id ?? data.id ?? data.data?.id;
  if (!id) {
    throw new Error(`Smartlead client create returned no id: ${JSON.stringify(data)}`);
  }
  return Number(id);
}

export async function deleteEmailAccount(
  emailAccountId: number,
  clientId?: number,
  knownAccount?: SmartleadEmailAccount,
): Promise<void> {
  assertNotPowerGryd(clientId);
  await assertEmailAccountNotPowerGryd(emailAccountId, knownAccount);
  await smartlead(`email-accounts/${emailAccountId}`, { method: 'DELETE' });
}

export async function assignAccountToClient(
  emailAccountId: number,
  clientId: number,
  signature?: string,
  knownAccount?: SmartleadEmailAccount,
): Promise<void> {
  assertNotPowerGryd(clientId);
  await assertEmailAccountNotPowerGryd(emailAccountId, knownAccount);
  const body: Record<string, unknown> = { client_id: clientId };
  if (signature) body.signature = signature;
  await smartlead(`email-accounts/${emailAccountId}`, {
    method: 'POST',
    body,
  });
}

export function smtpDefaultsForPlatform(platform: 'GOOGLE' | 'MICROSOFT'): {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  type: 'GMAIL' | 'OUTLOOK';
} {
  if (platform === 'GOOGLE') {
    return {
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      type: 'GMAIL',
    };
  }
  return {
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    type: 'OUTLOOK',
  };
}
