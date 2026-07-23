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
] as const;

export type AffixSide = 'pre' | 'suf';

export interface DomainSpin {
  parent: string;
  root: string;
  domain: string;
  affix: string;
  side: AffixSide;
}

/** Strip TLD + common filler words from a parent hostname → brand root. */
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
  return noTld.replace(/^the/, '').replace(/[-_.]/g, '');
}

export function isValidAffix(affix: string): boolean {
  return /^[a-z]{1,3}$/i.test(affix.trim());
}

/** Build `getbrand.info` or `brandlab.info` style spins. */
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
 * Build up to `limit` .info candidates from brand context without an LLM.
 * Tries each brand word + website host as parents.
 */
export function generateAffixCandidates(
  inputs: { websiteUrl: string; brandWords: string[]; clientName?: string },
  limit = 20,
): string[] {
  // Prefer short stems so names stay registerable (full slugs like roofsbypeterson are usually taken).
  const stems = Array.from(
    new Set(
      [
        ...inputs.brandWords,
        ...(inputs.clientName ? inputs.clientName.split(/\s+/) : []),
        brandRootFromParent(inputs.websiteUrl),
      ]
        .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length >= 3 && w.length <= 12),
    ),
  ).sort((a, b) => a.length - b.length);

  const parents = stems.map((s) => `${s}.com`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const parent of parents) {
    for (const spin of generateDomainSpins(parent, { tld: 'info' })) {
      if (seen.has(spin.domain)) continue;
      if (!/^[a-z0-9-]+\.info$/.test(spin.domain)) continue;
      const label = spin.domain.replace(/\.info$/, '');
      if (label.length > 18) continue;
      seen.add(spin.domain);
      out.push(spin.domain);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
