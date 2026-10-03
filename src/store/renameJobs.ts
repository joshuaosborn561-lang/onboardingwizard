import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { PersonaRenameJob } from '../pipeline/personaRenameTypes.js';

function renameJobsDir(): string {
  const dir = path.resolve(config.dataDir, 'rename-jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function renameJobPath(id: string): string {
  return path.join(renameJobsDir(), `${id}.json`);
}

export function saveRenameJob(job: PersonaRenameJob): PersonaRenameJob {
  job.updatedAt = new Date().toISOString();
  fs.writeFileSync(renameJobPath(job.id), JSON.stringify(job, null, 2), 'utf8');
  return job;
}

export function getRenameJob(id: string): PersonaRenameJob | null {
  const file = renameJobPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PersonaRenameJob;
}

export function listRenameJobs(): PersonaRenameJob[] {
  const dir = renameJobsDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as PersonaRenameJob)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function appendRenameLog(job: PersonaRenameJob, message: string): void {
  job.logs.push({ at: new Date().toISOString(), message });
  if (job.logs.length > 400) job.logs = job.logs.slice(-400);
  console.log(`[rename:${job.id}] ${message}`);
}
