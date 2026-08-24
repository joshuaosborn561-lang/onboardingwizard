/**
 * Gap-fill Culture Fits + Parlay to 50 senders each.
 * Hard cap: $172 total new spend. Does not enable InboxKit warmup.
 *
 * Usage: npx tsx scripts/gap-fill-culture-fits-parlay.ts [--check-only]
 */
import { listWorkspaces } from '../src/vendors/inboxkit.js';
import { listClients } from '../src/vendors/smartlead.js';
import { checkDomainThrottled, getAccountBalance } from '../src/vendors/porkbun.js';

const BUDGET_USD = 172;
const MAILBOX_RATE = 2.5;

const CULTURE_FITS = {
  name: 'Culture Fits',
  website: 'https://culture-fits.com',
  domains: {
    GOOGLE: [
      'tryculturefits.info',
      'goculturefits.info',
      'getculturefits.info',
      'nowculturefits.info',
    ],
    MICROSOFT: [
      'useculturefits.info',
      'proculturefits.info',
      'hqculturefits.info',
      'winculturefits.info',
      'topculturefits.info',
      'newculturefits.info',
    ],
  },
};

const PARLAY = {
  name: 'Parlay',
  website: 'https://parlaytech.net',
  domains: {
    GOOGLE: ['tryparlay.info', 'getparlay.info', 'nowparlay.info', 'useparlay.info'],
    MICROSOFT: [
      'myparlay.info',
      'proparlay.info',
      'hqparlay.info',
      'winparlay.info',
      'topparlay.info',
      'newparlay.info',
    ],
  },
};

function matchName(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = needle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return h.includes(n) || n.includes(h);
}

async function main() {
  const checkOnly = process.argv.includes('--check-only');
  const porkbun = {
    apiKey: process.env.PORKBUN_API_KEY?.trim() || '',
    secretApiKey: process.env.PORKBUN_SECRET_API_KEY?.trim() || '',
  };
  if (!process.env.INBOXKIT_API_KEY) throw new Error('Missing INBOXKIT_API_KEY');
  if (!process.env.SMARTLEAD_API_KEY) throw new Error('Missing SMARTLEAD_API_KEY');
  if (!porkbun.apiKey || !porkbun.secretApiKey) throw new Error('Missing Porkbun keys');

  const workspaces = await listWorkspaces();
  const clients = await listClients();
  console.log(
    JSON.stringify(
      {
        workspaces: workspaces.map((w) => ({
          id: w.uid || w.id,
          name: w.name,
        })),
        smartleadClients: clients,
      },
      null,
      2,
    ),
  );

  const cfWs = workspaces.find((w) => matchName(String(w.name || ''), 'culturefit'));
  const parlayWs = workspaces.find((w) => matchName(String(w.name || ''), 'parlay'));
  const cfClient = clients.find((c) => matchName(String(c.name || ''), 'culturefit'));
  const parlayClient = clients.find((c) => matchName(String(c.name || ''), 'parlay'));

  console.log(
    JSON.stringify(
      {
        matched: {
          cultureFitsWorkspace: cfWs?.uid || cfWs?.id || null,
          parlayWorkspace: parlayWs?.uid || parlayWs?.id || null,
          cultureFitsSmartlead: cfClient?.id || null,
          parlaySmartlead: parlayClient?.id || null,
        },
      },
      null,
      2,
    ),
  );

  const domains = [
    ...CULTURE_FITS.domains.GOOGLE,
    ...CULTURE_FITS.domains.MICROSOFT,
    ...PARLAY.domains.GOOGLE,
    ...PARLAY.domains.MICROSOFT,
  ];
  const checks = [];
  for (const domain of domains) {
    const result = await checkDomainThrottled(domain, porkbun);
    checks.push({
      domain,
      available: result.available,
      priceUsd: result.priceUsd,
      priceCents: result.priceCents,
    });
  }
  const domainCost = checks.reduce((sum, row) => sum + (row.priceCents ?? 360), 0) / 100;
  const mailboxCost = 40 * MAILBOX_RATE;
  const total = domainCost + mailboxCost;
  const unavailable = checks.filter((row) => !row.available);
  console.log(
    JSON.stringify(
      {
        checks,
        domainCost,
        mailboxCost,
        total,
        budget: BUDGET_USD,
        overBudget: total > BUDGET_USD + 0.01,
        unavailable,
      },
      null,
      2,
    ),
  );

  if (checkOnly) return;
  if (unavailable.length) {
    throw new Error(`Unavailable domains: ${unavailable.map((d) => d.domain).join(', ')}`);
  }
  if (total > BUDGET_USD + 0.01) {
    throw new Error(`Aborting: estimated $${total.toFixed(2)} exceeds $${BUDGET_USD} cap`);
  }
  if (!cfWs || !parlayWs || !cfClient || !parlayClient) {
    throw new Error('Could not uniquely match both InboxKit workspaces and Smartlead clients');
  }

  const balance = await getAccountBalance(porkbun);
  console.log(JSON.stringify({ porkbunBalance: balance.display }, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
