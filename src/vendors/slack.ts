import { config } from '../config.js';

export async function sendSlackMessage(text: string): Promise<void> {
  const token = config.slackBotToken();
  const channel = config.slackChannelId();

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text }),
  });

  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw new Error(`Slack chat.postMessage failed: ${data.error || res.status}`);
  }
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

/** Ping when a manual approval gate is ready. */
export async function notifyApprovalNeeded(input: {
  gate: string;
  clientName?: string;
  jobId: string;
  detail: string;
  appUrl?: string;
}) {
  const base =
    input.appUrl ||
    config.publicBaseUrl ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : '');
  const link = base ? `\nOpen: ${base.replace(/\/$/, '')}/` : '';
  await sendSlackMessage(
    [
      `🔔 *Approval needed* — ${input.gate}`,
      input.clientName ? `Client: *${input.clientName}*` : null,
      `Job: \`${input.jobId}\``,
      input.detail,
      link,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}
