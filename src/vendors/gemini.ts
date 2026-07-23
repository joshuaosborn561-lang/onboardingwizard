import { brandRootFromParent, generateAffixCandidates } from '../lib/domainNaming.js';
import type { BrandContext } from '../types.js';

/**
 * Sending domains are always .info affix variations of the client's primary domain.
 * e.g. roofsbypeterson.com → tryroofsbypeterson.info, roofsbypetersonnow.info
 */
export async function generateCandidateDomains(brand: BrandContext): Promise<string[]> {
  const root = brandRootFromParent(brand.websiteUrl);
  const domains = generateAffixCandidates({ websiteUrl: brand.websiteUrl }, 40);
  if (domains.length < 8) {
    throw new Error(
      `Could not generate enough .info variations of primary domain root "${root}"`,
    );
  }
  return domains;
}
