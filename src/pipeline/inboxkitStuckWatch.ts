import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { listJobs } from '../store/jobs.js';
import {
  getSequencerExportStatus,
  listMailboxes,
  listWorkspaces,
  type SequencerExportStatus,
} from '../vendors/inboxkit.js';
import { notifyInboxkitStuckSlack, sendSlackMessage } from '../vendors/slack.js';

const STUCK_MS = () => config.inboxkitStuckHours() * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const EXPORT_IN_FLIGHT = new Set(['queued', 'pending', 'processing']);
const MAILBOX_IN_FLIGHT = new Set([
  'queued',
  'scheduled',
  'processing',
  'provisioning',
  'finalizing_setup',
  'configuring_auth',
]);

interface AlertRecord {
  lastAlertedAt: string;
}

interface AlertStore {
  [key: string]: AlertRecord;
}

interface StuckGroup {
  key: string;
  kind: 'export' | 'mailbox' | 'nameservers';
  workspaceId: string;
  workspaceName?: string;
  clientName: string;
  jobId?: string;
  hours: number;
  items: string[];
}

function alertsPath(): string {
  const dir = path.resolve(config.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'inboxkit-stuck-alerts.json');
}

function loadAlerts(): AlertStore {
  const file = alertsPath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as AlertStore;
  } catch {
    return {};
  }
}

function saveAlerts(store: AlertStore): void {
  fs.writeFileSync(alertsPath(), JSON.stringify(store, null, 2), 'utf8');
}

function hoursSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function emailOf(m: { email?: string; username?: string; domain_name?: string }): string {
  return (m.email || `${m.username || ''}@${m.domain_name || ''}`).toLowerCase();
}

async function listAllExports(workspaceId: string): Promise<SequencerExportStatus[]> {
  const out: SequencerExportStatus[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await getSequencerExportStatus(workspaceId, { limit: 100, offset });
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

function nsWaitStartedAt(job: {
  logs: Array<{ at: string; message: string }>;
  updatedAt: string;
}): string {
  const hit = [...job.logs]
    .reverse()
    .find((l) => /waiting for inboxkit nameserver|ns updated|connecting .* domains to inboxkit/i.test(l.message));
  return hit?.at || job.updatedAt;
}

export async function pollInboxkitStuck(): Promise<void> {
  const channel = config.slackInboxkitChannelId();
  if (!channel) {
    console.log('[inboxkit-stuck] SLACK_INBOXKIT_CHANNEL_ID not set — skip');
    return;
  }

  const thresholdH = config.inboxkitStuckHours();
  const jobs = listJobs();
  const jobByWorkspace = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (job.inboxkitWorkspaceId && !jobByWorkspace.has(job.inboxkitWorkspaceId)) {
      jobByWorkspace.set(job.inboxkitWorkspaceId, job);
    }
  }

  const groups: StuckGroup[] = [];
  let workspaces: Array<{ uid?: string; id?: string; name?: string }> = [];
  try {
    workspaces = await listWorkspaces();
  } catch (err) {
    console.error('[inboxkit-stuck] listWorkspaces', err);
    return;
  }

  const seen = new Set<string>();
  for (const ws of workspaces) {
    const workspaceId = String(ws.uid || ws.id || '');
    if (!workspaceId || seen.has(workspaceId)) continue;
    seen.add(workspaceId);
    const job = jobByWorkspace.get(workspaceId);
    const clientName = job?.companyName || job?.brand?.clientName || ws.name || workspaceId;

    try {
      const exports = await listAllExports(workspaceId);
      const latestByMailbox = new Map<string, SequencerExportStatus>();
      for (const exp of exports) {
        const mailbox = String(exp.mailbox_email || exp.mailbox_uid || exp.uid);
        const prev = latestByMailbox.get(mailbox);
        const expAt = Date.parse(exp.updated_at || exp.created_at || '') || 0;
        const prevAt = Date.parse(prev?.updated_at || prev?.created_at || '') || 0;
        if (!prev || expAt >= prevAt) latestByMailbox.set(mailbox, exp);
      }

      const stuckExports: string[] = [];
      let oldestExportH = 0;
      for (const exp of latestByMailbox.values()) {
        const status = String(exp.status || '').toLowerCase();
        const ageH = hoursSince(exp.created_at || exp.updated_at);
        if (ageH == null || ageH < thresholdH) continue;
        const inFlight = EXPORT_IN_FLIGHT.has(status);
        const failed = status === 'failed' || status === 'errored';
        if (!inFlight && !failed) continue;
        oldestExportH = Math.max(oldestExportH, ageH);
        const err = exp.error_message ? ` — ${exp.error_message}` : '';
        stuckExports.push(
          `\`${exp.mailbox_email || exp.mailbox_uid}\` ${status} ${ageH.toFixed(1)}h${err}`,
        );
      }
      if (stuckExports.length) {
        groups.push({
          key: `export:${workspaceId}`,
          kind: 'export',
          workspaceId,
          workspaceName: ws.name,
          clientName,
          jobId: job?.id,
          hours: oldestExportH,
          items: stuckExports.sort(),
        });
      }
    } catch (err) {
      console.error(`[inboxkit-stuck] exports ${workspaceId}`, err);
    }

    try {
      const boxes = await listMailboxes(workspaceId, { limit: 100 });
      const stuckBoxes: string[] = [];
      let oldestBoxH = 0;
      for (const box of boxes) {
        const status = String(box.status || '').toLowerCase();
        if (!MAILBOX_IN_FLIGHT.has(status)) continue;
        const ageH = hoursSince(box.created_at || box.updated_at);
        if (ageH == null || ageH < thresholdH) continue;
        oldestBoxH = Math.max(oldestBoxH, ageH);
        stuckBoxes.push(`\`${emailOf(box)}\` ${status} ${ageH.toFixed(1)}h`);
      }
      if (stuckBoxes.length) {
        groups.push({
          key: `mailbox:${workspaceId}`,
          kind: 'mailbox',
          workspaceId,
          workspaceName: ws.name,
          clientName,
          jobId: job?.id,
          hours: oldestBoxH,
          items: stuckBoxes.sort(),
        });
      }
    } catch (err) {
      console.error(`[inboxkit-stuck] mailboxes ${workspaceId}`, err);
    }
  }

  for (const job of jobs) {
    if (job.status !== 'await_ns' || !job.inboxkitWorkspaceId) continue;
    const ageH = hoursSince(nsWaitStartedAt(job));
    if (ageH == null || ageH < thresholdH) continue;
    groups.push({
      key: `ns:${job.id}`,
      kind: 'nameservers',
      workspaceId: job.inboxkitWorkspaceId,
      clientName: job.companyName || job.brand?.clientName || job.websiteUrl,
      jobId: job.id,
      hours: ageH,
      items: [
        `${job.registeredDomains.length} domain(s) waiting on InboxKit nameserver match for ${ageH.toFixed(1)}h`,
      ],
    });
  }

  if (!groups.length) return;

  const store = loadAlerts();
  const now = new Date().toISOString();
  for (const group of groups) {
    const prev = store[group.key];
    if (prev && Date.now() - Date.parse(prev.lastAlertedAt) < ALERT_COOLDOWN_MS) {
      continue;
    }
    try {
      await notifyInboxkitStuckSlack({
        channel,
        clientName: group.clientName,
        workspaceId: group.workspaceId,
        workspaceName: group.workspaceName,
        jobId: group.jobId,
        hours: group.hours,
        kind: group.kind,
        items: group.items,
      });
      store[group.key] = { lastAlertedAt: now };
      try {
        await sendSlackMessage(
          `Posted InboxKit stuck ping (${group.kind}, ${group.hours.toFixed(1)}h) for *${group.clientName}* to the shared InboxKit channel.`,
        );
      } catch {
        // ops channel notify is best-effort
      }
    } catch (err) {
      console.error(`[inboxkit-stuck] slack ${group.key}`, err);
    }
  }
  saveAlerts(store);
}
