/**
 * Domain blacklist check. A SURBL listing is allowed; any other listing blocks.
 * Lookup is injectable so tests never hit the network.
 *
 * Return-code rules:
 *   Spamhaus 127.255.255.x / URIBL 127.0.0.1 = query refused → unknown (not listed)
 *   DNS errors (timeout, SERVFAIL, …) = unknown — never "clean"
 *   NXDOMAIN / no data = clean (not listed)
 *   SURBL is still ignored even when listed or unknown
 */
import { promises as dns } from 'node:dns';
import { IGNORED_BLACKLISTS } from './standards.js';

export const SURBL_ZONES = ['multi.surbl.org'] as const;

/** Zones that block a candidate. SURBL is intentionally absent. */
export const BLOCKING_RBL_ZONES = [
  'dbl.spamhaus.org',
  'multi.uribl.org',
  'black.uribl.org',
] as const;

export const CHECKED_RBL_ZONES = [...BLOCKING_RBL_ZONES, ...SURBL_ZONES] as const;

export type DnsLookup = (hostname: string) => Promise<string[]>;

export type ListingStatus = 'listed' | 'clean' | 'unknown';

export interface BlacklistListing {
  zone: string;
  status: ListingStatus;
  listed: boolean;
  ignored: boolean;
  returnCodes?: string[];
}

export interface BlacklistVerdict {
  domain: string;
  /** Listed or unknown on a non-SURBL zone — do not buy until a human decides. */
  blocked: boolean;
  unknown: boolean;
  listings: BlacklistListing[];
  ignoredSurbl: boolean;
}

export function isSurblZone(zone: string): boolean {
  const lower = zone.trim().toLowerCase();
  if (SURBL_ZONES.some((z) => lower === z || lower.endsWith(`.${z}`))) return true;
  return IGNORED_BLACKLISTS.some((name) => lower.includes(name.toLowerCase()));
}

export function rblQueryName(domain: string, zone: string): string {
  return `${domain.trim().toLowerCase().replace(/\.$/, '')}.${zone}`;
}

/** Spamhaus DBL / URIBL "query refused" codes are not listings. */
export function isQueryRefused(zone: string, answers: readonly string[]): boolean {
  const lower = zone.toLowerCase();
  if (lower.includes('spamhaus')) {
    return answers.some((ip) => /^127\.255\.255\./.test(ip));
  }
  if (lower.includes('uribl')) {
    return answers.some((ip) => ip === '127.0.0.1');
  }
  return false;
}

export function classifyRblAnswers(zone: string, answers: readonly string[]): ListingStatus {
  if (!answers.length) return 'clean';
  if (isQueryRefused(zone, answers)) return 'unknown';
  return 'listed';
}

export function verdictFromListings(
  domain: string,
  listings: Array<Pick<BlacklistListing, 'zone' | 'ignored'> & Partial<BlacklistListing>>,
): BlacklistVerdict {
  const normalized: BlacklistListing[] = listings.map((l) => {
    const status: ListingStatus = l.status ?? (l.listed ? 'listed' : 'clean');
    return {
      zone: l.zone,
      status,
      listed: status === 'listed',
      ignored: l.ignored,
      returnCodes: l.returnCodes,
    };
  });
  const ignoredSurbl = normalized.some((l) => l.ignored && (l.listed || l.status === 'listed'));
  const unknown = normalized.some((l) => !l.ignored && l.status === 'unknown');
  const listed = normalized.some((l) => !l.ignored && l.status === 'listed');
  return {
    domain: domain.trim().toLowerCase(),
    blocked: listed || unknown,
    unknown,
    listings: normalized,
    ignoredSurbl,
  };
}

const CLEAN_NX_CODES = new Set(['ENOTFOUND', 'ENODATA', 'ENOTIMP']);

async function defaultLookup(hostname: string): Promise<string[]> {
  try {
    return await dns.resolve4(hostname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code && CLEAN_NX_CODES.has(code)) return [];
    throw err;
  }
}

/**
 * Query domain RBLs. SURBL hits are recorded and ignored.
 * Query-refused codes and DNS errors are `unknown` (block buy pending human).
 */
export async function checkDomainBlacklists(
  domain: string,
  lookup: DnsLookup = defaultLookup,
): Promise<BlacklistVerdict> {
  const host = domain.trim().toLowerCase();
  const listings: BlacklistListing[] = [];
  for (const zone of CHECKED_RBL_ZONES) {
    const ignored = isSurblZone(zone);
    try {
      const answers = await lookup(rblQueryName(host, zone));
      const status = classifyRblAnswers(zone, answers);
      listings.push({
        zone,
        status,
        listed: status === 'listed',
        ignored,
        returnCodes: answers,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const status: ListingStatus =
        code && CLEAN_NX_CODES.has(code) ? 'clean' : 'unknown';
      listings.push({ zone, status, listed: false, ignored });
    }
  }
  return verdictFromListings(host, listings);
}

export function blacklistErrorMessage(verdict: BlacklistVerdict): string {
  const blockers = verdict.listings
    .filter((l) => !l.ignored && l.status === 'listed')
    .map((l) => l.zone);
  const unknowns = verdict.listings
    .filter((l) => !l.ignored && l.status === 'unknown')
    .map((l) => l.zone);
  if (blockers.length) return `blacklist listing (non-SURBL): ${blockers.join(', ')}`;
  if (unknowns.length) {
    return `blacklist query unknown (block buy pending human): ${unknowns.join(', ')}`;
  }
  return 'blacklist listing (non-SURBL)';
}
