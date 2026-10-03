/**
 * Domain blacklist check. A SURBL listing is allowed; any other listing blocks.
 * Lookup is injectable so tests never hit the network.
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

export interface BlacklistListing {
  zone: string;
  listed: boolean;
  ignored: boolean;
}

export interface BlacklistVerdict {
  domain: string;
  blocked: boolean;
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

export function verdictFromListings(
  domain: string,
  listings: BlacklistListing[],
): BlacklistVerdict {
  const ignoredSurbl = listings.some((l) => l.listed && l.ignored);
  const blocked = listings.some((l) => l.listed && !l.ignored);
  return {
    domain: domain.trim().toLowerCase(),
    blocked,
    listings,
    ignoredSurbl,
  };
}

async function defaultLookup(hostname: string): Promise<string[]> {
  try {
    return await dns.resolve4(hostname);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL' || code === 'ENOTIMP') {
      return [];
    }
    throw err;
  }
}

/**
 * Query domain RBLs. SURBL hits are recorded and ignored.
 * Lookup failures on a single zone are treated as "not listed" (not a listing).
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
      listings.push({
        zone,
        listed: answers.length > 0,
        ignored,
      });
    } catch {
      listings.push({ zone, listed: false, ignored });
    }
  }
  return verdictFromListings(host, listings);
}

export function blacklistErrorMessage(verdict: BlacklistVerdict): string {
  const blockers = verdict.listings.filter((l) => l.listed && !l.ignored).map((l) => l.zone);
  return `blacklist listing (non-SURBL): ${blockers.join(', ')}`;
}
