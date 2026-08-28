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

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 15_000;

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

export function fetchCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) return `${err.message}: ${cause.message}`;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return `${err.message}: ${String((cause as { code?: string }).code)}`;
  }
  return err.message;
}

/** Brand context when the live site cannot be scraped (TLS, SSO bounce, HTTP error). */
export function fallbackBrand(url: string, companyName?: string): BrandContext {
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

function alternateHostUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.startsWith('www.')
    ? parsed.hostname.slice(4)
    : `www.${parsed.hostname}`;
  return parsed.toString();
}

function hostnameOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

function isOffSiteOrSso(finalUrl: string, originalUrl: string): boolean {
  let host: string;
  try {
    host = new URL(finalUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (
    /login\.microsoftonline\.com|login\.windows\.net|accounts\.google\.com|(^|\.)okta\.com|(^|\.)auth0\.com/i.test(
      host,
    )
  ) {
    return true;
  }
  const originalHost = hostnameOf(originalUrl);
  const finalHost = host.replace(/^www\./, '');
  return finalHost !== originalHost && !finalHost.endsWith(`.${originalHost}`);
}

async function fetchPage(url: string): Promise<{ res: Response } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    return { res };
  } catch (err) {
    return { error: fetchCause(err) };
  } finally {
    clearTimeout(timer);
  }
}

function parseBrand(requestedUrl: string, html: string): BrandContext {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe').remove();

  const pageTitle =
    $('meta[property="og:site_name"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    new URL(requestedUrl).hostname.replace(/^www\./, '');

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    '';

  const h1 = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);

  const hostLabel = new URL(requestedUrl).hostname.replace(/^www\./, '').split('.')[0] || pageTitle;
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

  const prettyName = brandWords.length
    ? brandWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : clientName;

  return {
    websiteUrl: requestedUrl,
    clientName:
      pageTitle && !pageTitle.toLowerCase().includes('.com') ? pageTitle : prettyName,
    industry: description.slice(0, 160) || 'business services',
    brandWords,
    summary: [description, h1, bodyText.slice(0, 800)].filter(Boolean).join(' — ').slice(0, 1500),
    pageTitle,
    pageTextSample: bodyText.slice(0, 2500),
  };
}

/**
 * Scrape brand context from the client site. Never throws — TLS/apex-cert
 * mismatches, SSO bounces, and HTTP errors fall back to the typed company name.
 */
export async function ingestWebsite(
  websiteUrl: string,
  opts: { companyName?: string } = {},
): Promise<BrandContext> {
  const url = normalizeUrl(websiteUrl);
  const candidates = [url, alternateHostUrl(url)];
  const tried: string[] = [];

  for (const candidate of candidates) {
    const result = await fetchPage(candidate);
    if ('error' in result) {
      tried.push(`${candidate} (${result.error})`);
      continue;
    }
    if (!result.res.ok) {
      tried.push(`${candidate} (HTTP ${result.res.status})`);
      continue;
    }
    const finalUrl = result.res.url || candidate;
    if (isOffSiteOrSso(finalUrl, url)) {
      tried.push(`${candidate} redirected off-site to ${finalUrl}`);
      continue;
    }
    return parseBrand(url, await result.res.text());
  }

  const brand = fallbackBrand(url, opts.companyName);
  brand.summary = `Website scrape skipped (${tried.join('; ') || 'unknown'}). Using ${brand.clientName}.`;
  return brand;
}
