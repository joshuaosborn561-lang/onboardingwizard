/**
 * Cron / ops endpoints require CRON_SECRET via header only.
 * Unset secret → refuse. Query-string secrets are ignored.
 */
export function cronSecretValue(): string {
  return process.env.CRON_SECRET?.trim() || '';
}

export function cronSecretConfigured(): boolean {
  return cronSecretValue().length > 0;
}

export function isCronAuthorized(headerValue: string | undefined): boolean {
  const secret = cronSecretValue();
  if (!secret) return false;
  return String(headerValue || '') === secret;
}

export function cronAuthError(): { error: string } {
  if (!cronSecretConfigured()) {
    return { error: 'CRON_SECRET is required' };
  }
  return { error: 'unauthorized' };
}
