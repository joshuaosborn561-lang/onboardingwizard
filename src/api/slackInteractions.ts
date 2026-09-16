import type { Request, Response } from 'express';
import { verifySlackActionToken } from '../lib/approveToken.js';
import type { RawBodyRequest } from '../lib/rawBody.js';
import { hasSlackSigningSecret, verifySlackSignature } from '../lib/slackSignature.js';
import { pingInboxkitForJob } from '../pipeline/inboxkitStuckWatch.js';
import {
  applySlackApproval,
  nudgeSlackApproval,
  resumeFailedJob,
} from '../pipeline/onboarding.js';
import {
  replySlackResponseUrl,
  replaceSlackActionsWithStamp,
  slackMessageRefFromInteraction,
} from '../vendors/slack.js';

interface SlackBlockAction {
  action_id?: string;
  value?: string;
  type?: string;
}

interface SlackInteractionPayload {
  type?: string;
  challenge?: string;
  response_url?: string;
  user?: { id?: string; username?: string };
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { ts?: string; text?: string; blocks?: Array<Record<string, unknown>> };
  actions?: SlackBlockAction[];
}

function readSlackPayload(req: Request): SlackInteractionPayload | null {
  const body = req.body as { payload?: unknown; type?: string; challenge?: string };
  if (typeof body?.payload === 'string') {
    try {
      return JSON.parse(body.payload) as SlackInteractionPayload;
    } catch {
      return null;
    }
  }
  if (body?.payload && typeof body.payload === 'object') {
    return body.payload as SlackInteractionPayload;
  }
  if (body?.type) {
    return body as SlackInteractionPayload;
  }
  return null;
}

function isSslCheck(req: Request): boolean {
  const body = req.body as { ssl_check?: unknown };
  return body?.ssl_check === '1' || body?.ssl_check === 1;
}

/**
 * Slack Interactivity Request URL.
 * Ack immediately (empty 200), then process signed button actions asynchronously.
 */
export function handleSlackInteractions(req: Request, res: Response): void {
  if (isSslCheck(req)) {
    res.status(200).send();
    return;
  }

  const early = req.body as { type?: string; challenge?: string };
  if (early?.type === 'url_verification' && early.challenge) {
    res.status(200).send(String(early.challenge));
    return;
  }

  if (!hasSlackSigningSecret()) {
    res.status(503).json({ error: 'SLACK_SIGNING_SECRET is not configured' });
    return;
  }
  if (!verifySlackSignature(req as RawBodyRequest)) {
    res.status(401).json({ error: 'invalid_slack_signature' });
    return;
  }

  const payload = readSlackPayload(req);
  if (payload?.type === 'url_verification' && payload.challenge) {
    res.status(200).send(String(payload.challenge));
    return;
  }

  // Slack requires a response within 3s. Do the work after we ack.
  res.status(200).send();

  if (!payload || payload.type !== 'block_actions') {
    return;
  }

  void processBlockActions(payload).catch((err) => {
    console.error('Slack interaction handler failed', err);
    void replySlackResponseUrl(payload.response_url, {
      replace_original: false,
      text: `❌ ${err instanceof Error ? err.message : String(err)}`,
    });
  });
}

async function processBlockActions(payload: SlackInteractionPayload): Promise<void> {
  const clicked = payload.actions?.[0];
  const token = String(clicked?.value || '');
  const parsed = verifySlackActionToken(token);
  if (!parsed) {
    await replySlackResponseUrl(payload.response_url, {
      replace_original: false,
      text: '❌ Invalid or expired button. Use Resend buttons or the browser fallback link.',
    });
    return;
  }

  const messageRef = slackMessageRefFromInteraction(payload);
  const who = payload.user?.username || payload.user?.id || 'someone';

  if (parsed.action === 'approve') {
    if (!parsed.gate) {
      throw new Error('Approve action is missing a spend gate');
    }
    await applySlackApproval(parsed.jobId, parsed.gate, parsed.extras, messageRef);
    return;
  }

  if (parsed.action === 'retry') {
    await resumeFailedJob(parsed.jobId);
    await replaceSlackActionsWithStamp(
      messageRef,
      `✅ *Retry started* by @${who} — job \`${parsed.jobId}\``,
    );
    return;
  }

  if (parsed.action === 'ping_inboxkit') {
    const result = await pingInboxkitForJob(parsed.jobId);
    await replaceSlackActionsWithStamp(
      messageRef,
      `✅ *InboxKit pinged* by @${who} (${result.kind}) — job \`${parsed.jobId}\``,
    );
    await replySlackResponseUrl(payload.response_url, {
      replace_original: false,
      text: `InboxKit nudge sent to \`${result.channel}\`.`,
    });
    return;
  }

  if (parsed.action === 'slack_nudge') {
    const result = await nudgeSlackApproval(parsed.jobId);
    await replaceSlackActionsWithStamp(
      messageRef,
      `✅ *Approval buttons re-sent* by @${who} — ${result.gate.replace(/_/g, ' ')}`,
    );
    return;
  }

  await replySlackResponseUrl(payload.response_url, {
    replace_original: false,
    text: `❌ Unsupported Slack action \`${clicked?.action_id || parsed.action}\`.`,
  });
}
