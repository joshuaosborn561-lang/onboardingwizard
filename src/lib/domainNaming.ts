/** Affixes ≤3 letters used for brand-spin domain names (from deliverabilitywizard). */
export const DOMAIN_AFFIXES = [
  'get',
  'try',
  'go',
  'use',
  'my',
  'lab',
  'pro',
  'hq',
  'now',
  'app',
  'hub',
  'box',
  'win',
  'top',
  'new',
  'run',
  'hey',
  'max',
  'key',
  'one',
  'all',
  'tip',
  'biz',
  'web',
] as const;

export type AffixSide = 'pre' | 'suf';

export interface DomainSpin {
  parent: string;
  root: string;
  domain: string;
  affix: string;
  side: AffixSide;
}

/** Strip TLD from a parent hostname → full brand root (roofsbypeterson.com → roofsbypeterson). */
export function brandRootFromParent(parent: string): string {
  const host = parent
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  const noTld = host.replace(
    /\.(com|net|org|io|info|co|ai|app|dev|me|us|biz)$/i,
    '',
  );
  return noTld.replace(/[-_.]/g, '');
}

export function isValidAffix(affix: string): boolean {
  return /^[a-z]{1,3}$/i.test(affix.trim());
}

/**
 * Build variations of the primary domain on .info:
 *   roofsbypeterson.com → tryroofsbypeterson.info, roofsbypetersonnow.info, …
 */
export function spinDomainName(
  parent: string,
  affix: string,
  side: AffixSide,
  tld = 'info',
): DomainSpin {
  const clean = affix.trim().toLowerCase();
  if (!isValidAffix(clean)) {
    throw new Error(`Affix must be 1–3 letters (got "${affix}")`);
  }
  const root = brandRootFromParent(parent);
  if (!root) throw new Error(`Could not derive brand root from ${parent}`);
  const label = side === 'pre' ? `${clean}${root}` : `${root}${clean}`;
  return {
    parent: parent.toLowerCase(),
    root,
    domain: `${label}.${tld.replace(/^\./, '').toLowerCase()}`,
    affix: clean,
    side,
  };
}

/** Generate candidate spins for a parent using the default affix list. */
export function generateDomainSpins(
  parent: string,
  opts: { tld?: string; affixes?: readonly string[]; limit?: number } = {},
): DomainSpin[] {
  const tld = opts.tld ?? 'info';
  const affixes = opts.affixes ?? DOMAIN_AFFIXES;
  const out: DomainSpin[] = [];
  const seen = new Set<string>();
  for (const affix of affixes) {
    for (const side of ['pre', 'suf'] as const) {
      const root = brandRootFromParent(parent);
      if (side === 'pre' && root.startsWith(affix)) continue;
      if (side === 'suf' && root.endsWith(affix)) continue;
      const spin = spinDomainName(parent, affix, side, tld);
      if (seen.has(spin.domain)) continue;
      seen.add(spin.domain);
      out.push(spin);
    }
  }
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/**
 * Build .info candidates as affix variations of the client's primary domain only.
 * Example: roofsbypeterson.com → tryroofsbypeterson.info, goroofsbypeterson.info, …
 */
export function generateAffixCandidates(
  inputs: { websiteUrl: string; brandWords?: string[]; clientName?: string },
  limit = 32,
): string[] {
  const spins = generateDomainSpins(inputs.websiteUrl, { tld: 'info' });
  return spins.map((s) => s.domain).slice(0, limit);
}
