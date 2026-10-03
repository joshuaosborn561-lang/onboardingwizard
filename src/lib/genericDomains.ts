/**
 * Client-neutral .info sending domains. No client, staff, or industry words.
 */
import { domainHasClientToken } from './namingGuards.js';

const STEMS = [
  'north',
  'south',
  'east',
  'west',
  'cedar',
  'maple',
  'oak',
  'pine',
  'river',
  'lake',
  'stone',
  'silver',
  'golden',
  'quiet',
  'open',
  'bright',
  'clear',
  'calm',
  'wide',
  'fair',
  'true',
  'swift',
  'still',
  'warm',
  'cool',
  'soft',
  'amber',
  'coral',
  'ivory',
  'linen',
  'moss',
  'pearl',
] as const;

const TAILS = [
  'harbor',
  'meadow',
  'lane',
  'field',
  'grove',
  'point',
  'creek',
  'valley',
  'terrace',
  'court',
  'place',
  'view',
  'crest',
  'glen',
  'park',
  'mill',
  'bridge',
  'crossing',
  'landing',
  'trail',
  'hollow',
  'forge',
  'haven',
  'brook',
] as const;

export function generateGenericDomains(
  opts: { forbiddenTokens?: Iterable<string>; limit?: number; tld?: string } = {},
): string[] {
  const forbidden = [...(opts.forbiddenTokens || [])];
  const tld = (opts.tld || 'info').replace(/^\./, '').toLowerCase();
  const limit = opts.limit ?? 32;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const stem of STEMS) {
    for (const tail of TAILS) {
      const label = `${stem}${tail}`;
      const domain = `${label}.${tld}`;
      if (seen.has(domain)) continue;
      if (domainHasClientToken(domain, forbidden)) continue;
      seen.add(domain);
      out.push(domain);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
