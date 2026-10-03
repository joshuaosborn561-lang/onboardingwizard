import { config, webhookBaseUrl } from '../config.js';
import {
  buildApproveUrl,
  signApproveToken,
  signSlackActionToken,
  type ApproveGate,
} from '../lib/approveToken.js';

type SlackBlock = Record<string, unknown>;

export const SLACK_ACTION_IDS = {
  approve: 'onboarding_approve',
  approveAll: 'onboarding_approve_all',
  retry: 'onboarding_retry',
  pingInboxkit: 'onboarding_ping_inboxkit',
  slackNudge: 'onboarding_slack_nudge',
} as const;

export interface SlackMessageRef {
  channel: string;
  ts: string;
  /** Message blocks without the actions/button row — used to rewrite after approve. */
  bodyBlocks: SlackBlock[];
  text: string;
}

async function slackApi(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = config.slackBotToken();
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; ts?: string; channel?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || res.status}`);
  }
  return data as Record<string, unknown>;
}

export async function sendSlackMessage(text: string, channel = config.slackChannelId()): Promise<void> {
  await slackApi('chat.postMessage', { channel, text });
}

export async function sendSlackBlocks(input: {
  text: string;
  blocks: SlackBlock[];
  channel?: string;
}): Promise<SlackMessageRef> {
  const dest = input.channel || config.slackChannelId();
  const data = await slackApi('chat.postMessage', {
    channel: dest,
    text: input.text,
    blocks: input.blocks,
  });
  const channel = String(data.channel || dest);
  const ts = String(data.ts || '');
  const bodyBlocks = input.blocks.filter((b) => b.type !== 'actions' && !isFallbackContext(b));
  return { channel, ts, bodyBlocks, text: input.text };
}

/** Drop action buttons and stamp a status line onto a Slack message. */
export async function replaceSlackActionsWithStamp(
  ref: SlackMessageRef | undefined,
  stampText: string,
): Promise<void> {
  if (!ref?.channel || !ref.ts) return;
  const stamp = section(stampText);
  const kept = (ref.bodyBlocks || []).filter((b) => !isFallbackContext(b));
  const blocks = [...kept, divider(), stamp].slice(0, 50);
  try {
    await slackApi('chat.update', {
      channel: ref.channel,
      ts: ref.ts,
      text: stampText.replace(/\*/g, ''),
      blocks,
    });
  } catch (err) {
    // Non-fatal — the underlying action already succeeded
    console.error('Failed to update Slack message buttons', err);
  }
}

/** Replace an approval message: drop buttons, stamp ✅ Approved. */
export async function dismissSlackApprovalMessage(
  ref: SlackMessageRef | undefined,
  approvedLabel: string,
): Promise<void> {
  await replaceSlackActionsWithStamp(ref, `✅ *Approved* — ${approvedLabel}`);
}

/** Interactive button — Slack posts to the Interactivity Request URL. */
function actionBtn(
  label: string,
  actionId: string,
  value: string,
  style?: 'primary' | 'danger',
): SlackBlock {
  return {
    type: 'button',
    action_id: actionId.slice(0, 255),
    text: { type: 'plain_text', text: label.slice(0, 75), emoji: true },
    value: value.slice(0, 2000),
    ...(style ? { style } : {}),
  };
}

function approveBtn(
  label: string,
  jobId: string,
  gate: ApproveGate,
  extras: Record<string, string> = {},
  style?: 'primary' | 'danger',
  actionId: string = SLACK_ACTION_IDS.approve,
): SlackBlock {
  return actionBtn(label, actionId, signApproveToken(jobId, gate, extras), style);
}

function isFallbackContext(block: SlackBlock): boolean {
  if (block.type !== 'context') return false;
  const elements = block.elements as Array<{ text?: string }> | undefined;
  return Boolean(elements?.some((el) => String(el.text || '').includes('approve in browser')));
}

function fallbackApproveContext(jobId: string, gate: ApproveGate, extras: Record<string, string> = {}): SlackBlock {
  const url = buildApproveUrl(jobId, gate, extras);
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `If the in-channel button does not work: <${url}|approve in browser>`,
      },
    ],
  };
}

function jobOpsButtons(jobId: string, opts: {
  retry?: boolean;
  pingInboxkit?: boolean;
  resend?: boolean;
}): SlackBlock[] {
  const buttons: SlackBlock[] = [];
  if (opts.retry) {
    buttons.push(
      actionBtn('Retry', SLACK_ACTION_IDS.retry, signSlackActionToken(jobId, 'retry'), 'primary'),
    );
  }
  if (opts.pingInboxkit) {
    buttons.push(
      actionBtn(
        'Ping InboxKit',
        SLACK_ACTION_IDS.pingInboxkit,
        signSlackActionToken(jobId, 'ping_inboxkit'),
      ),
    );
  }
  if (opts.resend) {
    buttons.push(
      actionBtn(
        'Resend buttons',
        SLACK_ACTION_IDS.slackNudge,
        signSlackActionToken(jobId, 'slack_nudge'),
      ),
    );
  }
  return buttons;
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } };
}

function actions(buttons: SlackBlock[]): SlackBlock {
  return { type: 'actions', elements: buttons.slice(0, 5) };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

/** Split long mrkdwn into multiple section blocks under Slack's 3000-char limit. */
function sectionChunks(title: string, lines: string[]): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  let buf = title ? `${title}\n` : '';
  for (const line of lines) {
    const next = `${buf}${line}\n`;
    if (next.length > 2800) {
      if (buf.trim()) blocks.push(section(buf.trimEnd()));
      buf = `${line}\n`;
    } else {
      buf = next;
    }
  }
  if (buf.trim()) blocks.push(section(buf.trimEnd()));
  return blocks;
}

/**
 * Slack only for blocked / decision / failure. Counts + ≤10 samples. No daily digest.
 */
export async function notifyOpsAlert(input: {
  title: string;
  counts: string;
  samples: string[];
}): Promise<void> {
  const samples = input.samples.slice(0, 10);
  const lines = [input.title, input.counts, samples.length ? samples.map((s) => `• ${s}`).join('\n') : '']
    .filter(Boolean)
    .join('\n');
  await sendSlackMessage(lines);
}

export async function notifySuccess(clientName: string, inboxCount: number, jobId: string) {
  await sendSlackMessage(
    `✅ Client onboarding complete: *${clientName}* — ${inboxCount} inbox${inboxCount === 1 ? '' : 'es'} online and warming up (job \`${jobId}\`).`,
  );
}

export async function notifyFailure(input: {
  step: string;
  clientName?: string;
  message: string;
  domain?: string;
  mailbox?: string;
  jobId: string;
  showRetry?: boolean;
  showPingInboxkit?: boolean;
  showResend?: boolean;
}): Promise<SlackMessageRef | void> {
  const bits = [
    `❌ Onboarding failed at *${input.step}*`,
    input.clientName ? `client *${input.clientName}*` : null,
    input.domain ? `domain \`${input.domain}\`` : null,
    input.mailbox ? `mailbox \`${input.mailbox}\`` : null,
    `(job \`${input.jobId}\`)`,
    `\n${input.message}`,
  ].filter(Boolean);
  const text = bits.join(' — ');
  const buttons = jobOpsButtons(input.jobId, {
    retry: input.showRetry,
    pingInboxkit: input.showPingInboxkit,
    resend: input.showResend,
  });
  if (!buttons.length) {
    await sendSlackMessage(text);
    return;
  }
  return sendSlackBlocks({
    text,
    blocks: [section(text), actions(buttons)],
  });
}

/** @deprecated prefer gate-specific notify* helpers with buttons */
export async function notifyApprovalNeeded(input: {
  gate: string;
  clientName?: string;
  jobId: string;
  detail: string;
  appUrl?: string;
}) {
  const base = input.appUrl || webhookBaseUrl();
  await sendSlackMessage(
    [
      `🔔 *Approval needed* — ${input.gate}`,
      input.clientName ? `Client: *${input.clientName}*` : null,
      `Job: \`${input.jobId}\``,
      input.detail,
      `Open: ${base}/`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

export async function notifyDomainApprovalSlack(input: {
  jobId: string;
  clientName: string;
  primaryUrl: string;
  companyName: string;
  recommendedDomains: string[];
  allAvailableCount: number;
  inboxCount: number;
  googleRatio: number;
  costEachUsd?: number;
  /** Preview of per-domain platform assignment for the recommended set. */
  planPreview?: Array<{ domain: string; platform: 'GOOGLE' | 'MICROSOFT'; count: number }>;
}): Promise<SlackMessageRef> {
  const domains = input.recommendedDomains;
  const perDomain = Math.round(input.inboxCount / Math.max(domains.length, 1));
  const costEach = input.costEachUsd ?? 3.6;
  const total = (domains.length * costEach).toFixed(2);
  const googlePct = Math.round(input.googleRatio * 100);
  const recExtras = {
    mode: 'recommended',
    inboxCount: String(input.inboxCount),
    googleRatio: String(input.googleRatio),
  };
  const allExtras = {
    mode: 'all',
    inboxCount: String(input.allAvailableCount * perDomain),
    googleRatio: String(input.googleRatio),
  };

  const domainLines = domains.map((d, i) => {
    const row = input.planPreview?.find((p) => p.domain === d);
    const plat = row ? ` → ${row.count}× ${row.platform === 'GOOGLE' ? 'Google' : 'Microsoft'}` : '';
    return `${i + 1}. \`${d}\`${plat}`;
  });

  const googleInboxes = (input.planPreview || [])
    .filter((p) => p.platform === 'GOOGLE')
    .reduce((s, p) => s + p.count, 0);
  const msInboxes = (input.planPreview || [])
    .filter((p) => p.platform === 'MICROSOFT')
    .reduce((s, p) => s + p.count, 0);

  const bodyBlocks: SlackBlock[] = [
    section(
      `🔔 *Domain approval* — *${input.clientName}*\nPrimary: ${input.primaryUrl}\nSig company line: *${input.companyName}*\nJob: \`${input.jobId}\``,
    ),
    divider(),
    ...sectionChunks(
      `*Approving these ${domains.length} domains* (primary .info variations):`,
      domainLines,
    ),
    section(
      [
        `*Inboxes after buy:* *${input.inboxCount}* total · *${perDomain} per domain*`,
        googleInboxes || msInboxes
          ? `*Split:* ${googleInboxes} Google / ${msInboxes} Microsoft (~${googlePct}/${100 - googlePct})`
          : `*Split target:* ~${googlePct}% Google / ${100 - googlePct}% Microsoft`,
        `*Sig format:*\`\`\`First Last\n${input.companyName}\`\`\``,
        `💰 Domains ~$${total} ($${costEach.toFixed(2)} ea) · ${input.allAvailableCount} available on Porkbun`,
      ].join('\n'),
    ),
  ];

  return sendSlackBlocks({
    text: `Domain approval needed for ${input.clientName} — ${domains.length} domains, ${input.inboxCount} inboxes`,
    blocks: [
      ...bodyBlocks,
      actions([
        approveBtn(
          `Approve ${domains.length} domains + ${input.inboxCount} inboxes`,
          input.jobId,
          'domain_approval',
          recExtras,
          'primary',
        ),
        approveBtn(
          `Approve all ${input.allAvailableCount} available`,
          input.jobId,
          'domain_approval',
          allExtras,
          undefined,
          SLACK_ACTION_IDS.approveAll,
        ),
        ...jobOpsButtons(input.jobId, { resend: true }),
      ]),
      fallbackApproveContext(input.jobId, 'domain_approval', recExtras),
    ],
  });
}

export async function notifyMailboxPlanSlack(input: {
  jobId: string;
  clientName: string;
  companyName: string;
  domainCount: number;
  googleCount: number;
  microsoftCount: number;
  totalInboxes: number;
  plan: Array<{
    domain: string;
    platform: 'GOOGLE' | 'MICROSOFT';
    firstName?: string;
    lastName?: string;
    username?: string;
  }>;
}): Promise<SlackMessageRef> {
  const byDomain = new Map<
    string,
    { platform: string; count: number; names: string[] }
  >();
  for (const row of input.plan) {
    const cur = byDomain.get(row.domain);
    const name =
      row.firstName && row.lastName
        ? `${row.firstName} ${row.lastName}`
        : row.username
          ? row.username
          : null;
    if (cur) {
      cur.count += 1;
      if (name) cur.names.push(name);
    } else {
      byDomain.set(row.domain, {
        platform: row.platform === 'GOOGLE' ? 'Google' : 'Microsoft',
        count: 1,
        names: name ? [name] : [],
      });
    }
  }
  const lines = [...byDomain.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([domain, v], i) => {
      const nameBit = v.names.length ? `\n    ${v.names.join(' · ')}` : '';
      return `${i + 1}. \`${domain}\` — *${v.count}* ${v.platform} inbox${
        v.count === 1 ? '' : 'es'
      }${nameBit}`;
    });

  const bodyBlocks: SlackBlock[] = [
    section(
      `🔔 *Mailbox order approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\nNS ready on *${input.domainCount}* domains.\nSig company: *${input.companyName}*`,
    ),
    divider(),
    ...sectionChunks(
      `*What you are buying* — ${input.totalInboxes} inboxes (${input.googleCount} Google / ${input.microsoftCount} Microsoft), unique names:`,
      lines,
    ),
    section(
      `Each mailbox sig will be:\n\`\`\`First Last\n${input.companyName}\`\`\`\nWarmup turns on after Smartlead load (separate approval).\nNo test emails are sent by this automation.`,
    ),
  ];

  return sendSlackBlocks({
    text: `Mailbox order approval — ${input.clientName}: ${input.totalInboxes} inboxes`,
    blocks: [
      ...bodyBlocks,
      actions([
        approveBtn(
          `Approve ${input.totalInboxes} mailboxes`,
          input.jobId,
          'mailbox_plan',
          {},
          'primary',
        ),
        ...jobOpsButtons(input.jobId, { resend: true }),
      ]),
      fallbackApproveContext(input.jobId, 'mailbox_plan'),
    ],
  });
}

export async function notifySmartleadLoadSlack(input: {
  jobId: string;
  clientName: string;
  companyName: string;
  mailboxCount: number;
  mailboxes: Array<{
    email: string;
    firstName: string;
    lastName: string;
    platform: string;
  }>;
}): Promise<SlackMessageRef> {
  const lines = input.mailboxes.map((m, i) => {
    const name = `${m.firstName} ${m.lastName}`.trim() || '(pending name)';
    const plat = m.platform === 'MICROSOFT' ? 'MS' : 'G';
    return `${i + 1}. \`${m.email}\` — *${name}* (${plat})\n    sig:\n\`\`\`${name}\n${input.companyName}\`\`\``;
  });

  const header: SlackBlock[] = [
    section(
      `🔔 *Smartlead load approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\nLoad *${input.mailboxCount}* active mailboxes + enable warmup.\nNo test sends will be triggered.`,
    ),
    divider(),
  ];

  const listBlocks = sectionChunks(`*Mailboxes + signatures:*`, lines);
  const firstList = listBlocks.slice(0, 40);
  const rest = listBlocks.slice(40);
  const ref = await sendSlackBlocks({
    text: `Smartlead load approval — ${input.clientName}: ${input.mailboxCount} mailboxes`,
    blocks: [
      ...header,
      ...firstList,
      actions([
        approveBtn(
          `Approve Smartlead load (${input.mailboxCount})`,
          input.jobId,
          'smartlead_load',
          {},
          'primary',
        ),
        ...jobOpsButtons(input.jobId, { resend: true }),
      ]),
      fallbackApproveContext(input.jobId, 'smartlead_load'),
    ],
  });
  for (let i = 0; i < rest.length; i += 45) {
    await sendSlackBlocks({
      text: `${input.clientName} mailboxes (cont.)`,
      blocks: rest.slice(i, i + 45),
    });
  }
  return ref;
}

export async function notifyInboxkitStuckSlack(input: {
  channel: string;
  clientName: string;
  workspaceId: string;
  workspaceName?: string;
  jobId?: string;
  hours: number;
  kind: 'export' | 'mailbox';
  items: string[];
}): Promise<void> {
  const kindLabel = input.kind === 'export' ? 'Smartlead export' : 'mailbox provisioning';
  const lines = input.items.slice(0, 25);
  const extra = input.items.length > lines.length ? `\n…and ${input.items.length - lines.length} more` : '';
  const blocks: SlackBlock[] = [
    section(
      [
        `⚠️ *InboxKit stuck > ${input.hours.toFixed(1)}h* — ${kindLabel}`,
        `Client: *${input.clientName}*`,
        input.workspaceName ? `Workspace: *${input.workspaceName}*` : null,
        `Workspace ID: \`${input.workspaceId}\``,
        input.jobId ? `Job: \`${input.jobId}\`` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    divider(),
    ...sectionChunks('*Still stuck:*', lines),
  ];
  if (extra) blocks.push(section(extra));
  blocks.push(
    section(
      'This is an automated ping from our onboarding system after 12 hours with no progress. Can you take a look?',
    ),
  );
  await sendSlackBlocks({
    channel: input.channel,
    text: `InboxKit stuck ${kindLabel} for ${input.clientName} (${input.hours.toFixed(1)}h)`,
    blocks,
  });
}

export async function notifyPersonaRenameSlack(input: {
  jobId: string;
  clientName: string;
  renameCount: number;
  scannedCount: number;
  samples: Array<{ fromEmail: string; toEmail: string; fromName: string; toName: string }>;
}): Promise<SlackMessageRef> {
  const sampleLines = input.samples.map(
    (s, i) =>
      `${i + 1}. \`${s.fromEmail}\` (${s.fromName || '—'}) → \`${s.toEmail}\` (${s.toName || '—'})`,
  );
  const extra =
    input.renameCount > input.samples.length
      ? `\n…and ${input.renameCount - input.samples.length} more`
      : '';
  const bodyBlocks: SlackBlock[] = [
    section(
      `🔔 *Persona rename approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\n${input.renameCount} mailbox(es) of ${input.scannedCount} scanned. No seats bought or cancelled.`,
    ),
    ...(sampleLines.length
      ? sectionChunks('*Sample (≤10):*', sampleLines)
      : [section('No mailbox identities to change.')]),
  ];
  if (extra) bodyBlocks.push(section(extra));
  return sendSlackBlocks({
    text: `Persona rename approval for ${input.clientName} (${input.renameCount})`,
    blocks: [
      ...bodyBlocks,
      actions([
        approveBtn('Approve rename', input.jobId, 'persona_rename', {}, 'primary'),
      ]),
      fallbackApproveContext(input.jobId, 'persona_rename'),
    ],
  });
}

export async function notifyFundsSlack(input: {
  jobId: string;
  clientName: string;
  remaining: number;
  estimatedCostUsd: number;
  balanceUsd?: number;
  remainingDomains?: string[];
}): Promise<SlackMessageRef> {
  const domainLines = (input.remainingDomains || []).map((d, i) => `${i + 1}. \`${d}\``);
  const bodyBlocks: SlackBlock[] = [
    section(
      `🔔 *Porkbun wallet* — *${input.clientName}*\nJob: \`${input.jobId}\`\nNeed ~$${input.estimatedCostUsd.toFixed(2)} for *${input.remaining}* domains${
        input.balanceUsd != null ? ` (balance $${input.balanceUsd.toFixed(2)})` : ''
      }.`,
    ),
    ...(domainLines.length ? sectionChunks(`*Still to register:*`, domainLines) : []),
  ];
  return sendSlackBlocks({
    text: `Porkbun funds needed for ${input.clientName}`,
    blocks: [
      ...bodyBlocks,
      actions([
        approveBtn(
          'Funds added — retry registration',
          input.jobId,
          'porkbun_funds',
          {},
          'primary',
        ),
        ...jobOpsButtons(input.jobId, { resend: true }),
      ]),
      fallbackApproveContext(input.jobId, 'porkbun_funds'),
    ],
  });
}

export function slackMessageRefFromInteraction(payload: {
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { ts?: string; text?: string; blocks?: SlackBlock[] };
}): SlackMessageRef | undefined {
  const channel = payload.channel?.id || payload.container?.channel_id || '';
  const ts = payload.message?.ts || payload.container?.message_ts || '';
  if (!channel || !ts) return undefined;
  const blocks = Array.isArray(payload.message?.blocks) ? payload.message.blocks : [];
  return {
    channel,
    ts,
    bodyBlocks: blocks.filter((b) => b.type !== 'actions' && !isFallbackContext(b)),
    text: String(payload.message?.text || ''),
  };
}

export async function replySlackResponseUrl(
  responseUrl: string | undefined,
  body: Record<string, unknown>,
): Promise<void> {
  if (!responseUrl) return;
  try {
    const res = await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('Slack response_url failed', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('Slack response_url error', err);
  }
}

export type { ApproveGate };
