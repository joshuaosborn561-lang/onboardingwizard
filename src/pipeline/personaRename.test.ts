import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { POWERGRYD_SMARTLEAD_CLIENT_ID, STATUS_SAMPLE_CAP } from '../lib/standards.js';
import type { PersonaRenameVendors } from './personaRename.js';

const dataDir = mkdtempSync(join(tmpdir(), 'persona-rename-'));
process.env.DATA_DIR = dataDir;

const {
  applyPersonaRename,
  startPersonaRename,
  summarizePersonaRename,
} = await import('./personaRename.js');

type Mailbox = Awaited<ReturnType<PersonaRenameVendors['listMailboxes']>>[number];

function mailbox(partial: Partial<Mailbox> & Pick<Mailbox, 'uid'>): Mailbox {
  return {
    domain_name: 'tryacme.info',
    first_name: 'Marcus',
    last_name: 'Whitaker',
    username: 'marcus.whitaker',
    platform: 'GOOGLE',
    status: 'active',
    email: 'marcus.whitaker@tryacme.info',
    ...partial,
  };
}

function vendors(opts: {
  mailboxes: Mailbox[];
  accounts?: Array<{
    id: number;
    from_email: string;
    client_id?: number | null;
  }>;
}): PersonaRenameVendors & {
  calls: {
    updateMailbox: unknown[];
    changeUsername: unknown[];
    updatePersona: unknown[];
    addEmail: unknown[];
    export: unknown[];
  };
} {
  const calls = {
    updateMailbox: [] as unknown[],
    changeUsername: [] as unknown[],
    updatePersona: [] as unknown[],
    addEmail: [] as unknown[],
    export: [] as unknown[],
  };
  return {
    calls,
    listMailboxes: async () => opts.mailboxes,
    updateMailbox: async (_ws, input) => {
      calls.updateMailbox.push(input);
    },
    changeMailboxUsername: async (_ws, uid, username) => {
      calls.changeUsername.push({ uid, username });
    },
    getMailboxCredentials: async () => ({ password: 'secret-app-pass' }),
    ensureSmartleadSequencer: async () => 'seq-1',
    exportMailboxesToSequencer: async (_ws, sequencerUid, uids) => {
      calls.export.push({ sequencerUid, uids });
      return { newExports: uids.length, duplicates: 0, created: [] };
    },
    listEmailAccounts: async () => opts.accounts ?? [],
    updateEmailAccountPersona: async (id, input) => {
      calls.updatePersona.push({ id, ...input });
    },
    addEmailAccount: async (input) => {
      calls.addEmail.push({
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        clientId: input.clientId,
      });
      return 99;
    },
    enableWarmup: async () => undefined,
    sleep: async () => undefined,
  };
}

before(() => {
  process.env.DATA_DIR = dataDir;
});

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('persona rename dry-run and approval', () => {
  it('dry-run flags client-named inboxes and never writes', async () => {
    const v = vendors({
      mailboxes: [
        mailbox({
          uid: 'm1',
          first_name: 'Kyle',
          last_name: 'Peterson',
          username: 'kyle.peterson',
          email: 'kyle.peterson@tryacme.info',
        }),
        mailbox({ uid: 'm2' }),
      ],
      accounts: [{ id: 11, from_email: 'kyle.peterson@tryacme.info', client_id: 100 }],
    });

    const job = await startPersonaRename(
      {
        inboxkitWorkspaceId: 'ws_1',
        clientName: 'Peterson Roofing',
        staffNames: ['Kyle'],
      },
      v,
    );

    assert.equal(job.dryRun, true);
    assert.equal(job.status, 'planned');
    assert.equal(job.items.length, 1);
    assert.equal(job.items[0]?.oldEmail, 'kyle.peterson@tryacme.info');
    assert.ok(!/peterson/i.test(job.items[0]?.newLastName || ''));
    assert.ok(!/kyle/i.test(job.items[0]?.newFirstName || ''));
    assert.ok(job.items[0]?.changeUsername);
    assert.equal(v.calls.updateMailbox.length, 0);
    assert.equal(v.calls.changeUsername.length, 0);
    assert.equal(v.calls.updatePersona.length, 0);
    assert.equal(v.calls.addEmail.length, 0);
    assert.equal(v.calls.export.length, 0);
  });

  it('refuses live apply without approved=true', async () => {
    const v = vendors({
      mailboxes: [
        mailbox({
          uid: 'm1',
          first_name: 'Kyle',
          last_name: 'Peterson',
          username: 'kyle.peterson',
          email: 'kyle.peterson@tryacme.info',
        }),
      ],
    });
    const job = await startPersonaRename(
      { inboxkitWorkspaceId: 'ws_1', clientName: 'Peterson', dryRun: true },
      v,
    );
    await assert.rejects(
      () => applyPersonaRename(job.id, {}, v),
      /approved=true/,
    );
    assert.equal(v.calls.updateMailbox.length, 0);
  });

  it('skips PowerGRYD and cancelled seats', async () => {
    const v = vendors({
      mailboxes: [
        mailbox({
          uid: 'pg',
          first_name: 'Kyle',
          last_name: 'Peterson',
          username: 'kyle.pg',
          email: 'kyle.pg@tryacme.info',
        }),
        mailbox({
          uid: 'cx',
          first_name: 'Kyle',
          last_name: 'Peterson',
          username: 'kyle.cancel',
          email: 'kyle.cancel@tryacme.info',
          status: 'scheduled_for_cancellation',
        }),
      ],
      accounts: [
        {
          id: 1,
          from_email: 'kyle.pg@tryacme.info',
          client_id: POWERGRYD_SMARTLEAD_CLIENT_ID,
        },
      ],
    });
    const job = await startPersonaRename(
      { inboxkitWorkspaceId: 'ws_1', clientName: 'Peterson' },
      v,
    );
    assert.equal(job.items.length, 0);
    assert.ok(job.skipped.some((s) => /powergryd/i.test(s.reason)));
    assert.ok(job.skipped.some((s) => s.reason === 'cancelled_or_scheduled_for_cancellation'));
  });

  it('applies InboxKit + Smartlead persona updates after approval', async () => {
    const v = vendors({
      mailboxes: [
        mailbox({
          uid: 'm1',
          first_name: 'Kyle',
          last_name: 'Peterson',
          username: 'kyle.peterson',
          email: 'kyle.peterson@tryacme.info',
        }),
      ],
      accounts: [{ id: 44, from_email: 'kyle.peterson@tryacme.info', client_id: 200 }],
    });
    const planned = await startPersonaRename(
      { inboxkitWorkspaceId: 'ws_1', clientName: 'Peterson Roofing', staffNames: ['Kyle'] },
      v,
    );
    const applied = await applyPersonaRename(planned.id, { approved: true }, v);
    assert.equal(applied.status, 'completed');
    assert.equal(applied.approvedAt != null, true);
    assert.equal(v.calls.updateMailbox.length, 1);
    assert.equal(v.calls.changeUsername.length, 1);
    assert.equal(v.calls.updatePersona.length, 1);
    assert.equal((v.calls.updatePersona[0] as { id: number }).id, 44);
    assert.equal(applied.items[0]?.smartleadEmailStale, true);
    assert.equal(v.calls.export.length, 0);
  });

  it('caps summary samples at the STANDARDS limit', async () => {
    const mailboxes = Array.from({ length: 12 }, (_, i) =>
      mailbox({
        uid: `m${i}`,
        first_name: 'Kyle',
        last_name: 'Peterson',
        username: `kyle${'abcdefghijklmnopqrstuvwxyz'[i]}`,
        email: `kyle${'abcdefghijklmnopqrstuvwxyz'[i]}@tryacme.info`,
      }),
    );
    const v = vendors({ mailboxes });
    const job = await startPersonaRename(
      {
        inboxkitWorkspaceId: 'ws_1',
        clientName: 'Peterson',
        emails: mailboxes.map((m) => m.email!),
      },
      v,
    );
    const summary = summarizePersonaRename(job);
    assert.equal(job.items.length, 12);
    assert.equal(summary.samples.length, STATUS_SAMPLE_CAP);
    assert.ok(summary.samples.length <= 10);
  });
});
