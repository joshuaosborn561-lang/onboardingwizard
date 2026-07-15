import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { Platform } from '../types.js';

const BASE = 'https://api.inboxkit.com/v1';

async function inboxkit<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    workspaceId?: string;
    query?: Record<string, string>;
  } = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.inboxkitApiKey()}`,
    'Content-Type': 'application/json',
  };
  if (options.workspaceId) headers['X-Workspace-Id'] = options.workspaceId;

  const res = await fetch(url, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(
      `InboxKit ${options.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 800)}`,
    );
  }

  return data as T;
}

export async function createWorkspace(
  name: string,
  webhookUrl: string,
): Promise<{ uid: string }> {
  // Documented path is /v1/api/workspaces/create
  const data = await inboxkit<{ uid?: string; id?: string; workspace?: { uid?: string; id?: string } }>(
    '/api/workspaces/create',
    {
      method: 'POST',
      body: { name, webhook_url: webhookUrl, admins_only: true },
    },
  );

  const uid = data.uid || data.id || data.workspace?.uid || data.workspace?.id;
  if (!uid) {
    throw new Error(`InboxKit workspace create returned no uid: ${JSON.stringify(data)}`);
  }
  return { uid };
}

export async function setWorkspaceWebhook(
  workspaceId: string,
  webhookUrl: string,
): Promise<void> {
  await inboxkit(`/api/workspaces/${workspaceId}/webhook`, {
    method: 'POST',
    workspaceId,
    body: { webhook_url: webhookUrl },
  });
}

export interface NameserverResult {
  domain: string;
  nameservers: string[];
  uid?: string;
}

/** Connect externally registered domains by creating Cloudflare NS for them. */
export async function getNameserversForConnection(
  workspaceId: string,
  domains: string[],
): Promise<NameserverResult[]> {
  const data = await inboxkit<{
    result?: Array<{ domain: string; nameservers: string[]; uid?: string }>;
  }>('/api/domains/nameservers', {
    method: 'POST',
    workspaceId,
    body: { domains, mask_forwarding: false },
  });

  return (data.result ?? []).map((r) => ({
    domain: r.domain,
    nameservers: r.nameservers ?? [],
    uid: r.uid,
  }));
}

export async function checkNameserverPropagation(
  workspaceId: string,
  domains: string[],
): Promise<unknown> {
  return inboxkit('/api/domains/nameservers/check', {
    method: 'POST',
    workspaceId,
    body: { domains },
  });
}

/**
 * InboxKit's dashboard can auto-assign random male/female identities.
 * The public buy API still requires first_name/last_name/username fields, so we
 * request that behavior via gender + auto_generate when present, and supply
 * placeholder values only if the API rejects the request — then we read back
 * whatever identity InboxKit stored once the mailbox is active.
 */
export interface MailboxBuyRequest {
  domainName: string;
  platform: Platform;
  gender: 'male' | 'female';
  firstName?: string;
  lastName?: string;
  username?: string;
}

export async function buyMailboxes(
  workspaceId: string,
  mailboxes: MailboxBuyRequest[],
): Promise<
  Array<{
    uid: string;
    domain_name: string;
    first_name: string;
    last_name: string;
    username: string;
    platform: string;
    status: string;
  }>
> {
  // Prefer auto-generation flags recognized by InboxKit UI/API variants.
  const attempt = async (withGeneratedNames: boolean) => {
    const payload = {
      mailboxes: mailboxes.map((m) => {
        const base: Record<string, unknown> = {
          platform: m.platform,
          domain_name: m.domainName,
          gender: m.gender,
          auto_generate: true,
          auto_generate_name: true,
        };
        if (withGeneratedNames) {
          base.first_name = m.firstName;
          base.last_name = m.lastName;
          base.username = m.username;
        }
        return base;
      }),
    };

    return inboxkit<{
      mailboxes?: Array<{
        uid: string;
        domain_name: string;
        first_name: string;
        last_name: string;
        username: string;
        platform: string;
        status: string;
      }>;
      message?: string;
    }>('/api/mailboxes/buy', {
      method: 'POST',
      workspaceId,
      body: payload,
    });
  };

  try {
    const data = await attempt(false);
    return data.mailboxes ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/first_name|last_name|username|422|400/i.test(message)) throw err;
    // API requires explicit identity fields — use gender-balanced placeholders.
    // Final signature/display identity still comes from InboxKit's stored mailbox record.
    const filled = mailboxes.map((m, i) => {
      const identity = placeholderIdentity(m.gender, i);
      return {
        ...m,
        firstName: identity.firstName,
        lastName: identity.lastName,
        username: identity.username,
      };
    });
    const data = await attempt(true);
    // Prefer returned records; merge placeholders if API echoes empty names
    return (data.mailboxes ?? []).map((mb, i) => ({
      ...mb,
      first_name: mb.first_name || filled[i]?.firstName || '',
      last_name: mb.last_name || filled[i]?.lastName || '',
      username: mb.username || filled[i]?.username || '',
    }));
  }
}

export async function getMailboxDetails(
  workspaceId: string,
  mailboxId: string,
): Promise<{
  uid: string;
  email?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  domain_name?: string;
  platform?: string;
  status?: string;
}> {
  return inboxkit(`/api/mailboxes/${mailboxId}`, { workspaceId });
}

export async function getMailboxCredentials(
  workspaceId: string,
  mailboxUid: string,
): Promise<{ password?: string; app_password?: string; secret?: string }> {
  return inboxkit('/api/mailboxes/show-credentials', {
    workspaceId,
    query: { uid: mailboxUid },
  });
}

export function verifyInboxkitSignature(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const expected = createHash('sha256').update(config.inboxkitApiKey()).digest('hex');
  const provided = headerValue.replace(/^sha256=/i, '').trim().toLowerCase();
  return provided === expected;
}

/** Gender-balanced placeholder pool used only when the buy API requires names. */
function placeholderIdentity(gender: 'male' | 'female', index: number) {
  const male = [
    ['James', 'Carter'],
    ['Daniel', 'Brooks'],
    ['Michael', 'Hayes'],
    ['Christopher', 'Reed'],
    ['Andrew', 'Bennett'],
  ];
  const female = [
    ['Emily', 'Parker'],
    ['Sarah', 'Collins'],
    ['Jessica', 'Morgan'],
    ['Amanda', 'Foster'],
    ['Lauren', 'Bennett'],
  ];
  const pool = gender === 'male' ? male : female;
  const [firstName, lastName] = pool[index % pool.length];
  return {
    firstName,
    lastName,
    username: `${firstName}.${lastName}${index}`.toLowerCase().replace(/[^a-z0-9.]/g, ''),
  };
}
