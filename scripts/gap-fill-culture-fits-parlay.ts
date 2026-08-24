/**
 * Gap-fill Culture Fits + Parlay to 50 senders each on EXISTING workspaces/clients.
 * Hard cap: $172 total new spend. Does not enable InboxKit warmup.
 * Does not create InboxKit workspaces or Smartlead clients.
 *
 * Usage:
 *   npx tsx scripts/gap-fill-culture-fits-parlay.ts --inventory
 *   npx tsx scripts/gap-fill-culture-fits-parlay.ts --check-only
 *   npx tsx scripts/gap-fill-culture-fits-parlay.ts --execute
 */
import {
  buyMailboxesBatched,
  checkNameserverPropagation,
  countNameserversReady,
  ensureSmartleadSequencer,
  exportMailboxesToSequencer,
  getMailboxCredentials,
  getMailboxDetails,
  getNameserversForConnection,
  getSequencerExportStatus,
  listDomains,
  listMailboxes,
  listWorkspaces,
  setDomainForwarding,
} from '../src/vendors/inboxkit.js';
import {
  addEmailAccount,
  assignAccountToClient,
  buildSignaturePlain,
  enableWarmup,
  listClients,
  listEmailAccounts,
  smtpDefaultsForPlatform,
} from '../src/vendors/smartlead.js';
import {
  checkDomainThrottled,
  disableDomainAutoRenew,
  forwardDomainToMain,
  getAccountBalance,
  listAllDomains,
  registerDomain,
  updateNameservers,
  type DomainCheckResult,
} from '../src/vendors/porkbun.js';
import { sleep } from '../src/lib/http.js';

const BUDGET_USD = 172;
const TARGET_PER_CLIENT = 50;
const DEFAULT_MAILBOX_RATE = 2.5;
const STATE_PATH = process.env.GAP_FILL_STATE_PATH || '/tmp/gap-fill-culture-fits-parlay.json';

type Platform = 'GOOGLE' | 'MICROSOFT';

interface Sender {
  firstName: string;
  lastName: string;
  username: string;
}

interface DomainRow {
  domain: string;
  platform: Platform;
  senders: [Sender, Sender];
}

interface ClientPlan {
  key: 'cultureFits' | 'parlay';
  name: string;
  match: string;
  website: string;
  company: string;
  rows: DomainRow[];
  spareRows: DomainRow[];
}

function sender(firstName: string, lastName: string): Sender {
  return {
    firstName,
    lastName,
    username: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, ''),
  };
}

function row(domain: string, platform: Platform, a: Sender, b: Sender): DomainRow {
  return { domain, platform, senders: [a, b] };
}

const CULTURE_FITS: ClientPlan = {
  key: 'cultureFits',
  name: 'Culture Fits',
  match: 'culturefit',
  website: 'https://culture-fits.com',
  company: 'Culture Fits',
  rows: [
    row('tryculturefits.info', 'GOOGLE', sender('James', 'Carter'), sender('Emily', 'Brooks')),
    row('goculturefits.info', 'GOOGLE', sender('Carlos', 'Garcia'), sender('Sofia', 'Rodriguez')),
    row('getculturefits.info', 'GOOGLE', sender('Marcus', 'Washington'), sender('Aaliyah', 'Banks')),
    row('nowculturefits.info', 'GOOGLE', sender('Wei', 'Chen'), sender('Mei', 'Park')),
    row('useculturefits.info', 'MICROSOFT', sender('Minh', 'Nguyen'), sender('Linh', 'Tran')),
    row('proculturefits.info', 'MICROSOFT', sender('Omar', 'Hassan'), sender('Layla', 'Nasser')),
    row('hqculturefits.info', 'MICROSOFT', sender('Luca', 'Rossi'), sender('Giulia', 'Conti')),
    row('winculturefits.info', 'MICROSOFT', sender('Dmitri', 'Ivanov'), sender('Anya', 'Sokolov')),
    row('topculturefits.info', 'MICROSOFT', sender('David', 'Hayes'), sender('Sarah', 'Reed')),
    row('newculturefits.info', 'MICROSOFT', sender('Diego', 'Martinez'), sender('Camila', 'Lopez')),
  ],
  spareRows: [
    row('myculturefits.info', 'GOOGLE', sender('Arjun', 'Patel'), sender('Priya', 'Sharma')),
    row('labculturefits.info', 'GOOGLE', sender('Benjamin', 'Coleman'), sender('Olivia', 'Lang')),
    row('hubculturefits.info', 'GOOGLE', sender('Antonio', 'Perez'), sender('Elena', 'Cruz')),
    row('boxculturefits.info', 'GOOGLE', sender('Xavier', 'Hudson'), sender('Zuri', 'Fleming')),
    row('keyculturefits.info', 'GOOGLE', sender('Aditya', 'Reddy'), sender('Diya', 'Nair')),
    row('runculturefits.info', 'MICROSOFT', sender('Isaiah', 'Freeman'), sender('Nia', 'Haynes')),
    row('appculturefits.info', 'MICROSOFT', sender('Rohan', 'Singh'), sender('Ananya', 'Gupta')),
    row('heyculturefits.info', 'MICROSOFT', sender('Duc', 'Hoang'), sender('Trang', 'Vu')),
    row('maxculturefits.info', 'MICROSOFT', sender('Yusuf', 'Abbas'), sender('Amira', 'Saleh')),
    row('oneculturefits.info', 'MICROSOFT', sender('Matteo', 'Romano'), sender('Francesca', 'Ricci')),
  ],
};

const PARLAY: ClientPlan = {
  key: 'parlay',
  name: 'Parlay',
  match: 'parlay',
  website: 'https://parlaytech.net',
  company: 'Parlay',
  rows: [
    row('tryparlay.info', 'GOOGLE', sender('Michael', 'Bennett'), sender('Jessica', 'Walsh')),
    row('getparlay.info', 'GOOGLE', sender('Luis', 'Hernandez'), sender('Valentina', 'Flores')),
    row('nowparlay.info', 'GOOGLE', sender('Andre', 'Jefferson'), sender('Imani', 'Booker')),
    row('useparlay.info', 'GOOGLE', sender('Kai', 'Tanaka'), sender('Hana', 'Suzuki')),
    row('myparlay.info', 'MICROSOFT', sender('Huy', 'Le'), sender('Mai', 'Pham')),
    row('proparlay.info', 'MICROSOFT', sender('Amir', 'Karim'), sender('Yasmin', 'Haddad')),
    row('hqparlay.info', 'MICROSOFT', sender('Enzo', 'Moretti'), sender('Chiara', 'Ferrari')),
    row('winparlay.info', 'MICROSOFT', sender('Nikolas', 'Petrov'), sender('Katya', 'Volkov')),
    row('topparlay.info', 'MICROSOFT', sender('Matthew', 'Palmer'), sender('Lauren', 'Griffin')),
    row('newparlay.info', 'MICROSOFT', sender('Javier', 'Ramirez'), sender('Lucia', 'Torres')),
  ],
  spareRows: [
    row('goparlay.info', 'GOOGLE', sender('Christopher', 'Pratt'), sender('Amanda', 'Keller')),
    row('labparlay.info', 'GOOGLE', sender('Fernando', 'Gomez'), sender('Gabriela', 'Sanchez')),
    row('hubparlay.info', 'GOOGLE', sender('Kendrick', 'Hawkins'), sender('Tiana', 'Parks')),
    row('boxparlay.info', 'GOOGLE', sender('Jun', 'Liu'), sender('Yuna', 'Kim')),
    row('keyparlay.info', 'GOOGLE', sender('Nikhil', 'Shah'), sender('Neha', 'Chopra')),
    row('runparlay.info', 'MICROSOFT', sender('Darius', 'Mosley'), sender('Jasmine', 'Porter')),
    row('apparlay.info', 'MICROSOFT', sender('Vikram', 'Kumar'), sender('Isha', 'Mehta')),
    row('heyparlay.info', 'MICROSOFT', sender('Tuan', 'Bui'), sender('Ngoc', 'Dang')),
    row('maxparlay.info', 'MICROSOFT', sender('Karim', 'Mansour'), sender('Leila', 'Khalil')),
    row('oneparlay.info', 'MICROSOFT', sender('Giovanni', 'Esposito'), sender('Bianca', 'Costa')),
  ],
};

const PLANS = [CULTURE_FITS, PARLAY];

function matchName(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = needle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return h.includes(n) || n.includes(h);
}

function uniqueMatch<T>(
  items: T[],
  nameOf: (item: T) => string,
  needle: string,
  label: string,
): T {
  const hits = items.filter((item) => matchName(nameOf(item), needle));
  if (hits.length !== 1) {
    throw new Error(
      `Could not uniquely match ${label} for "${needle}" (hits=${hits.length}: ${hits
        .map((h) => nameOf(h))
        .join(', ') || 'none'}). Stopping — will not create a new one.`,
    );
  }
  return hits[0]!;
}

async function inboxkitJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.INBOXKIT_API_KEY}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://api.inboxkit.com/${path.replace(/^\//, '')}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`InboxKit ${method} ${path} HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return parsed as T;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function getInboxkitAccount(): Promise<Record<string, unknown>> {
  return inboxkitJson('GET', 'v1/api/account');
}

function pickRate(account: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = account[key];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const nested = account.account;
  if (nested && typeof nested === 'object') {
    return pickRate(nested as Record<string, unknown>, keys, fallback);
  }
  return fallback;
}

function pickBool(account: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = account[key];
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
  }
  const nested = account.account;
  if (nested && typeof nested === 'object') {
    return pickBool(nested as Record<string, unknown>, keys);
  }
  return undefined;
}

async function disableAutoTopup(): Promise<unknown> {
  return inboxkitJson('POST', 'v1/api/billing/auto-topup', {
    auto_topup_enabled: false,
    auto_topup_trigger_drops_below: 200,
    auto_topup_add_credits: 500,
  });
}

function porkbunCreds() {
  const apiKey = process.env.PORKBUN_API_KEY?.trim() || '';
  const secretApiKey = process.env.PORKBUN_SECRET_API_KEY?.trim() || '';
  if (!apiKey || !secretApiKey) throw new Error('Missing Porkbun keys');
  return { apiKey, secretApiKey };
}

interface Inventory {
  account: Record<string, unknown>;
  googleRate: number;
  microsoftRate: number;
  autoTopup: boolean | undefined;
  porkbunBalance: string;
  ownedDomains: string[];
  cultureFits: {
    workspaceId: string;
    workspaceName: string;
    smartleadId: number | null;
    smartleadName: string | null;
    mailboxCount: number;
    mailboxes: Array<{ email?: string; domain?: string; platform?: string; status?: string }>;
    domains: string[];
  };
  parlay: {
    workspaceId: string;
    workspaceName: string;
    smartleadId: number | null;
    smartleadName: string | null;
    mailboxCount: number;
    mailboxes: Array<{ email?: string; domain?: string; platform?: string; status?: string }>;
    domains: string[];
  };
}

function summarizeMailbox(
  m: Awaited<ReturnType<typeof listMailboxes>>[number],
): { email?: string; domain?: string; platform?: string; status?: string } {
  return {
    email: m.email || (m.username && m.domain_name ? `${m.username}@${m.domain_name}` : undefined),
    domain: m.domain_name,
    platform: m.platform,
    status: m.status,
  };
}

async function inventory(): Promise<Inventory> {
  if (!process.env.INBOXKIT_API_KEY) throw new Error('Missing INBOXKIT_API_KEY');
  if (!process.env.SMARTLEAD_API_KEY) throw new Error('Missing SMARTLEAD_API_KEY');
  const creds = porkbunCreds();

  const [workspaces, clients, account, porkbunBalance, ownedDomains] = await Promise.all([
    listWorkspaces(),
    listClients(),
    getInboxkitAccount(),
    getAccountBalance(creds),
    listAllDomains(creds),
  ]);

  console.log(
    JSON.stringify(
      {
        workspaces: workspaces.map((w) => ({ id: w.uid || w.id, name: w.name })),
        smartleadClients: clients,
      },
      null,
      2,
    ),
  );

  const cfWs = uniqueMatch(workspaces, (w) => String(w.name || ''), 'culturefit', 'InboxKit workspace');
  const parlayWs = uniqueMatch(workspaces, (w) => String(w.name || ''), 'parlay', 'InboxKit workspace');
  const cfClientHits = clients.filter((c) => matchName(String(c.name || ''), 'culturefit'));
  const parlayClientHits = clients.filter((c) => matchName(String(c.name || ''), 'parlay'));
  if (cfClientHits.length > 1 || parlayClientHits.length > 1) {
    throw new Error('Multiple Smartlead client matches — stopping rather than guessing.');
  }
  const cfClient = cfClientHits[0];
  const parlayClient = parlayClientHits[0];

  const cfWsId = String(cfWs.uid || cfWs.id);
  const parlayWsId = String(parlayWs.uid || parlayWs.id);
  const [cfMailboxes, parlayMailboxes, cfDomains, parlayDomains] = await Promise.all([
    listMailboxes(cfWsId, { limit: 100 }),
    listMailboxes(parlayWsId, { limit: 100 }),
    listDomains(cfWsId, { limit: 200 }),
    listDomains(parlayWsId, { limit: 200 }),
  ]);

  const googleRate = pickRate(
    account,
    [
      'credits_per_google_mailbox',
      'cost_per_google_mailbox',
      'google_mailbox_cost',
      'google_cost',
    ],
    DEFAULT_MAILBOX_RATE,
  );
  const microsoftRate = pickRate(
    account,
    [
      'credits_per_ms_outlook_mailbox',
      'cost_per_ms_outlook_mailbox',
      'cost_per_microsoft_mailbox',
      'ms_outlook_mailbox_cost',
    ],
    DEFAULT_MAILBOX_RATE,
  );
  const autoTopup = pickBool(account, [
    'auto_topup_enabled',
    'autoTopupEnabled',
    'auto_topup',
  ]);

  const out: Inventory = {
    account: {
      credits_remaining: account.credits_remaining,
      credits_per_google_mailbox: account.credits_per_google_mailbox,
      credits_per_ms_outlook_mailbox: account.credits_per_ms_outlook_mailbox,
      auto_topup_enabled: account.auto_topup_enabled,
      auto_topup_config: account.auto_topup_config,
    },
    googleRate,
    microsoftRate,
    autoTopup,
    porkbunBalance: porkbunBalance.display,
    ownedDomains,
    cultureFits: {
      workspaceId: cfWsId,
      workspaceName: String(cfWs.name || ''),
      smartleadId: cfClient?.id ?? null,
      smartleadName: cfClient?.name ? String(cfClient.name) : null,
      mailboxCount: cfMailboxes.length,
      mailboxes: cfMailboxes.map(summarizeMailbox),
      domains: cfDomains.map((d) => String(d.domain || d.name || '').toLowerCase()).filter(Boolean),
    },
    parlay: {
      workspaceId: parlayWsId,
      workspaceName: String(parlayWs.name || ''),
      smartleadId: parlayClient?.id ?? null,
      smartleadName: parlayClient?.name ? String(parlayClient.name) : null,
      mailboxCount: parlayMailboxes.length,
      mailboxes: parlayMailboxes.map(summarizeMailbox),
      domains: parlayDomains.map((d) => String(d.domain || d.name || '').toLowerCase()).filter(Boolean),
    },
  };

  console.log(
    JSON.stringify(
      {
        matched: {
          cultureFitsWorkspace: out.cultureFits.workspaceId,
          cultureFitsWorkspaceName: out.cultureFits.workspaceName,
          cultureFitsSmartlead: out.cultureFits.smartleadId,
          cultureFitsSmartleadName: out.cultureFits.smartleadName,
          cultureFitsMailboxCount: out.cultureFits.mailboxCount,
          parlayWorkspace: out.parlay.workspaceId,
          parlayWorkspaceName: out.parlay.workspaceName,
          parlaySmartlead: out.parlay.smartleadId,
          parlaySmartleadName: out.parlay.smartleadName,
          parlayMailboxCount: out.parlay.mailboxCount,
        },
        inboxkitRates: { googleRate, microsoftRate, autoTopup },
        porkbunBalance: porkbunBalance.display,
        ownedDomainCount: ownedDomains.length,
      },
      null,
      2,
    ),
  );
  return out;
}

interface PriceCheck {
  checks: Array<{
    domain: string;
    available: boolean;
    alreadyOwned: boolean;
    priceUsd?: string;
    priceCents: number;
    usedSpare?: string;
  }>;
  selectedRows: Record<ClientPlan['key'], DomainRow[]>;
  domainCost: number;
  mailboxCost: number;
  mailboxCount: number;
  total: number;
  overBudget: boolean;
}

function gapFor(current: number): number {
  return Math.max(0, TARGET_PER_CLIENT - current);
}

async function priceCheck(inv: Inventory): Promise<PriceCheck> {
  const creds = porkbunCreds();
  const owned = new Set(inv.ownedDomains.map((d) => d.toLowerCase()));
  const selectedRows: Record<ClientPlan['key'], DomainRow[]> = {
    cultureFits: [],
    parlay: [],
  };

  const checks: PriceCheck['checks'] = [];
  let mailboxCount = 0;

  for (const plan of PLANS) {
    const current = plan.key === 'cultureFits' ? inv.cultureFits.mailboxCount : inv.parlay.mailboxCount;
    const needed = gapFor(current);
    const domainsNeeded = Math.ceil(needed / 2);
    mailboxCount += needed;
    console.log(`${plan.name}: current=${current} target=${TARGET_PER_CLIENT} buy=${needed} domains=${domainsNeeded}`);

    const googleSenders = Math.round(needed * 0.4);
    const microsoftSenders = needed - googleSenders;
    const wantGoogleDomains = Math.ceil(googleSenders / 2);
    const wantMicrosoftDomains = Math.ceil(microsoftSenders / 2);
    const pool = [...plan.rows, ...plan.spareRows];
    const want = { GOOGLE: wantGoogleDomains, MICROSOFT: wantMicrosoftDomains };
    const got = { GOOGLE: 0, MICROSOFT: 0 };

    for (const candidate of pool) {
      if (got.GOOGLE >= want.GOOGLE && got.MICROSOFT >= want.MICROSOFT) break;
      if (got[candidate.platform] >= want[candidate.platform]) continue;
      const alreadyOwned = owned.has(candidate.domain);
      if (alreadyOwned) {
        checks.push({
          domain: candidate.domain,
          available: false,
          alreadyOwned: true,
          priceUsd: '0',
          priceCents: 0,
        });
        selectedRows[plan.key].push(candidate);
        got[candidate.platform] += 1;
        continue;
      }
      const result: DomainCheckResult = await checkDomainThrottled(candidate.domain, creds);
      checks.push({
        domain: candidate.domain,
        available: result.available,
        alreadyOwned: false,
        priceUsd: result.priceUsd,
        priceCents: result.priceCents ?? 360,
      });
      if (result.available) {
        selectedRows[plan.key].push(candidate);
        got[candidate.platform] += 1;
      }
    }
    if (got.GOOGLE < want.GOOGLE || got.MICROSOFT < want.MICROSOFT) {
      throw new Error(
        `${plan.name}: only found G${got.GOOGLE}/${want.GOOGLE} M${got.MICROSOFT}/${want.MICROSOFT} available domains. Stopping.`,
      );
    }
  }

  const domainCost = checks
    .filter((c) => selectedRows.cultureFits.concat(selectedRows.parlay).some((r) => r.domain === c.domain))
    .reduce((sum, row) => sum + (row.alreadyOwned ? 0 : row.priceCents), 0) / 100;

  // Recalculate from selected platforms actually needed
  let remaining = mailboxCount;
  let googleBuy = 0;
  let microsoftBuy = 0;
  for (const row of [...selectedRows.cultureFits, ...selectedRows.parlay]) {
    const take = Math.min(2, remaining);
    remaining -= take;
    if (row.platform === 'GOOGLE') googleBuy += take;
    else microsoftBuy += take;
  }
  const mailboxCostExact = googleBuy * inv.googleRate + microsoftBuy * inv.microsoftRate;
  const total = domainCost + mailboxCostExact;
  const overBudget = total > BUDGET_USD + 0.01;

  const out: PriceCheck = {
    checks,
    selectedRows,
    domainCost,
    mailboxCost: mailboxCostExact,
    mailboxCount,
    total,
    overBudget,
  };
  console.log(
    JSON.stringify(
      {
        checks,
        selected: {
          cultureFits: selectedRows.cultureFits.map((r) => r.domain),
          parlay: selectedRows.parlay.map((r) => r.domain),
        },
        googleBuy,
        microsoftBuy,
        domainCost,
        mailboxCost: mailboxCostExact,
        mailboxCount,
        total,
        budget: BUDGET_USD,
        overBudget,
      },
      null,
      2,
    ),
  );
  return out;
}

function pricesFromInventory(inv: Inventory): PriceCheck {
  const selectedRows: Record<ClientPlan['key'], DomainRow[]> = {
    cultureFits: [],
    parlay: [],
  };
  const checks: PriceCheck['checks'] = [];
  let mailboxCount = 0;
  for (const plan of PLANS) {
    const current = plan.key === 'cultureFits' ? inv.cultureFits.mailboxCount : inv.parlay.mailboxCount;
    const needed = gapFor(current);
    mailboxCount += needed;
    const googleSenders = Math.round(needed * 0.4);
    const microsoftSenders = needed - googleSenders;
    const want = {
      GOOGLE: Math.ceil(googleSenders / 2),
      MICROSOFT: Math.ceil(microsoftSenders / 2),
    };
    const got = { GOOGLE: 0, MICROSOFT: 0 };
    for (const candidate of [...plan.rows, ...plan.spareRows]) {
      if (got.GOOGLE >= want.GOOGLE && got.MICROSOFT >= want.MICROSOFT) break;
      if (got[candidate.platform] >= want[candidate.platform]) continue;
      selectedRows[plan.key].push(candidate);
      checks.push({
        domain: candidate.domain,
        available: true,
        alreadyOwned: false,
        priceUsd: '3.60',
        priceCents: 360,
      });
      got[candidate.platform] += 1;
    }
  }
  let remaining = mailboxCount;
  let googleBuy = 0;
  let microsoftBuy = 0;
  for (const row of [...selectedRows.cultureFits, ...selectedRows.parlay]) {
    const take = Math.min(2, remaining);
    remaining -= take;
    if (row.platform === 'GOOGLE') googleBuy += take;
    else microsoftBuy += take;
  }
  const domainCost = checks.length * 3.6;
  const mailboxCost = googleBuy * inv.googleRate + microsoftBuy * inv.microsoftRate;
  const total = domainCost + mailboxCost;
  const out: PriceCheck = {
    checks,
    selectedRows,
    domainCost,
    mailboxCost,
    mailboxCount,
    total,
    overBudget: total > BUDGET_USD + 0.01,
  };
  console.log(
    JSON.stringify(
      {
        skippedLivePriceCheck: true,
        selected: {
          cultureFits: selectedRows.cultureFits.map((r) => r.domain),
          parlay: selectedRows.parlay.map((r) => r.domain),
        },
        googleBuy,
        microsoftBuy,
        domainCost,
        mailboxCost,
        mailboxCount,
        total,
        budget: BUDGET_USD,
        overBudget: out.overBudget,
      },
      null,
      2,
    ),
  );
  return out;
}

async function execute(inv: Inventory, prices: PriceCheck): Promise<void> {
  if (prices.overBudget) {
    throw new Error(`Aborting: estimated ${money(prices.total)} exceeds ${money(BUDGET_USD)} cap`);
  }
  if (prices.mailboxCount === 0) {
    console.log('Both clients already at 50. Nothing to buy.');
    return;
  }
  if (inv.autoTopup) {
    console.log('Disabling InboxKit auto top-up (card refill) before spend');
    try {
      const result = await disableAutoTopup();
      console.log(JSON.stringify({ autoTopupDisabled: true, result }, null, 2));
    } catch (err) {
      console.log(
        JSON.stringify({
          autoTopupDisabled: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const creds = porkbunCreds();
  const owned = new Set(inv.ownedDomains.map((d) => d.toLowerCase()));
  const registered: string[] = [];

  for (const plan of PLANS) {
    const workspaceId =
      plan.key === 'cultureFits' ? inv.cultureFits.workspaceId : inv.parlay.workspaceId;
    const rows = prices.selectedRows[plan.key];
    const current = plan.key === 'cultureFits' ? inv.cultureFits.mailboxCount : inv.parlay.mailboxCount;
    let remaining = gapFor(current);

    for (const row of rows) {
      const domain = row.domain;
      if (!owned.has(domain)) {
        const check = prices.checks.find((c) => c.domain === domain);
        const costCents = check?.priceCents ?? 360;
        console.log(`Registering ${domain} at ${costCents} cents (auto-renew off)`);
        await registerDomain(domain, creds, costCents);
        try {
          await disableDomainAutoRenew(domain, creds);
        } catch (err) {
          console.log(
            `auto-renew disable warning for ${domain}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        try {
          await forwardDomainToMain(domain, creds, plan.website);
        } catch (err) {
          console.log(
            `Porkbun forward warning for ${domain}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        owned.add(domain);
        registered.push(domain);
        await sleep(2000);
      } else {
        console.log(`Already owned: ${domain}`);
      }
    }

    const domains = rows.map((r) => r.domain);
    console.log(`Connecting ${domains.length} ${plan.name} domains to workspace ${workspaceId}`);
    const nsResults = await getNameserversForConnection(workspaceId, domains);
    for (const result of nsResults) {
      if (result.nameservers?.length) {
        try {
          await updateNameservers(result.domain, creds, result.nameservers);
          console.log(`NS updated ${result.domain} → ${result.nameservers.join(', ')}`);
        } catch (err) {
          console.log(
            `NS update failed ${result.domain}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    const uids = nsResults.map((r) => r.uid).filter((u): u is string => Boolean(u));
    if (uids.length) {
      try {
        await setDomainForwarding(workspaceId, uids, plan.website);
        console.log(`InboxKit forwarding ${uids.length} domains → ${plan.website}`);
      } catch (err) {
        console.log(
          `InboxKit forwarding warning: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    try {
      await checkNameserverPropagation(workspaceId, domains);
    } catch {
      // non-fatal
    }

    // Wait for NS — poll up to ~4 hours
    const deadline = Date.now() + 4 * 60 * 60 * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await checkNameserverPropagation(workspaceId, domains);
      } catch {
        // ignore
      }
      const status = await countNameserversReady(workspaceId, domains);
      console.log(`${plan.name} NS ready ${status.matched}/${status.total}`);
      if (status.matched >= status.total) {
        ready = true;
        break;
      }
      await sleep(60_000);
    }
    if (!ready) {
      throw new Error(`${plan.name}: nameservers not ready after 4h. Mailboxes not bought yet.`);
    }

    const buyRequests = [];
    for (const row of rows) {
      for (const s of row.senders) {
        if (remaining <= 0) break;
        buyRequests.push({
          domainName: row.domain,
          platform: row.platform,
          seed: 0,
          firstName: s.firstName,
          lastName: s.lastName,
          username: s.username,
        });
        remaining -= 1;
      }
    }
    console.log(`Buying ${buyRequests.length} ${plan.name} mailboxes (GOOGLE/MICROSOFT only)`);
    const created = await buyMailboxesBatched(workspaceId, buyRequests, {
      useWalletBalance: true,
      gapMs: 1200,
    });
    console.log(`Submitted ${created.length} ${plan.name} mailbox orders`);

    const wantedEmails = new Set(
      buyRequests.map((b) => `${b.username}@${b.domainName}`.toLowerCase()),
    );
    const activeDeadline = Date.now() + 8 * 60 * 60 * 1000;
    let active: Awaited<ReturnType<typeof listMailboxes>> = [];
    while (Date.now() < activeDeadline) {
      const all = await listMailboxes(workspaceId, { limit: 100 });
      active = all.filter((m) => {
        const email = (m.email || `${m.username}@${m.domain_name}`).toLowerCase();
        return wantedEmails.has(email) && String(m.status || '').toLowerCase() === 'active';
      });
      console.log(`${plan.name} new mailboxes active ${active.length}/${buyRequests.length}`);
      if (active.length >= buyRequests.length) break;
      await sleep(120_000);
    }
    if (active.length < buyRequests.length) {
      throw new Error(
        `${plan.name}: only ${active.length}/${buyRequests.length} new mailboxes active. Stopping before Smartlead load.`,
      );
    }

    const smartleadId =
      plan.key === 'cultureFits' ? inv.cultureFits.smartleadId : inv.parlay.smartleadId;
    await loadSmartlead(workspaceId, active, plan.company, smartleadId);
  }
}

async function loadSmartlead(
  workspaceId: string,
  mailboxes: Awaited<ReturnType<typeof listMailboxes>>,
  company: string,
  clientId: number | null,
): Promise<void> {
  const existing = await listEmailAccounts();
  const byEmail = new Map(
    existing
      .map((a) => {
        const email = String(a.from_email || a.email || '').toLowerCase();
        return email && a.id != null ? ([email, Number(a.id)] as const) : null;
      })
      .filter((x): x is readonly [string, number] => Boolean(x)),
  );

  const google = mailboxes.filter((m) => String(m.platform || '').toUpperCase() === 'GOOGLE');
  const microsoft = mailboxes.filter((m) => String(m.platform || '').toUpperCase() === 'MICROSOFT');

  for (const mailbox of google) {
    const email = (mailbox.email || `${mailbox.username}@${mailbox.domain_name}`).toLowerCase();
    let id = byEmail.get(email);
    if (!id) {
      const creds = await getMailboxCredentials(workspaceId, mailbox.uid);
      const password = creds.app_password || creds.password;
      if (!password) throw new Error(`Missing SMTP password for ${email}`);
      const details = await getMailboxDetails(workspaceId, mailbox.uid).catch(() => mailbox);
      const first = details.first_name || mailbox.first_name || '';
      const last = details.last_name || mailbox.last_name || '';
      const smtp = smtpDefaultsForPlatform('GOOGLE');
      id = await addEmailAccount({
        fromName: `${first} ${last}`.trim(),
        fromEmail: email,
        password,
        smtpHost: smtp.smtpHost,
        smtpPort: smtp.smtpPort,
        imapHost: smtp.imapHost,
        imapPort: smtp.imapPort,
        type: smtp.type,
        signature: buildSignaturePlain(first, last, company),
        clientId: clientId ?? undefined,
      });
    }
    try {
      await enableWarmup(id);
    } catch {
      // already on
    }
    if (clientId) {
      try {
        await assignAccountToClient(
          id,
          clientId,
          buildSignaturePlain(mailbox.first_name || '', mailbox.last_name || '', company),
        );
      } catch (err) {
        console.log(
          `Smartlead assign warning ${email}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    console.log(`Smartlead Google loaded ${email} id=${id} warmup on`);
  }

  if (microsoft.length) {
    const sequencerUid = await ensureSmartleadSequencer(workspaceId);
    const uids = microsoft.map((m) => m.uid);
    for (let i = 0; i < uids.length; i += 50) {
      await exportMailboxesToSequencer(workspaceId, sequencerUid, uids.slice(i, i + 50));
    }
    const pending = new Set(uids);
    for (let attempt = 0; attempt < 40 && pending.size; attempt++) {
      await sleep(15_000);
      const statuses = await getSequencerExportStatus(workspaceId, {
        sequencerUid,
        mailboxUids: [...pending],
        limit: 100,
      });
      for (const st of statuses) {
        const status = String(st.status || '').toLowerCase();
        if (!st.mailbox_uid || !pending.has(st.mailbox_uid)) continue;
        if (status === 'completed' || status === 'success') pending.delete(st.mailbox_uid);
        else if (status === 'failed' || status === 'errored' || status === 'cancelled') {
          pending.delete(st.mailbox_uid);
          console.log(`Microsoft export failed ${st.mailbox_email}: ${st.error_message || status}`);
        }
      }
    }
    const after = await listEmailAccounts();
    const byEmailAfter = new Map(
      after
        .map((a) => {
          const email = String(a.from_email || a.email || '').toLowerCase();
          return email && a.id != null ? ([email, Number(a.id)] as const) : null;
        })
        .filter((x): x is readonly [string, number] => Boolean(x)),
    );
    for (const mailbox of microsoft) {
      const email = (mailbox.email || `${mailbox.username}@${mailbox.domain_name}`).toLowerCase();
      const id = byEmailAfter.get(email);
      if (!id) {
        console.log(`Microsoft ${email} not yet in Smartlead`);
        continue;
      }
      try {
        await enableWarmup(id);
      } catch {
        // already on
      }
      if (clientId) {
        try {
          await assignAccountToClient(
            id,
            clientId,
            buildSignaturePlain(mailbox.first_name || '', mailbox.last_name || '', company),
          );
        } catch (err) {
          console.log(
            `Smartlead assign warning ${email}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`Smartlead Microsoft loaded ${email} id=${id} warmup on`);
    }
  }
}

async function main() {
  const mode = process.argv.includes('--execute')
    ? 'execute'
    : process.argv.includes('--check-only')
      ? 'check'
      : 'inventory';
  const skipPriceCheck = process.argv.includes('--skip-price-check');

  const inv = await inventory();
  if (mode === 'inventory') {
    console.log(JSON.stringify({ statePath: STATE_PATH, next: 'run --check-only' }));
    return;
  }

  const prices = skipPriceCheck ? pricesFromInventory(inv) : await priceCheck(inv);
  if (mode === 'check') {
    if (prices.overBudget) {
      throw new Error(`Aborting: estimated ${money(prices.total)} exceeds ${money(BUDGET_USD)} cap`);
    }
    return;
  }
  await execute(inv, prices);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
