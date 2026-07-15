import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type { BrandContext } from '../types.js';

const FRAGMENTS = ['try', 'go', 'win', 'top', 'new', 'get', 'use', 'run', 'pro', 'hub', 'lab', 'hq'];

export async function generateCandidateDomains(brand: BrandContext): Promise<string[]> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey() });

  const prompt = `You generate cold-email sending domain names for an outreach agency.

Client name: ${brand.clientName}
Website: ${brand.websiteUrl}
Industry / context: ${brand.industry}
Brand words available: ${brand.brandWords.join(', ') || 'n/a'}
Site summary: ${brand.summary}

Rules:
- Return EXACTLY 20 domains
- Every domain MUST use the .info TLD
- Each domain MUST combine a relevant brand/industry word with a short 3-letter readable fragment as a prefix OR suffix
- Allowed fragments (use these, not random letters): ${FRAGMENTS.join(', ')}
- Examples of the pattern: tryacme.info, gogrowth.info, winlead.info, topmetrics.info, newprospect.info
- Domains must be lowercase, alphanumeric only (plus hyphen if needed), no spaces
- Prefer brand-adjacent words over random syllables
- Avoid trademark-heavy exact matches of huge brands when possible; bias toward industry + fragment

Respond with ONLY a JSON array of 20 strings, no markdown.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Claude did not return a JSON array of domains. Raw: ${text.slice(0, 400)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Domain response was not an array');

  const domains = parsed
    .map((d) => String(d).trim().toLowerCase())
    .filter((d) => /^[a-z0-9-]+\.info$/.test(d));

  const unique = Array.from(new Set(domains));
  if (unique.length < 10) {
    throw new Error(`Expected ~20 .info domains from Claude, got ${unique.length}`);
  }

  return unique.slice(0, 20);
}
