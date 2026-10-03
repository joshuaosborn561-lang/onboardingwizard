import { brandRootFromParent, buildDomainCandidates } from '../lib/domainNaming.js';
import type { NamingContext } from '../lib/namingGuards.js';
import { collectForbiddenTokens } from '../lib/namingGuards.js';
import type { BrandContext, DomainKind } from '../types.js';

/**
 * Prefer generic client-neutral .info names. Branded affix spins of the
 * primary domain are included only as a short fallback list.
 */
export async function generateCandidateDomains(
  brand: BrandContext,
  extra: NamingContext = {},
): Promise<Array<{ domain: string; kind: DomainKind }>> {
  const forbidden = collectForbiddenTokens({
    clientName: brand.clientName,
    companyName: extra.companyName,
    brandWords: brand.brandWords,
    websiteUrl: brand.websiteUrl,
    staffNames: extra.staffNames,
    industry: brand.industry,
  });
  const domains = buildDomainCandidates(
    {
      websiteUrl: brand.websiteUrl,
      brandWords: brand.brandWords,
      clientName: brand.clientName,
      forbiddenTokens: forbidden,
    },
    { genericLimit: 32, brandedLimit: 8 },
  );
  if (domains.filter((d) => d.kind === 'generic').length < 8) {
    const root = brandRootFromParent(brand.websiteUrl);
    throw new Error(
      `Could not generate enough generic .info domains (brand root "${root}")`,
    );
  }
  return domains;
}
