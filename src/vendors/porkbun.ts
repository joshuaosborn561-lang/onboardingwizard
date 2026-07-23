import { ApiError, sleep } from '../lib/http.js';

const BASE_URL = 'https://api.porkbun.com/api/json/v3';

export interface PorkbunCredentials {
  apiKey: string;
  secretApiKey: string;
}

export interface DomainCheckResult {
  domain: string;
  available: boolean;
  priceCents?: number;
  priceUsd?: string;
  raw?: unknown;
}

async function request<T>(
  path: string,
  creds: PorkbunCredentials,
  body: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'ClientOnboardingAutomation/1.0 (+railway)',
    },
    body: JSON.stringify({
      apikey: creds.apiKey,
      secretapikey: creds.secretApiKey,
      ...body,
    }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  const status =
    typeof parsed === 'object' && parsed !== null && 'status' in parsed
      ? String((parsed as { status?: unknown }).status)
      : '';
  if (!response.ok || (status && status.toUpperCase() !== 'SUCCESS')) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : `Porkbun HTTP ${response.status}`;
    throw new ApiError(message, response.status, parsed);
  }
  return parsed as T;
}

export async function checkDomain(
  domain: string,
  creds: PorkbunCredentials,
): Promise<DomainCheckResult> {
  const raw = await request<Record<string, unknown>>(
    `/domain/checkDomain/${domain.toLowerCase()}`,
    creds,
  );
  const avail = String(raw.avail ?? raw.available ?? '').toLowerCase();
  const available = avail === 'yes' || avail === 'true' || avail === '1' || avail === 'available';
  const priceRaw = raw.price;
  let priceCents: number | undefined;
  let priceUsd: string | undefined;
  if (typeof priceRaw === 'string' || typeof priceRaw === 'number') {
    priceUsd = String(priceRaw);
    const n = Number(priceRaw);
    // checkDomain returns USD; /domain/create expects pennies
    if (Number.isFinite(n)) priceCents = Math.round(n * 100);
  }
  return { domain: domain.toLowerCase(), available, priceCents, priceUsd, raw };
}

/** Respect Porkbun's ~1 availability check / 10 seconds limit. */
export async function checkDomainThrottled(
  domain: string,
  creds: PorkbunCredentials,
  minGapMs = 10_500,
): Promise<DomainCheckResult> {
  const result = await checkDomain(domain, creds);
  await sleep(minGapMs);
  return result;
}

export async function registerDomain(
  domain: string,
  creds: PorkbunCredentials,
  costCents: number,
): Promise<unknown> {
  return request(`/domain/create/${domain.toLowerCase()}`, creds, {
    cost: costCents,
    agreeToTerms: 'yes',
  });
}

export async function updateNameservers(
  domain: string,
  creds: PorkbunCredentials,
  nameservers: string[],
): Promise<unknown> {
  return request(`/domain/updateNs/${domain.toLowerCase()}`, creds, {
    ns: nameservers,
  });
}

/**
 * Forward root (+ www) of a Porkbun domain to the client's main site.
 * Note: only active while the domain still uses Porkbun DNS. After NS
 * cutover to InboxKit/Cloudflare, InboxKit forwarding takes over.
 */
export async function addUrlForward(
  domain: string,
  creds: PorkbunCredentials,
  location: string,
  opts: { subdomain?: string; type?: 'temporary' | 'permanent'; wildcard?: boolean } = {},
): Promise<unknown> {
  let dest = location.trim();
  if (!/^https?:\/\//i.test(dest)) dest = `https://${dest}`;
  return request(`/domain/addUrlForward/${domain.toLowerCase()}`, creds, {
    subdomain: opts.subdomain ?? '',
    location: dest,
    type: opts.type ?? 'permanent',
    includePath: 'yes',
    wildcard: opts.wildcard ? 'yes' : 'no',
  });
}

/** Set root + www forwards to the client main URL. */
export async function forwardDomainToMain(
  domain: string,
  creds: PorkbunCredentials,
  mainUrl: string,
): Promise<void> {
  await addUrlForward(domain, creds, mainUrl, { subdomain: '', type: 'permanent' });
  try {
    await addUrlForward(domain, creds, mainUrl, { subdomain: 'www', type: 'permanent' });
  } catch {
    // www may already exist or be unsupported — non-fatal
  }
}
