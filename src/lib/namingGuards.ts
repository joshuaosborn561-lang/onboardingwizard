/**
 * STANDARDS naming guards: made-up personas only, letters-only usernames,
 * max 2 inboxes/domain, generic domains preferred. Never uses client/staff names.
 */
import { allocateMailboxIdentities, makeUsername, type MailboxIdentity } from './mailboxNames.js';
import { INBOXES_PER_DOMAIN } from './opsRules.js';
import type { MailboxPlanSlot, Platform } from '../types.js';

export const LETTERS_ONLY_USERNAME = /^[a-z]+(?:[._][a-z]+)*$/;

/** Common words that are not client/staff identifiers. */
const TOKEN_STOP_WORDS = new Set([
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
  'company',
  'llc',
  'inc',
  'corp',
  'ltd',
  'group',
  'business',
  'services',
  'solutions',
  'team',
  'about',
  'contact',
]);

export type DomainKind = 'generic' | 'branded';

export interface NamingContext {
  clientName?: string;
  companyName?: string;
  brandWords?: string[];
  websiteUrl?: string;
  staffNames?: string[];
  industry?: string;
}

export interface PersonaInput {
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface GuardedMailboxPlan {
  plan: MailboxPlanSlot[];
  rewritten: Array<{
    domain: string;
    from: string;
    to: string;
    reason: string;
  }>;
}

export function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function tokenizeNameText(value: string): string[] {
  const raw = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/\s+/)) {
    if (part.length < 3 || TOKEN_STOP_WORDS.has(part)) continue;
    out.push(part);
  }
  return out;
}

function hostLabel(websiteUrl: string): string {
  try {
    const host = new URL(
      /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`,
    ).hostname.replace(/^www\./, '');
    return host.split('.')[0] || '';
  } catch {
    return websiteUrl.replace(/^https?:\/\//i, '').replace(/^www\./, '').split(/[./]/)[0] || '';
  }
}

/** Client + staff tokens that must never appear in personas, usernames, or generic domains. */
export function collectForbiddenTokens(input: NamingContext): string[] {
  const tokens = new Set<string>();
  const add = (value?: string) => {
    for (const t of tokenizeNameText(value || '')) tokens.add(t);
  };
  add(input.clientName);
  add(input.companyName);
  add(input.industry);
  add(input.websiteUrl ? hostLabel(input.websiteUrl) : '');
  for (const word of input.brandWords || []) add(word);
  for (const name of input.staffNames || []) add(name);
  return [...tokens];
}

export function parseStaffNames(input?: string | string[] | null): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input.join(',') : input;
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function personaHitTokens(persona: PersonaInput, forbidden: Iterable<string>): string[] {
  const forbiddenSet = new Set(
    [...forbidden].map((t) => normalizeToken(t)).filter((t) => t.length >= 3),
  );
  if (!forbiddenSet.size) return [];
  const haystack = new Set<string>([
    ...tokenizeNameText(persona.firstName || ''),
    ...tokenizeNameText(persona.lastName || ''),
    ...tokenizeNameText((persona.username || '').replace(/[._]/g, ' ')),
  ]);
  const hits: string[] = [];
  for (const token of forbiddenSet) {
    if (haystack.has(token)) hits.push(token);
  }
  return hits;
}

export function isLettersOnlyUsername(username: string): boolean {
  return LETTERS_ONLY_USERNAME.test(username.trim().toLowerCase());
}

export function countInboxesByDomain(
  plan: Array<{ domain: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of plan) {
    const key = row.domain.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/** Reject plans that put more than 2 inboxes on any domain. */
export function assertMaxInboxesPerDomain(plan: Array<{ domain: string }>): void {
  for (const [domain, count] of countInboxesByDomain(plan)) {
    if (count > INBOXES_PER_DOMAIN) {
      throw new Error(
        `Max ${INBOXES_PER_DOMAIN} inboxes per domain (got ${count} on ${domain})`,
      );
    }
  }
}

export function domainLabel(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z]/g, '');
}

export function domainHasClientToken(domain: string, forbidden: Iterable<string>): boolean {
  const label = domainLabel(domain);
  if (!label) return false;
  for (const raw of forbidden) {
    const token = normalizeToken(raw);
    if (token.length >= 4 && label.includes(token)) return true;
    if (token.length === 3 && (label === token || label.startsWith(token) || label.endsWith(token))) {
      return true;
    }
  }
  return false;
}

export function classifyDomainKind(
  domain: string,
  forbidden: Iterable<string>,
): DomainKind {
  return domainHasClientToken(domain, forbidden) ? 'branded' : 'generic';
}

/** Generic domains stay unforwarded; branded domains may forward to the client site. */
export function shouldForwardDomain(kind: DomainKind | undefined): boolean {
  return kind !== 'generic';
}

export function allocateNeutralIdentities(
  count: number,
  forbidden: Iterable<string>,
): MailboxIdentity[] {
  if (count <= 0) return [];
  const forbiddenList = [...forbidden];
  const usedUser = new Set<string>();
  const usedFirst = new Set<string>();
  const usedLast = new Set<string>();
  const out: MailboxIdentity[] = [];

  let guard = 0;
  while (out.length < count && guard < 12) {
    const batch = allocateMailboxIdentities(Math.max(count * 3, 40));
    for (const id of batch) {
      if (personaHitTokens(idToPersona(id), forbiddenList).length) continue;
      const first = id.first_name.toLowerCase();
      const last = id.last_name.toLowerCase();
      if (usedFirst.has(first) || usedLast.has(last) || usedUser.has(id.username)) continue;
      if (!isLettersOnlyUsername(id.username)) continue;
      usedFirst.add(first);
      usedLast.add(last);
      usedUser.add(id.username);
      out.push(id);
      if (out.length >= count) break;
    }
    guard += 1;
  }

  while (out.length < count) {
    const [fresh] = allocateMailboxIdentities(1);
    if (!fresh) break;
    const username = makeUsername(fresh.first_name, fresh.last_name, usedUser);
    const candidate: MailboxIdentity = { ...fresh, username };
    if (personaHitTokens(idToPersona(candidate), forbiddenList).length) continue;
    if (!isLettersOnlyUsername(username)) continue;
    out.push(candidate);
  }

  return out.slice(0, count);
}

function idToPersona(id: MailboxIdentity): PersonaInput {
  return { firstName: id.first_name, lastName: id.last_name, username: id.username };
}

function displayName(first: string, last: string, username: string): string {
  const named = `${first} ${last}`.trim();
  return named || username;
}

/**
 * Keep valid made-up identities. Rewrite client/staff names, digit usernames,
 * and non-unique local-parts. Rejects >2 inboxes/domain.
 */
export function guardMailboxPlan(
  plan: Array<{
    domain: string;
    platform: Platform;
    firstName?: string;
    lastName?: string;
    username?: string;
  }>,
  context: NamingContext,
  opts: { enforceMaxPerDomain?: boolean } = {},
): GuardedMailboxPlan {
  if (opts.enforceMaxPerDomain !== false) {
    assertMaxInboxesPerDomain(plan);
  }
  const forbidden = collectForbiddenTokens(context);
  const usedUser = new Set<string>();
  const usedFirst = new Set<string>();
  const usedLast = new Set<string>();
  const rewritten: GuardedMailboxPlan['rewritten'] = [];

  const need = plan.filter((row) => {
    const username = (row.username || '').trim().toLowerCase();
    const hits = personaHitTokens(row, forbidden);
    return (
      !row.firstName ||
      !row.lastName ||
      !username ||
      !isLettersOnlyUsername(username) ||
      hits.length > 0
    );
  }).length;
  const fresh = allocateNeutralIdentities(Math.max(need * 3, need + 8, 8), forbidden);
  let fi = 0;

  const nextIdentity = (): MailboxIdentity => {
    while (fi < fresh.length) {
      const id = fresh[fi++]!;
      if (
        usedFirst.has(id.first_name.toLowerCase()) ||
        usedLast.has(id.last_name.toLowerCase()) ||
        usedUser.has(id.username)
      ) {
        continue;
      }
      return id;
    }
    const more = allocateNeutralIdentities(8, [
      ...forbidden,
      ...usedFirst,
      ...usedLast,
    ]);
    for (const id of more) {
      if (
        usedFirst.has(id.first_name.toLowerCase()) ||
        usedLast.has(id.last_name.toLowerCase()) ||
        usedUser.has(id.username)
      ) {
        continue;
      }
      return id;
    }
    const fallback = allocateMailboxIdentities(1)[0]!;
    return {
      ...fallback,
      username: makeUsername(fallback.first_name, fallback.last_name, usedUser),
    };
  };

  const guarded = plan.map((row) => {
    const username = (row.username || '').trim().toLowerCase();
    const hits = personaHitTokens(row, forbidden);
    const invalidUser = !username || !isLettersOnlyUsername(username) || usedUser.has(username);
    const needsRewrite = !row.firstName || !row.lastName || invalidUser || hits.length > 0;

    if (!needsRewrite) {
      usedFirst.add(row.firstName!.toLowerCase());
      usedLast.add(row.lastName!.toLowerCase());
      usedUser.add(username);
      return {
        domain: row.domain,
        platform: row.platform,
        firstName: row.firstName!,
        lastName: row.lastName!,
        username,
      };
    }

    const id = nextIdentity();
    usedFirst.add(id.first_name.toLowerCase());
    usedLast.add(id.last_name.toLowerCase());
    usedUser.add(id.username);
    const reason = hits.length
      ? `client/staff token (${hits.join(', ')})`
      : invalidUser
        ? 'username must be unique letters-only'
        : 'missing identity';
    rewritten.push({
      domain: row.domain,
      from: displayName(row.firstName || '', row.lastName || '', username),
      to: displayName(id.first_name, id.last_name, id.username),
      reason,
    });
    return {
      domain: row.domain,
      platform: row.platform,
      firstName: id.first_name,
      lastName: id.last_name,
      username: id.username,
    };
  });

  return { plan: guarded, rewritten };
}
