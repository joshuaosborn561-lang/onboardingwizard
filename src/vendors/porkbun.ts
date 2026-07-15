const BASE = 'https://api.porkbun.com/api/json/v3';

export interface PorkbunCredentials {
  apiKey: string;
  secretApiKey: string;
}

export interface DomainCheckResult {
  domain: string;
  available: boolean;
  priceCents?: number;
  raw?: unknown;
}

async function porkbun<T>(
  path: string,
  creds: PorkbunCredentials,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apikey: creds.apiKey,
      secretapikey: creds.secretApiKey,
      ...body,
    }),
  });

  const data = (await res.json()) as { status?: string; message?: string } & T;
  if (!res.ok || (data.status && data.status !== 'SUCCESS')) {
    throw new Error(
      `Porkbun ${path} failed: ${data.message || data.status || res.status} ${JSON.stringify(data)}`,
    );
  }
  return data;
}

export async function checkDomain(
  domain: string,
  creds: PorkbunCredentials,
): Promise<DomainCheckResult> {
  const data = await porkbun<{
    response?: {
      avail?: string;
      price?: string | number;
      available?: string;
    };
    avail?: string;
    price?: string | number;
  }>(`/domain/checkDomain/${domain}`, creds);

  const response = (data.response ?? data) as {
    avail?: string;
    available?: string;
    price?: string | number;
  };
  const availRaw = String(response.avail || response.available || '').toLowerCase();
  // Docs: avail is "yes" / "no"
  const available = availRaw === 'yes' || availRaw === 'available' || availRaw === 'true';

  const priceRaw = response.price ?? data.price;
  let priceCents: number | undefined;
  if (priceRaw != null) {
    const n = Number(priceRaw);
    // checkDomain returns USD (e.g. 9.73); /domain/create expects pennies (973)
    if (Number.isFinite(n)) priceCents = Math.round(n * 100);
  }

  return {
    domain,
    available,
    priceCents,
    raw: data,
  };
}

export async function registerDomain(
  domain: string,
  creds: PorkbunCredentials,
  costCents: number,
): Promise<unknown> {
  return porkbun(`/domain/create/${domain}`, creds, {
    cost: costCents,
    agreeToTerms: 'yes',
  });
}

export async function updateNameservers(
  domain: string,
  creds: PorkbunCredentials,
  nameservers: string[],
): Promise<unknown> {
  return porkbun(`/domain/updateNs/${domain}`, creds, {
    ns: nameservers,
  });
}
