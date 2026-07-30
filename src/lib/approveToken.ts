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

export function signApproveToken(
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
): string {
  const payload = JSON.stringify({
    jobId,
    gate,
    ...extras,
    exp: Date.now() + 1000 * 60 * 60 * 72, // 72h
  });
  const body = Buffer.from(payload).toString('base64url');
  const sig = createHmac('sha256', actionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyApproveToken(
  token: string,
): { jobId: string; gate: ApproveGate; [k: string]: string } | null {
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
      jobId?: string;
      gate?: ApproveGate;
      exp?: number;
      [k: string]: unknown;
    };
    if (!parsed.jobId || !parsed.gate) return null;
    if (typeof parsed.exp === 'number' && Date.now() > parsed.exp) return null;
    const out: { jobId: string; gate: ApproveGate; [k: string]: string } = {
      jobId: parsed.jobId,
      gate: parsed.gate,
    };
    for (const [k, v] of Object.entries(parsed)) {
      if (k === 'jobId' || k === 'gate' || k === 'exp') continue;
      if (typeof v === 'string') out[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    }
    return out;
  } catch {
    return null;
  }
}

export function buildApproveUrl(
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
): string {
  const token = signApproveToken(jobId, gate, extras);
  return `${webhookBaseUrl()}/api/approve?token=${encodeURIComponent(token)}`;
}
