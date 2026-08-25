import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { listJobs } from '../store/jobs.js';
import type { OnboardingJob } from '../types.js';
import {
  getSequencerExportStatus,
  listMailboxes,
  type SequencerExportStatus,
} from '../vendors/inboxkit.js';
import { notifyInboxkitStuckSlack } from '../vendors/slack.js';

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

/** Errors that are our credentials / config — do not ping InboxKit. */
const OUR_SIDE_ERROR = /invalid smartlead|api key|credential|login failed|password is incorrect|unauthorized|SMARTLEAD_/i;

interface AlertRecord {
  lastAlertedAt: string;
}

interface AlertStore {
  [key: string]: AlertRecord;
}

interface StuckGroup {
  key: string;
  kind: 'export' | 'mailbox';
  workspaceId: string;
  clientName: string;
  jobId: string;
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

function isOurSideError(message?: string | null): boolean {
  return Boolean(message && OUR_SIDE_ERROR.test(message));
}

async function listInFlightExports(workspaceId: string): Promise<SequencerExportStatus[]> {
  const out: SequencerExportStatus[] = [];
  for (const status of EXPORT_IN_FLIGHT) {
    const page = await getSequencerExportStatus(workspaceId, { status, limit: 100 });
    out.push(...page);
  }
  return out;
}

/**
 * Only jobs that already paid InboxKit and are waiting on *their* pipeline:
 * mailbox provisioning after buy, or Microsoft export after Smartlead approval.
 * Do not scan every workspace for historical failures.
 */
function jobsWaitingOnInboxkit(): OnboardingJob[] {
  return listJobs().filter((job) => {
    if (!job.inboxkitWorkspaceId) return false;
    if (job.status === 'await_mailboxes') return true;
    if (job.status === 'load_smartlead') return true;
    return false;
  });
}

export async function pollInboxkitStuck(): Promise<void> {
  const channel = config.slackInboxkitChannelId();
  if (!channel) {
    console.log('[inboxkit-stuck] SLACK_INBOXKIT_CHANNEL_ID not set — skip');
    return;
  }

  const thresholdH = config.inboxkitStuckHours();
  const groups: StuckGroup[] = [];

  for (const job of jobsWaitingOnInboxkit()) {
    const workspaceId = job.inboxkitWorkspaceId!;
    const clientName = job.companyName || job.brand?.clientName || job.websiteUrl;

    if (job.status === 'await_mailboxes') {
      try {
        const boxes = await listMailboxes(workspaceId, { limit: 100 });
        const wanted = new Set(job.mailboxes.map((m) => m.uid));
        const stuckBoxes: string[] = [];
        let oldestBoxH = 0;
        for (const box of boxes) {
          if (wanted.size && !wanted.has(box.uid)) continue;
          const status = String(box.status || '').toLowerCase();
          if (!MAILBOX_IN_FLIGHT.has(status)) continue;
          const ageH = hoursSince(box.created_at || box.updated_at);
          if (ageH == null || ageH < thresholdH) continue;
          oldestBoxH = Math.max(oldestBoxH, ageH);
          stuckBoxes.push(`\`${emailOf(box)}\` ${status} ${ageH.toFixed(1)}h`);
        }
        if (stuckBoxes.length) {
          groups.push({
            key: `mailbox:${job.id}`,
            kind: 'mailbox',
            workspaceId,
            clientName,
            jobId: job.id,
            hours: oldestBoxH,
            items: stuckBoxes.sort(),
          });
        }
      } catch (err) {
        console.error(`[inboxkit-stuck] mailboxes ${job.id}`, err);
      }
    }

    if (job.status === 'load_smartlead') {
      try {
        const exports = await listInFlightExports(workspaceId);
        const jobEmails = new Set(
          job.mailboxes
            .filter((m) => m.platform === 'MICROSOFT' && !m.smartleadLoaded)
            .map((m) => m.email.toLowerCase()),
        );
        const jobUids = new Set(
          job.mailboxes.filter((m) => m.platform === 'MICROSOFT' && !m.smartleadLoaded).map((m) => m.uid),
        );
        const stuckExports: string[] = [];
        let oldestExportH = 0;
        for (const exp of exports) {
          const status = String(exp.status || '').toLowerCase();
          if (!EXPORT_IN_FLIGHT.has(status)) continue;
          if (isOurSideError(exp.error_message)) continue;
          const email = String(exp.mailbox_email || '').toLowerCase();
          const uid = String(exp.mailbox_uid || '');
          if (jobEmails.size && !jobEmails.has(email) && !jobUids.has(uid)) continue;
          const ageH = hoursSince(exp.created_at || exp.updated_at);
          if (ageH == null || ageH < thresholdH) continue;
          oldestExportH = Math.max(oldestExportH, ageH);
          const err = exp.error_message ? ` — ${exp.error_message}` : '';
          stuckExports.push(`\`${exp.mailbox_email || exp.mailbox_uid}\` ${status} ${ageH.toFixed(1)}h${err}`);
        }
        if (stuckExports.length) {
          groups.push({
            key: `export:${job.id}`,
            kind: 'export',
            workspaceId,
            clientName,
            jobId: job.id,
            hours: oldestExportH,
            items: stuckExports.sort(),
          });
        }
      } catch (err) {
        console.error(`[inboxkit-stuck] exports ${job.id}`, err);
      }
    }
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
        jobId: group.jobId,
        hours: group.hours,
        kind: group.kind,
        items: group.items,
      });
      store[group.key] = { lastAlertedAt: now };
    } catch (err) {
      console.error(`[inboxkit-stuck] slack ${group.key}`, err);
    }
  }
  saveAlerts(store);
}
