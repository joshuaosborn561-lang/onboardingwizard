import * as cheerio from 'cheerio';
import type { BrandContext } from '../types.js';

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export async function ingestWebsite(websiteUrl: string): Promise<BrandContext> {
  const url = normalizeUrl(websiteUrl);
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; ClientOnboardingBot/1.0; +https://railway.app)',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch website (${res.status}): ${url}`);
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
  const clientName = pageTitle || hostLabel;

  const brandWords = Array.from(
    new Set(
      [clientName, hostLabel, h1]
        .flatMap((s) =>
          s
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .split(/[\s-]+/)
            .filter((w) => w.length >= 3 && w.length <= 16),
        )
        .filter(Boolean),
    ),
  ).slice(0, 12);

  return {
    websiteUrl: url,
    clientName,
    industry: description.slice(0, 160) || 'business services',
    brandWords,
    summary: [description, h1, bodyText.slice(0, 800)].filter(Boolean).join(' — ').slice(0, 1500),
    pageTitle,
    pageTextSample: bodyText.slice(0, 2500),
  };
}
