import { config } from '../config.js';
import { apiRequest } from '../lib/http.js';

const BASE_URL = 'https://server.smartlead.ai/api/v1/';

async function smartlead<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined | null>;
  } = {},
): Promise<T> {
  return apiRequest<T>(BASE_URL, config.smartleadApiKey(), path.replace(/^\//, ''), {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    body: options.body,
    query: options.query,
    retries: 4,
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
}): Promise<number> {
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
    },
  });

  const id =
    data.emailAccountId ?? data.email_account?.id ?? data.id ?? data.data?.id;
  if (id == null || id === '') {
    throw new Error(`Smartlead did not return an email account id: ${JSON.stringify(data)}`);
  }
  return Number(id);
}

/** List Smartlead email accounts (paginated server-side; we pull a large page). */
export async function listEmailAccounts(): Promise<
  Array<{ id?: number; from_email?: string; email?: string; warmup_details?: unknown }>
> {
  const data = await smartlead<
    | Array<{ id?: number; from_email?: string; email?: string }>
    | {
        data?: Array<{ id?: number; from_email?: string; email?: string }>;
        email_accounts?: Array<{ id?: number; from_email?: string; email?: string }>;
      }
  >('email-accounts/', { method: 'GET', query: { offset: 0, limit: 500 } });
  if (Array.isArray(data)) return data;
  return data.email_accounts || data.data || [];
}

export async function enableWarmup(emailAccountId: number): Promise<void> {
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

export async function createClient(input: {
  name: string;
  email: string;
}): Promise<number> {
  const data = await smartlead<{
    client?: { id?: number };
    id?: number;
    data?: { id?: number };
  }>('client/save', {
    method: 'POST',
    body: {
      name: input.name,
      email: input.email,
      permission: ['campaigns', 'email_accounts', 'leads', 'analytics'],
      logo: '',
      logo_url: '',
      password: undefined,
    },
  });

  const id = data.client?.id ?? data.id ?? data.data?.id;
  if (!id) {
    throw new Error(`Smartlead client create returned no id: ${JSON.stringify(data)}`);
  }
  return Number(id);
}

export async function assignAccountToClient(
  emailAccountId: number,
  clientId: number,
  signature?: string,
): Promise<void> {
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
