import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { ApiError, apiRequest, sleep } from '../lib/http.js';
import { pickMailboxIdentity } from '../lib/mailboxNames.js';
import type { Platform } from '../types.js';

const BASE_URL = 'https://api.inboxkit.com/';

function normalizeList<T>(raw: unknown, keys: string[]): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of keys) {
      const val = obj[key];
      if (Array.isArray(val)) return val as T[];
      if (val && typeof val === 'object') {
        const nested = val as Record<string, unknown>;
        for (const inner of ['items', 'data', 'result', 'domains', 'mailboxes', 'workspaces']) {
          if (Array.isArray(nested[inner])) return nested[inner] as T[];
        }
      }
    }
    if (Array.isArray(obj.result)) return obj.result as T[];
  }
  return [];
}

async function inboxkitRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  workspaceId?: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.inboxkitApiKey()}`,
    ...extraHeaders,
  };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;

  try {
    return await apiRequest<T>(BASE_URL, null, path.replace(/^\//, ''), {
      method,
      body,
      headers,
      skipApiKeyQuery: true,
      retries: 4,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw err;
  }
}

export async function createWorkspace(
  name: string,
  webhookUrl: string,
): Promise<{ uid: string }> {
  const data = await inboxkitRequest<{
    uid?: string;
    id?: string;
    workspace?: { uid?: string; id?: string };
  }>('POST', 'v1/api/workspaces/create', {
    name,
    webhook_url: webhookUrl,
    admins_only: true,
  });

  const uid = data.uid || data.id || data.workspace?.uid || data.workspace?.id;
  if (!uid) {
    throw new Error(`InboxKit workspace create returned no uid: ${JSON.stringify(data)}`);
  }
  return { uid };
}

export async function listWorkspaces(): Promise<Array<{ uid?: string; id?: string; name?: string }>> {
  const raw = await inboxkitRequest<unknown>('GET', 'v1/api/workspaces/list');
  return normalizeList(raw, ['workspaces', 'result', 'data', 'items']);
}

export async function setWorkspaceWebhook(
  workspaceId: string,
  webhookUrl: string,
): Promise<void> {
  await inboxkitRequest(
    'POST',
    `v1/api/workspaces/${workspaceId}/webhook`,
    { webhook_url: webhookUrl },
    workspaceId,
  );
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
  const raw = await inboxkitRequest<unknown>(
    'POST',
    'v1/api/domains/nameservers',
    { domains: domains.map((d) => d.toLowerCase()), mask_forwarding: false },
    workspaceId,
  );
  const rows = normalizeList<{
    domain?: string;
    name?: string;
    nameservers?: string[];
    uid?: string;
  }>(raw, ['result', 'data', 'domains', 'items']);
  return rows.map((r) => ({
    domain: (r.domain || r.name || '').toLowerCase(),
    nameservers: r.nameservers ?? [],
    uid: r.uid,
  }));
}

/** Forward InboxKit-managed domains to the client's main site (post-NS cutover). */
export async function setDomainForwarding(
  workspaceId: string,
  domainUids: string[],
  forwardingUrl: string,
): Promise<unknown> {
  let dest = forwardingUrl.trim();
  if (!/^https?:\/\//i.test(dest)) dest = `https://${dest}`;
  return inboxkitRequest(
    'POST',
    'v1/api/domains/forwarding',
    { uids: domainUids, forwarding_url: dest },
    workspaceId,
  );
}

export async function checkNameserverPropagation(
  workspaceId: string,
  domains: string[],
): Promise<unknown> {
  return inboxkitRequest(
    'POST',
    'v1/api/domains/nameservers/check',
    { domains: domains.map((d) => d.toLowerCase()) },
    workspaceId,
  );
}

export interface InboxKitDomain {
  uid?: string;
  id?: string;
  name?: string;
  domain?: string;
  status?: string;
  nameserver_match_status?: string;
}

export async function listDomains(
  workspaceId: string,
  opts: { keyword?: string; limit?: number } = {},
): Promise<InboxKitDomain[]> {
  const body: Record<string, unknown> = {
    page: 1,
    limit: opts.limit ?? 200,
  };
  if (opts.keyword) body.keyword = opts.keyword;
  const raw = await inboxkitRequest<unknown>(
    'POST',
    'v1/api/domains/list',
    body,
    workspaceId,
  );
  return normalizeList(raw, ['domains', 'result', 'data', 'items']);
}

/** True when InboxKit reports nameservers as matched/propagated. */
export function nameserversReady(domain: InboxKitDomain): boolean {
  const status = String(domain.nameserver_match_status ?? '').toLowerCase();
  const life = String(domain.status ?? '').toLowerCase();
  if (
    status.includes('match') ||
    status.includes('synced') ||
    status.includes('propagat') ||
    status === 'ok' ||
    status === 'ready'
  ) {
    return true;
  }
  if (life === 'active' || life === 'ready') return true;
  return false;
}

export async function countNameserversReady(
  workspaceId: string,
  domains: string[],
): Promise<{ matched: number; total: number; missing: string[] }> {
  const listed = await listDomains(workspaceId, { limit: 200 });
  const byName = new Map(
    listed.map((d) => [(d.name || d.domain || '').toLowerCase(), d]),
  );
  const missing: string[] = [];
  let matched = 0;
  for (const domain of domains) {
    const row = byName.get(domain.toLowerCase());
    if (row && nameserversReady(row)) matched += 1;
    else missing.push(domain);
  }
  return { matched, total: domains.length, missing };
}

export interface MailboxBuyRequest {
  domainName: string;
  platform: Platform;
  seed: number;
}

export async function buyMailboxes(
  workspaceId: string,
  mailboxes: MailboxBuyRequest[],
  opts: { useWalletBalance?: boolean; idempotencyKey?: string } = {},
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
  const payload = {
    mailboxes: mailboxes.map((m) => {
      const identity = pickMailboxIdentity(m.seed);
      return {
        first_name: identity.first_name,
        last_name: identity.last_name,
        username: identity.username,
        platform: m.platform,
        domain_name: m.domainName,
      };
    }),
    ...(opts.useWalletBalance ? { use_wallet_balance: true } : {}),
  };

  const extraHeaders: Record<string, string> = {};
  if (opts.idempotencyKey) extraHeaders['Idempotency-Key'] = opts.idempotencyKey;

  const data = await inboxkitRequest<{
    mailboxes?: Array<{
      uid: string;
      domain_name: string;
      first_name: string;
      last_name: string;
      username: string;
      platform: string;
      status: string;
    }>;
  }>('POST', 'v1/api/mailboxes/buy', payload, workspaceId, extraHeaders);

  return data.mailboxes ?? [];
}

/** Buy one domain batch at a time with spacing (InboxKit rate limits bulk buys). */
export async function buyMailboxesBatched(
  workspaceId: string,
  mailboxes: MailboxBuyRequest[],
  opts: { useWalletBalance?: boolean; gapMs?: number } = {},
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
  const byDomain = new Map<string, MailboxBuyRequest[]>();
  for (const m of mailboxes) {
    const key = `${m.domainName}::${m.platform}`;
    const list = byDomain.get(key) ?? [];
    list.push(m);
    byDomain.set(key, list);
  }

  const out: Array<{
    uid: string;
    domain_name: string;
    first_name: string;
    last_name: string;
    username: string;
    platform: string;
    status: string;
  }> = [];

  for (const [key, batch] of byDomain) {
    const [domainName, platform] = key.split('::');
    try {
      const created = await buyMailboxes(workspaceId, batch, {
        useWalletBalance: opts.useWalletBalance ?? true,
        idempotencyKey: `onboard-${domainName}-${platform}-n${batch.length}`,
      });
      out.push(...created);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already|duplicate|exist/i.test(message)) throw err;
    }
    await sleep(opts.gapMs ?? 1200);
  }
  return out;
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
  return inboxkitRequest('GET', `v1/api/mailboxes/${mailboxId}`, undefined, workspaceId);
}

export async function getMailboxCredentials(
  workspaceId: string,
  mailboxUid: string,
): Promise<{ password?: string; app_password?: string; secret?: string }> {
  return apiRequest(BASE_URL, null, 'v1/api/mailboxes/show-credentials', {
    method: 'GET',
    query: { uid: mailboxUid },
    headers: {
      Authorization: `Bearer ${config.inboxkitApiKey()}`,
      'X-Workspace-Id': workspaceId,
    },
    skipApiKeyQuery: true,
  });
}

export function verifyInboxkitSignature(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  const expected = createHash('sha256').update(config.inboxkitApiKey()).digest('hex');
  const provided = headerValue.replace(/^sha256=/i, '').trim().toLowerCase();
  return provided === expected;
}
