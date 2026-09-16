import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, webhookBaseUrl } from '../config.js';

function actionSecret(): string {
  return (
    process.env.SLACK_ACTION_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim() ||
    config.slackBotToken()
  );
}

export type ApproveGate = 'domain_approval' | 'mailbox_plan' | 'smartlead_load' | 'porkbun_funds';

export type SlackActionKind = 'approve' | 'retry' | 'ping_inboxkit' | 'slack_nudge';

const APPROVE_GATES = new Set<string>([
  'domain_approval',
  'mailbox_plan',
  'smartlead_load',
  'porkbun_funds',
]);

const SLACK_ACTIONS = new Set<string>(['approve', 'retry', 'ping_inboxkit', 'slack_nudge']);

function signPayload(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', actionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyPayload(token: string): Record<string, unknown> | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', actionSecret()).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number;
      [k: string]: unknown;
    };
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function extrasFromParsed(
  parsed: Record<string, unknown>,
  skip: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const skipSet = new Set(skip);
  for (const [k, v] of Object.entries(parsed)) {
    if (skipSet.has(k)) continue;
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

export function signApproveToken(
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
): string {
  return signPayload({
    jobId,
    gate,
    action: 'approve',
    ...extras,
    exp: Date.now() + 1000 * 60 * 60 * 72, // 72h
  });
}

export function verifyApproveToken(
  token: string,
): { jobId: string; gate: ApproveGate; [k: string]: string } | null {
  const parsed = verifyPayload(token);
  if (!parsed) return null;
  const jobId = typeof parsed.jobId === 'string' ? parsed.jobId : '';
  const gate = typeof parsed.gate === 'string' ? parsed.gate : '';
  if (!jobId || !APPROVE_GATES.has(gate)) return null;
  return {
    jobId,
    gate: gate as ApproveGate,
    ...extrasFromParsed(parsed, ['jobId', 'gate', 'exp', 'action']),
  };
}

export function signSlackActionToken(
  jobId: string,
  action: SlackActionKind,
  extras: Record<string, string> = {},
): string {
  return signPayload({
    jobId,
    action,
    ...extras,
    exp: Date.now() + 1000 * 60 * 60 * 72,
  });
}

export function verifySlackActionToken(token: string): {
  jobId: string;
  action: SlackActionKind;
  gate?: ApproveGate;
  extras: Record<string, string>;
} | null {
  const parsed = verifyPayload(token);
  if (!parsed) return null;
  const jobId = typeof parsed.jobId === 'string' ? parsed.jobId : '';
  if (!jobId) return null;

  const rawAction =
    typeof parsed.action === 'string'
      ? parsed.action
      : parsed.gate
        ? 'approve'
        : '';
  if (!SLACK_ACTIONS.has(rawAction)) return null;
  const action = rawAction as SlackActionKind;

  const gate =
    typeof parsed.gate === 'string' && APPROVE_GATES.has(parsed.gate)
      ? (parsed.gate as ApproveGate)
      : undefined;
  if (action === 'approve' && !gate) return null;

  return {
    jobId,
    action,
    gate,
    extras: extrasFromParsed(parsed, ['jobId', 'gate', 'exp', 'action']),
  };
}

export function buildApproveUrl(
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
): string {
  const token = signApproveToken(jobId, gate, extras);
  return `${webhookBaseUrl()}/api/approve?token=${encodeURIComponent(token)}`;
}
