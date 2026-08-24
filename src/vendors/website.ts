import * as cheerio from 'cheerio';
import type { BrandContext } from '../types.js';

const STOP_WORDS = new Set([
  'com',
  'net',
  'org',
  'info',
  'www',
  'the',
  'and',
  'for',
  'with',
  'from',
  'your',
  'our',
  'home',
  'page',
  'site',
  'official',
]);

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Split compound host labels like roofsbypeterson → roofs, peterson. */
export function splitBrandTokens(raw: string): string[] {
  const lower = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parts: string[] = [];
  for (const chunk of lower.split(/\s+/).filter(Boolean)) {
    const glued = splitGluedHostname(chunk);
    for (const g of glued) {
      if (/^[a-z]{3,16}$/.test(g) && !STOP_WORDS.has(g)) parts.push(g);
    }
  }
  return parts;
}

/** Only split on connectors when BOTH sides are real words (≥3 letters). */
function splitGluedHostname(chunk: string): string[] {
  const m = chunk.match(/^([a-z]{3,})(?:by|and|for|with)([a-z]{3,})$/);
  if (m) return [m[1]!, m[2]!];
  return [chunk];
}

function fallbackBrand(url: string, companyName?: string): BrandContext {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const hostLabel = host.split('.')[0] || host;
  const clientName = companyName?.trim() || hostLabel;
  const brandWords = Array.from(
    new Set([clientName, hostLabel].flatMap((s) => splitBrandTokens(s))),
  ).slice(0, 16);
  return {
    websiteUrl: url,
    clientName,
    industry: 'business services',
    brandWords,
    summary: `${clientName} (${host})`,
    pageTitle: clientName,
    pageTextSample: '',
  };
}

function fetchCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${err.message}: ${cause.message}`;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `${err.message}: ${String((cause as { code?: string }).code)}`;
  }
  return err.message;
}

export async function ingestWebsite(
  websiteUrl: string,
  opts: { companyName?: string } = {},
): Promise<BrandContext> {
  const url = normalizeUrl(websiteUrl);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err) {
    // TLS handshake failures (common on WAF-protected sites) must not block onboarding.
    const brand = fallbackBrand(url, opts.companyName);
    brand.summary = `Website fetch skipped (${fetchCause(err)}). Using ${brand.clientName}.`;
    return brand;
  }

  if (!res.ok) {
    const brand = fallbackBrand(url, opts.companyName);
    brand.summary = `Website fetch returned ${res.status}. Using ${brand.clientName}.`;
    return brand;
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();

  const pageTitle =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    new URL(url).hostname.replace(/^www\./, '');

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);

  const hostLabel = new URL(url).hostname.replace(/^www\./, '').split('.')[0] || pageTitle;
  const spacedHost = hostLabel.replace(/([a-z])([A-Z])/g, '$1 $2');
  const clientName =
    pageTitle && !/^[\w.-]+\.(com|net|org|info)$/i.test(pageTitle)
      ? pageTitle
      : spacedHost.replace(/by/i, ' by ') || hostLabel;

  const brandWords = Array.from(
    new Set(
      [clientName, hostLabel, spacedHost, h1, description.slice(0, 200)]
        .flatMap((s) => splitBrandTokens(s))
        .filter((w) => w.length >= 3 && w.length <= 14),
    ),
  ).slice(0, 16);

  // Prefer a human company name when the title is just the hostname
  const prettyName = brandWords.length
    ? brandWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : clientName;

  return {
    websiteUrl: url,
    clientName:
      pageTitle && !pageTitle.toLowerCase().includes('.com') ? pageTitle : prettyName,
    industry: description.slice(0, 160) || 'business services',
    brandWords,
    summary: [description, h1, bodyText.slice(0, 800)].filter(Boolean).join(' — ').slice(0, 1500),
    pageTitle,
    pageTextSample: bodyText.slice(0, 2500),
  };
}
