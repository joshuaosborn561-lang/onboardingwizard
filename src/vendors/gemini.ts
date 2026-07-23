import { config } from '../config.js';
import { generateAffixCandidates } from '../lib/domainNaming.js';
import type { BrandContext } from '../types.js';

const FRAGMENTS = ['try', 'go', 'win', 'top', 'new', 'get', 'use', 'run', 'pro', 'hub', 'lab', 'hq'];

export async function generateCandidateDomains(brand: BrandContext): Promise<string[]> {
  try {
    return await generateWithGemini(brand);
  } catch (err) {
    console.warn(
      '[domains] Gemini generation failed, falling back to affix spins:',
      err instanceof Error ? err.message : err,
    );
    const fallback = generateAffixCandidates(
      {
        websiteUrl: brand.websiteUrl,
        brandWords: brand.brandWords,
        clientName: brand.clientName,
      },
      20,
    );
    if (fallback.length < 10) {
      throw new Error(
        `Domain generation failed (Gemini + affix fallback). Gemini: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return fallback;
  }
}

async function generateWithGemini(brand: BrandContext): Promise<string[]> {
  const apiKey = config.geminiApiKey();
  const model = config.geminiModel();

  const prompt = `You generate cold-email sending domain names for an outreach agency.

Client name: ${brand.clientName}
Website: ${brand.websiteUrl}
Industry / context: ${brand.industry}
Brand words available: ${brand.brandWords.join(', ') || 'n/a'}
Site summary: ${brand.summary}

Rules:
- Return EXACTLY 20 domains
- Every domain MUST use the .info TLD
- Each domain MUST combine a SHORT brand/industry stem (3–10 letters) with a short 3-letter readable fragment as a prefix OR suffix
- Allowed fragments (use these, not random letters): ${FRAGMENTS.join(', ')}
- Prefer the SHORTEST brand words from the list (e.g. "peterson", "roofs") — NEVER glue the full company slug (avoid "roofsbypeterson")
- Keep the full domain label under 18 characters before .info
- Examples of the pattern: trypeterson.info, goroofs.info, winroof.info, toppeterson.info
- Domains must be lowercase, alphanumeric only (plus hyphen if needed), no spaces
- Avoid trademark-heavy exact matches of huge brands when possible; bias toward industry + fragment

Respond with ONLY a JSON array of 20 strings, no markdown.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'ClientOnboardingAutomation/1.0 (+railway)',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (!res.ok) {
    throw new Error(`Gemini domain generation failed: ${data.error?.message || res.status}`);
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('\n')
    .trim();

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Gemini did not return a JSON array of domains. Raw: ${text.slice(0, 400)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]) as unknown;
  if (!Array.isArray(parsed)) throw new Error('Domain response was not an array');

  const domains = parsed
    .map((d) => String(d).trim().toLowerCase())
    .filter((d) => /^[a-z0-9-]+\.info$/.test(d));

  const unique = Array.from(new Set(domains));
  if (unique.length < 10) {
    throw new Error(`Expected ~20 .info domains from Gemini, got ${unique.length}`);
  }

  // Drop overly long labels; fill from affix spins on short brand words.
  const short = unique.filter((d) => d.replace(/\.info$/, '').length <= 18);
  if (short.length >= 12) return short.slice(0, 20);

  const fill = generateAffixCandidates(
    {
      websiteUrl: brand.websiteUrl,
      brandWords: brand.brandWords,
      clientName: brand.clientName,
    },
    20,
  );
  return Array.from(new Set([...short, ...fill])).slice(0, 20);
}
