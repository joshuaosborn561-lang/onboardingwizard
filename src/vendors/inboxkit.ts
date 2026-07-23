import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { ApiError, apiRequest, sleep } from '../lib/http.js';
import { allocateMailboxIdentities } from '../lib/mailboxNames.js';
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

/** Connect externally registered domains by creating Cloudflare NS for them.
 * Already-connected domains are reused from the workspace domain list.
 */
export async function getNameserversForConnection(
  workspaceId: string,
  domains: string[],
): Promise<NameserverResult[]> {
  const wanted = domains.map((d) => d.toLowerCase());
  const existing = await listDomains(workspaceId, { limit: 200 });
  const byName = new Map<string, InboxKitDomain>();
  for (const row of existing) {
    const name = String(row.domain || row.name || '').toLowerCase();
    if (name) byName.set(name, row);
  }

  const already: NameserverResult[] = [];
  const missing: string[] = [];
  for (const domain of wanted) {
    const row = byName.get(domain);
    if (row?.uid || row?.id) {
      already.push({
        domain,
        nameservers: [],
        uid: row.uid || row.id,
      });
    } else {
      missing.push(domain);
    }
  }

  const connected: NameserverResult[] = [];
  if (missing.length) {
    // Connect in small batches so one already-connected domain can't fail the whole set
    const batchSize = 5;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      try {
        const raw = await inboxkitRequest<unknown>(
          'POST',
          'v1/api/domains/nameservers',
          { domains: batch, mask_forwarding: false },
          workspaceId,
        );
        const rows = normalizeList<{
          domain?: string;
          name?: string;
          nameservers?: string[];
          uid?: string;
        }>(raw, ['result', 'data', 'domains', 'items']);
        for (const r of rows) {
          connected.push({
            domain: (r.domain || r.name || '').toLowerCase(),
            nameservers: r.nameservers ?? [],
            uid: r.uid,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Fallback: try one-by-one if batch fails on partial conflicts
        if (/already connected/i.test(message) || batch.length > 1) {
          for (const domain of batch) {
            try {
              const raw = await inboxkitRequest<unknown>(
                'POST',
                'v1/api/domains/nameservers',
                { domains: [domain], mask_forwarding: false },
                workspaceId,
              );
              const rows = normalizeList<{
                domain?: string;
                name?: string;
                nameservers?: string[];
                uid?: string;
              }>(raw, ['result', 'data', 'domains', 'items']);
              for (const r of rows) {
                connected.push({
                  domain: (r.domain || r.name || domain).toLowerCase(),
                  nameservers: r.nameservers ?? [],
                  uid: r.uid,
                });
              }
            } catch (oneErr) {
              const oneMsg = oneErr instanceof Error ? oneErr.message : String(oneErr);
              if (/already connected/i.test(oneMsg)) {
                const listed = await listDomains(workspaceId, { keyword: domain, limit: 50 });
                const row = listed.find(
                  (d) => String(d.domain || d.name || '').toLowerCase() === domain,
                );
                already.push({
                  domain,
                  nameservers: [],
                  uid: row?.uid || row?.id,
                });
              } else {
                throw oneErr;
              }
            }
          }
        } else {
          throw err;
        }
      }
    }
  }

  // Prefer fresh connect results; fill gaps from already-connected
  const out = new Map<string, NameserverResult>();
  for (const r of already) out.set(r.domain, r);
  for (const r of connected) out.set(r.domain, r);
  return wanted.map((d) => out.get(d) || { domain: d, nameservers: [] });
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

export async function listMailboxes(
  workspaceId: string,
  opts: { keyword?: string; domain?: string; limit?: number; page?: number } = {},
): Promise<
  Array<{
    uid: string;
    domain_name?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    platform?: string;
    status?: string;
    email?: string;
  }>
> {
  const out: Array<{
    uid: string;
    domain_name?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    platform?: string;
    status?: string;
    email?: string;
  }> = [];
  const limit = opts.limit ?? 100;
  let page = opts.page ?? 1;
  let pages = 1;
  while (page <= pages && page <= 50) {
    const body: Record<string, unknown> = { page, limit };
    if (opts.keyword) body.keyword = opts.keyword;
    if (opts.domain) body.domain = opts.domain;
    const raw = await inboxkitRequest<{
      mailboxes?: typeof out;
      pages?: number;
      total?: number;
    }>('POST', 'v1/api/mailboxes/list', body, workspaceId);
    const rows = normalizeList<typeof out[number]>(raw, ['mailboxes', 'result', 'data', 'items']);
    out.push(...rows.filter((r) => r?.uid));
    pages = Number(raw?.pages || pages);
    if (!rows.length) break;
    page += 1;
  }
  return out;
}

export interface MailboxBuyRequest {
  domainName: string;
  platform: Platform;
  seed: number;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export async function buyMailboxes(
  workspaceId: string,
  mailboxes: MailboxBuyRequest[],
  opts: {
    useWalletBalance?: boolean;
    idempotencyKey?: string;
    /** Pre-allocated identities for this exact batch (order-matched). */
    identities?: ReturnType<typeof allocateMailboxIdentities>;
  } = {},
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
  const usedUser = new Set<string>();
  const fallback = opts.identities?.length
    ? opts.identities
    : allocateMailboxIdentities(mailboxes.length);

  const payload = {
    mailboxes: mailboxes.map((m, i) => {
      const identity = fallback[i]!;
      const first = m.firstName || identity.first_name;
      const last = m.lastName || identity.last_name;
      const username =
        m.username ||
        identity.username ||
        `${first}.${last}`.toLowerCase().replace(/[^a-z0-9.]/g, '');
      usedUser.add(username);
      return {
        first_name: first,
        last_name: last,
        username,
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
  // Preserve call order so one global unique-name allocation covers the whole job
  // even though InboxKit buys are submitted per-domain.
  const identities = mailboxes.every((m) => m.firstName && m.lastName && m.username)
    ? mailboxes.map((m) => ({
        gender: 'male' as const,
        first_name: m.firstName!,
        last_name: m.lastName!,
        username: m.username!,
      }))
    : allocateMailboxIdentities(mailboxes.length);

  // Pull seats already purchased in prior partial attempts so retries are idempotent.
  let existing: Awaited<ReturnType<typeof listMailboxes>> = [];
  try {
    existing = await listMailboxes(workspaceId, { limit: 100 });
  } catch {
    existing = [];
  }

  const byDomain = new Map<string, Array<{ req: MailboxBuyRequest; identityIndex: number }>>();
  mailboxes.forEach((m, i) => {
    const key = `${m.domainName}::${m.platform}`;
    const list = byDomain.get(key) ?? [];
    list.push({ req: m, identityIndex: i });
    byDomain.set(key, list);
  });

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
    const existingForDomain = existing.filter(
      (m) => (m.domain_name || '').toLowerCase() === String(domainName).toLowerCase(),
    );
    const needed = Math.max(0, batch.length - existingForDomain.length);
    if (needed <= 0) {
      // Domain already at target — reuse existing rows
      for (const m of existingForDomain.slice(0, batch.length)) {
        out.push({
          uid: m.uid,
          domain_name: m.domain_name || String(domainName),
          first_name: m.first_name || '',
          last_name: m.last_name || '',
          username: m.username || '',
          platform: m.platform || String(platform),
          status: m.status || 'scheduled',
        });
      }
      continue;
    }

    const batchReqs = batch.slice(0, needed).map(({ req, identityIndex }) => {
      const id = identities[identityIndex]!;
      return {
        ...req,
        firstName: req.firstName || id.first_name,
        lastName: req.lastName || id.last_name,
        username: req.username || id.username,
      };
    });
    // Prefer usernames not already used on this domain
    const usedOnDomain = new Set(
      existingForDomain.map((m) => (m.username || '').toLowerCase()).filter(Boolean),
    );
    for (const req of batchReqs) {
      let u = (req.username || '').toLowerCase();
      let n = 2;
      while (usedOnDomain.has(u)) {
        u = `${(req.username || 'user').replace(/\d+$/, '')}${n}`.toLowerCase();
        n += 1;
      }
      req.username = u;
      usedOnDomain.add(u);
    }
    const batchIdentities = batch.slice(0, needed).map(({ identityIndex }) => identities[identityIndex]!);
    try {
      const created = await buyMailboxes(workspaceId, batchReqs, {
        useWalletBalance: opts.useWalletBalance ?? true,
        idempotencyKey: `onboard-${domainName}-${platform}-n${batchReqs.length}-v2`,
        identities: batchIdentities,
      });
      out.push(...created);
      // Include already-existing seats on this domain too
      for (const m of existingForDomain) {
        if (!out.some((x) => x.uid === m.uid)) {
          out.push({
            uid: m.uid,
            domain_name: m.domain_name || String(domainName),
            first_name: m.first_name || '',
            last_name: m.last_name || '',
            username: m.username || '',
            platform: m.platform || String(platform),
            status: m.status || 'scheduled',
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Domain already full / duplicate — treat as success using whatever exists
      if (/already|duplicate|exist|maximum \d+ mailboxes|currently has \d+ mailbox/i.test(message)) {
        for (const m of existingForDomain) {
          if (!out.some((x) => x.uid === m.uid)) {
            out.push({
              uid: m.uid,
              domain_name: m.domain_name || String(domainName),
              first_name: m.first_name || '',
              last_name: m.last_name || '',
              username: m.username || '',
              platform: m.platform || String(platform),
              status: m.status || 'scheduled',
            });
          }
        }
        continue;
      }
      if (/insufficient wallet|insufficient balance/i.test(message)) {
        const walletErr = Object.assign(new Error(message), {
          domain: domainName,
          partialMailboxes: out,
          code: 'INBOXKIT_WALLET',
        });
        throw walletErr;
      }
      throw Object.assign(err instanceof Error ? err : new Error(message), {
        domain: domainName,
        partialMailboxes: out,
      });
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
