import { config, webhookBaseUrl } from '../config.js';
import { buildApproveUrl, type ApproveGate } from '../lib/approveToken.js';

type SlackBlock = Record<string, unknown>;

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

export async function sendSlackMessage(text: string): Promise<void> {
  await slackApi('chat.postMessage', {
    channel: config.slackChannelId(),
    text,
  });
}

export async function sendSlackBlocks(input: {
  text: string;
  blocks: SlackBlock[];
}): Promise<SlackMessageRef> {
  const data = await slackApi('chat.postMessage', {
    channel: config.slackChannelId(),
    text: input.text,
    blocks: input.blocks,
  });
  const channel = String(data.channel || config.slackChannelId());
  const ts = String(data.ts || '');
  const bodyBlocks = input.blocks.filter((b) => b.type !== 'actions');
  return { channel, ts, bodyBlocks, text: input.text };
}

/** Replace an approval message: drop buttons, stamp ✅ Approved. */
export async function dismissSlackApprovalMessage(
  ref: SlackMessageRef | undefined,
  approvedLabel: string,
): Promise<void> {
  if (!ref?.channel || !ref.ts) return;
  const stamp = section(`✅ *Approved* — ${approvedLabel}`);
  const blocks = [...(ref.bodyBlocks || []), divider(), stamp].slice(0, 50);
  try {
    await slackApi('chat.update', {
      channel: ref.channel,
      ts: ref.ts,
      text: `✅ Approved — ${approvedLabel}`,
      blocks,
    });
  } catch (err) {
    // Non-fatal — approval itself already succeeded
    console.error('Failed to dismiss Slack approval buttons', err);
  }
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
  const approveRec = buildApproveUrl(input.jobId, 'domain_approval', {
    mode: 'recommended',
    inboxCount: String(input.inboxCount),
    googleRatio: String(input.googleRatio),
  });
  const approveAll = buildApproveUrl(input.jobId, 'domain_approval', {
    mode: 'all',
    inboxCount: String(input.allAvailableCount * perDomain),
    googleRatio: String(input.googleRatio),
  });

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
        btn(`Approve ${domains.length} domains + ${input.inboxCount} inboxes`, approveRec, 'primary'),
        btn(`Approve all ${input.allAvailableCount} available`, approveAll),
      ]),
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
  const approve = buildApproveUrl(input.jobId, 'mailbox_plan');

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
      `Each mailbox sig will be:\n\`\`\`First Last\n${input.companyName}\`\`\`\nWarmup turns on after Smartlead load (separate approval).`,
    ),
  ];

  return sendSlackBlocks({
    text: `Mailbox order approval — ${input.clientName}: ${input.totalInboxes} inboxes`,
    blocks: [
      ...bodyBlocks,
      actions([btn(`Approve ${input.totalInboxes} mailboxes`, approve, 'primary')]),
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
  const approve = buildApproveUrl(input.jobId, 'smartlead_load');
  const lines = input.mailboxes.map((m, i) => {
    const name = `${m.firstName} ${m.lastName}`.trim() || '(pending name)';
    const plat = m.platform === 'MICROSOFT' ? 'MS' : 'G';
    return `${i + 1}. \`${m.email}\` — *${name}* (${plat})\n    sig:\n\`\`\`${name}\n${input.companyName}\`\`\``;
  });

  const header: SlackBlock[] = [
    section(
      `🔔 *Smartlead load approval* — *${input.clientName}*\nJob: \`${input.jobId}\`\nLoad *${input.mailboxCount}* active mailboxes + enable warmup.`,
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
      actions([btn(`Approve Smartlead load (${input.mailboxCount})`, approve, 'primary')]),
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

export async function notifyFundsSlack(input: {
  jobId: string;
  clientName: string;
  remaining: number;
  estimatedCostUsd: number;
  balanceUsd?: number;
  remainingDomains?: string[];
}): Promise<SlackMessageRef> {
  const approve = buildApproveUrl(input.jobId, 'porkbun_funds');
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
      actions([btn('Funds added — retry registration', approve, 'primary')]),
    ],
  });
}

export type { ApproveGate };
