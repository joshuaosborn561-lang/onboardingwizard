import { config, webhookBaseUrl } from '../config.js';
import { buildApproveUrl, type ApproveGate } from '../lib/approveToken.js';

type SlackBlock = Record<string, unknown>;

async function slackApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  const token = config.slackBotToken();
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || res.status}`);
  }
  return data;
}

export async function sendSlackMessage(text: string): Promise<void> {
  await slackApi('chat.postMessage', {
    channel: config.slackChannelId(),
    text,
  });
}

export async function sendSlackBlocks(input: {
  text: string;
  blocks: SlackBlock[];
}): Promise<void> {
  await slackApi('chat.postMessage', {
    channel: config.slackChannelId(),
    text: input.text,
    blocks: input.blocks,
  });
}

function btn(label: string, url: string, style?: 'primary' | 'danger'): SlackBlock {
  return {
    type: 'button',
    text: { type: 'plain_text', text: label.slice(0, 75), emoji: true },
    url,
    ...(style ? { style } : {}),
  };
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
}) {
  const bits = [
    `❌ Onboarding failed at *${input.step}*`,
    input.clientName ? `client *${input.clientName}*` : null,
    input.domain ? `domain \`${input.domain}\`` : null,
    input.mailbox ? `mailbox \`${input.mailbox}\`` : null,
    `(job \`${input.jobId}\`)`,
    `\n${input.message}`,
  ].filter(Boolean);
  await sendSlackMessage(bits.join(' — '));
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
  recommendedDomains: string[];
  allAvailableCount: number;
  inboxCount: number;
  googleRatio: number;
  costEachUsd?: number;
}): Promise<void> {
  const domains = input.recommendedDomains;
  const list = domains.map((d, i) => `${i + 1}. \`${d}\``).join('\n');
  const costEach = input.costEachUsd ?? 3.6;
  const total = (domains.length * costEach).toFixed(2);
  const googlePct = Math.round(input.googleRatio * 100);
  const approveRec = buildApproveUrl(input.jobId, 'domain_approval', {
    mode: 'recommended',
    inboxCount: String(input.inboxCount),
    googleRatio: String(input.googleRatio),
  });
  const approveAll = buildApproveUrl(input.jobId, 'domain_approval', {
    mode: 'all',
    inboxCount: String(input.allAvailableCount * 4),
    googleRatio: String(input.googleRatio),
  });

  await sendSlackBlocks({
    text: `Domain approval needed for ${input.clientName}`,
    blocks: [
      section(
        `🔔 *Domain approval* — *${input.clientName}*\nPrimary: ${input.primaryUrl}\nJob: \`${input.jobId}\``,
      ),
      divider(),
      section(
        `*Recommended ${domains.length} domains* (.info variations)\n${list}`,
      ),
      section(
        `💰 ~$${total} total ($${costEach.toFixed(2)} each) · *${input.inboxCount} inboxes* (${Math.round(input.inboxCount / Math.max(domains.length, 1))} per domain) · ${googlePct}% Google / ${100 - googlePct}% Microsoft\n_${input.allAvailableCount} available on Porkbun_`,
      ),
      actions([
        btn(`Approve ${domains.length} domains + ${input.inboxCount} inboxes`, approveRec, 'primary'),
        btn(`Approve all ${input.allAvailableCount} available`, approveAll),
      ]),
    ],
  });
}

export async function notifyMailboxPlanSlack(input: {
  jobId: string;
  clientName: string;
  domainCount: number;
  googleCount: number;
  microsoftCount: number;
  totalInboxes: number;
}): Promise<void> {
  const approve = buildApproveUrl(input.jobId, 'mailbox_plan');
  await sendSlackBlocks({
    text: `Mailbox order approval needed for ${input.clientName}`,
    blocks: [
      section(
        `🔔 *Mailbox order approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\nNS ready on *${input.domainCount}* domains.`,
      ),
      section(
        `Order *${input.totalInboxes}* inboxes: *${input.googleCount}* Google · *${input.microsoftCount}* Microsoft (4 per domain).`,
      ),
      actions([btn(`Approve ${input.totalInboxes} mailboxes`, approve, 'primary')]),
    ],
  });
}

export async function notifySmartleadLoadSlack(input: {
  jobId: string;
  clientName: string;
  mailboxCount: number;
  sampleSignatures: string[];
}): Promise<void> {
  const approve = buildApproveUrl(input.jobId, 'smartlead_load');
  const samples = input.sampleSignatures
    .slice(0, 3)
    .map((s) => `\`\`\`${s}\`\`\``)
    .join('\n');
  await sendSlackBlocks({
    text: `Smartlead load approval needed for ${input.clientName}`,
    blocks: [
      section(
        `🔔 *Smartlead load approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\n*${input.mailboxCount}* mailboxes active. Load + enable warmup?`,
      ),
      ...(samples ? [section(`Sample sigs:\n${samples}`)] : []),
      actions([btn(`Approve Smartlead load (${input.mailboxCount})`, approve, 'primary')]),
    ],
  });
}

export async function notifyFundsSlack(input: {
  jobId: string;
  clientName: string;
  remaining: number;
  estimatedCostUsd: number;
  balanceUsd?: number;
}): Promise<void> {
  const approve = buildApproveUrl(input.jobId, 'porkbun_funds');
  await sendSlackBlocks({
    text: `Porkbun funds needed for ${input.clientName}`,
    blocks: [
      section(
        `🔔 *Porkbun wallet* — *${input.clientName}*\nJob: \`${input.jobId}\`\nNeed ~$${input.estimatedCostUsd.toFixed(2)} for *${input.remaining}* domains${
          input.balanceUsd != null ? ` (balance $${input.balanceUsd.toFixed(2)})` : ''
        }.`,
      ),
      actions([btn('Funds added — retry registration', approve, 'primary')]),
    ],
  });
}

export type { ApproveGate };
