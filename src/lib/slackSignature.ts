import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from './rawBody.js';

const MAX_SKEW_SECONDS = 60 * 5;

function slackSigningSecret(): string {
  return process.env.SLACK_SIGNING_SECRET?.trim() || '';
}

export function hasSlackSigningSecret(): boolean {
  return Boolean(slackSigningSecret());
}

/**
 * Verify `X-Slack-Signature` / `X-Slack-Request-Timestamp` against the raw body.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(req: RawBodyRequest): boolean {
  const secret = slackSigningSecret();
  if (!secret) return false;
  const timestamp = String(req.header('x-slack-request-timestamp') || '');
  const signature = String(req.header('x-slack-signature') || '');
  const rawBody = req.rawBody;
  if (!timestamp || !signature || rawBody == null) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) {
    return false;
  }

  const basestring = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac('sha256', secret).update(basestring).digest('hex');
  const expected = `v0=${digest}`;
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
