/**
 * Neutral-persona guards for existing mailboxes.
 *
 * STANDARDS: never use the client's name or any real client staff name in
 * inbox local parts, display names, or personas. Usernames are letters only.
 */

const STOPWORDS = new Set([
  'llc',
  'inc',
  'ltd',
  'co',
  'com',
  'net',
  'org',
  'info',
  'company',
  'corp',
  'corporation',
  'group',
  'the',
  'and',
  'of',
  'for',
  'a',
  'an',
  'to',
  'by',
  'at',
  'services',
  'service',
  'solutions',
  'holdings',
  'partners',
  'associates',
  'agency',
  'team',
  'official',
]);

const MIN_TOKEN_LENGTH = 3;

export interface PersonaSourceNames {
  clientName?: string;
  companyName?: string;
  staffNames?: string[];
  extra?: string[];
}

export interface PersonaMailboxFields {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
}

export interface PersonaViolation {
  field: 'firstName' | 'lastName' | 'username' | 'email';
  token: string;
  reason: 'client_or_staff_name' | 'digits_in_username';
}

export function asciiFold(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function tokenizePersonaText(value: string): string[] {
  const folded = asciiFold(value).trim();
  if (!folded) return [];
  const parts = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const collapsed = folded.replace(/[^a-z0-9]+/g, '');
  const out = new Set<string>();
  for (const part of parts) out.add(part);
  if (collapsed) out.add(collapsed);
  return [...out];
}

export function isStopwordToken(token: string): boolean {
  return STOPWORDS.has(asciiFold(token));
}

export function forbiddenPersonaTokens(input: PersonaSourceNames): string[] {
  const raw: string[] = [];
  if (input.clientName) raw.push(input.clientName);
  if (input.companyName) raw.push(input.companyName);
  for (const name of input.staffNames || []) raw.push(name);
  for (const name of input.extra || []) raw.push(name);

  const tokens = new Set<string>();
  for (const value of raw) {
    for (const token of tokenizePersonaText(value)) {
      if (token.length < MIN_TOKEN_LENGTH) continue;
      if (isStopwordToken(token)) continue;
      if (/^\d+$/.test(token)) continue;
      tokens.add(token);
    }
  }
  return [...tokens].sort();
}

export function mailboxPersonaTokens(mailbox: PersonaMailboxFields): {
  firstName: string[];
  lastName: string[];
  username: string[];
  email: string[];
} {
  const local = String(mailbox.email || '').split('@')[0] || '';
  return {
    firstName: tokenizePersonaText(mailbox.firstName || ''),
    lastName: tokenizePersonaText(mailbox.lastName || ''),
    username: tokenizePersonaText(mailbox.username || ''),
    email: tokenizePersonaText(local),
  };
}

export function findPersonaViolations(
  mailbox: PersonaMailboxFields,
  forbiddenTokens: Iterable<string>,
): PersonaViolation[] {
  const forbidden = new Set(
    [...forbiddenTokens].map((t) => asciiFold(t)).filter((t) => t.length >= MIN_TOKEN_LENGTH),
  );
  const fields = mailboxPersonaTokens(mailbox);
  const violations: PersonaViolation[] = [];
  const seen = new Set<string>();

  const push = (field: PersonaViolation['field'], token: string, reason: PersonaViolation['reason']) => {
    const key = `${field}:${reason}:${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ field, token, reason });
  };

  for (const [field, tokens] of Object.entries(fields) as Array<
    [PersonaViolation['field'], string[]]
  >) {
    for (const token of tokens) {
      if (forbidden.has(token)) push(field, token, 'client_or_staff_name');
    }
  }

  const username = String(mailbox.username || '').trim();
  const local = String(mailbox.email || '').split('@')[0] || '';
  if (/\d/.test(username)) push('username', username, 'digits_in_username');
  if (!username && /\d/.test(local)) push('email', local, 'digits_in_username');

  return violations;
}

export function hasPersonaViolation(
  mailbox: PersonaMailboxFields,
  forbiddenTokens: Iterable<string>,
): boolean {
  return findPersonaViolations(mailbox, forbiddenTokens).length > 0;
}

export function identityUsesForbiddenToken(
  identity: { first_name?: string; last_name?: string; username?: string },
  forbiddenTokens: Iterable<string>,
): boolean {
  return hasPersonaViolation(
    {
      firstName: identity.first_name,
      lastName: identity.last_name,
      username: identity.username,
    },
    forbiddenTokens,
  );
}
