import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { OnboardingJob } from '../types.js';

function jobsDir(): string {
  const dir = path.resolve(config.dataDir, 'jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function jobPath(id: string): string {
  return path.join(jobsDir(), `${id}.json`);
}

export function saveJob(job: OnboardingJob): OnboardingJob {
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), 'utf8');
  return job;
}

export function getJob(id: string): OnboardingJob | null {
  const file = jobPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as OnboardingJob;
}

export function listJobs(): OnboardingJob[] {
  const dir = jobsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as OnboardingJob)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendLog(job: OnboardingJob, message: string): void {
  job.logs.push({ at: new Date().toISOString(), message });
  if (job.logs.length > 400) job.logs = job.logs.slice(-400);
  console.log(`[job:${job.id}] ${message}`);
}

/** Map InboxKit workspace IDs back to local jobs waiting on webhooks. */
export function findJobsByWorkspace(workspaceId: string): OnboardingJob[] {
  return listJobs().filter(
    (j) => j.inboxkitWorkspaceId === workspaceId && j.status === 'await_mailboxes',
  );
}

export function findJobByMailboxUid(uid: string): OnboardingJob | null {
  for (const job of listJobs()) {
    if (job.mailboxes.some((m) => m.uid === uid)) return job;
  }
  return null;
}
