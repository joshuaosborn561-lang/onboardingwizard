# Client Onboarding SOP (Spend-Safe / No-Test-Sends)

This SOP is the required runbook for every onboarding job. Josh’s STANDARDS
below are binding — if a later ticket, teammate, or agent prompt conflicts,
**this file wins**. Stop and ask Josh.

The pipeline field manualApproval is hard-locked to true in
`src/pipeline/onboarding.ts` and `src/api/routes.ts`. Callers cannot turn it off.

Gap map (what the wizard already does vs remaining hand work):
[`docs/AUTOMATION-GAPS.md`](./docs/AUTOMATION-GAPS.md).

## Non-negotiable rules

1. **Never spend money without explicit approval**
   - Domain registration (Porkbun) is a paid action.
   - Mailbox purchase (InboxKit wallet) is a paid action.
   - Porkbun funds top-ups are a paid action.
   - Approvals come from a human (Cayden normally; Josh can approve), never auto.
   - All three pause at an `await_*` state until a human sends `approved=true`
     through `/api/jobs/:id/answers` or Slack approve buttons (in-channel
     interactive buttons or the `/api/approve` browser fallback). Slack buttons
     are signed and do not bypass this gate.
   - Do not add a bypass, a default-approve flag, a “skip for testing” mode, or
     anything that lets a paid step run unattended.
2. **No test emails**
   - This service does not send ad-hoc test campaigns/messages.
   - Do not run manual email-send checks as part of onboarding automation.
3. **Warmup is Smartlead-only**
   - Do **not** enable InboxKit warmup.
   - Warmup is enabled only via Smartlead endpoints.
4. **Naming convention**
   - **Max 2 inboxes per domain.** New jobs plan exactly 2 senders per domain.
   - Existing seats above 2/domain are left alone. Per-job trim/restore is
     not a standing-approved cancel path.
   - Usernames are letter-only patterns (no digits), unique across the batch.
   - **Never** use the client’s name or any real client staff name in inbox
     local parts, display names, or personas. Always made-up neutral personas
     (e.g. `marcus@` / Marcus Whitaker), even on branded domains.
   - Prefer generic client-neutral domains (no client or industry words) and
     neutral personas. No forwarding on generic domains — but still assign
     those inboxes to the client’s InboxKit workspace and Smartlead client so
     they can be reassigned later. Branded domains may forward to the client site.
   - Domain checks: a **SURBL** listing is fine. Any **other** blacklist listing
     is a blocker.
5. **Cancellations / deletions**
   - Allowed only under the weekday inventory sweep (Josh’s standing approval
     for that documented rule). Per-job trim/restore is **not** standing-
     approved and must not cancel inventory. Do not invent ad-hoc cancels.

---

## Josh’s STANDARDS (binding)

### Smartlead

- Every **ACTIVE** InboxKit mailbox must be in Smartlead (never leave
  `sequencer_status=na`), tagged to the right Smartlead client, warmup on
  (Smartlead-only; InboxKit warmup off). Signature `First Last` / Company
  (plain-text name line, then company line).
- No duplicates in Smartlead.
- After import, **Deliverability** (a separate agent) owns warmup tuning,
  POD A/B, CANON, staffing. Onboarding must **not** touch campaigns, PODs, or
  campaign mailbox links.
- **PowerGRYD (Smartlead client 592842): do not touch, ever.** Runtime
  helpers in `src/lib/standards.ts` refuse this id as a destination **and**
  refuse warmup, signature, rename, delete, and tag on any account already
  tagged `592842`.
- Microsoft seats go to Smartlead via InboxKit export (needs the InboxKit
  sequencer connection). Google seats can be direct-imported via Smartlead
  API (IMAP/SMTP).

### Daily IK ↔ Smartlead ↔ Porkbun sweep

Weekdays only, ~8:26am America/Chicago. Scope: **all** InboxKit workspaces
(including **DW Generic**).

- ACTIVE in IK but missing from Smartlead → load/export to Smartlead,
  client-tagged, warmup on.
- CANCELLED in IK → delete from InboxKit, remove from Smartlead; turn off
  Porkbun auto-renew (or delete the domain) only once **every** seat on that
  domain is cancelled.
- `scheduled_for_cancellation` but still active/sending → leave in place
  until it takes effect.
- Keep cancellation log entries: domain, mailbox_email, client_id, IK
  status, renewal/cancel date, reason, state (`upcoming` / `due` /
  `deleted_IK` / `deleted_SL`).
- Report new imports so Deliverability can be told. **No daily status pings
  to Josh.** Only surface: blocked, needs a decision/approval, or a real
  failure.

The sweep is **not built yet** (see `docs/AUTOMATION-GAPS.md`). Until it
exists, do this by hand. When it is built: dry-run first; live mutations
stay behind these rules. Nothing runs Saturday or Sunday (America/Chicago).

### Schedules and data hygiene

- **NOTHING** runs on Saturday or Sunday (America/Chicago). All crons
  weekday-only.
- Never print or log secrets. Never dump big lists into chat/Slack — counts
  plus **≤10 samples**.
- Never commit secrets. Read `PORKBUN_*`, `INBOXKIT_API_KEY`,
  `SMARTLEAD_API_KEY`, `SLACK_*` from Railway env.

### Offer language (if any client-facing copy)

- No free POC. SalesGlider guarantees meetings or keeps working until they
  hit the number.

---

## Workflow (manual process mirrored in automation)

### 1) Intake
- `POST /api/onboarding`
- Inputs: `websiteUrl`, optional `forwardToUrl`, `companyName`, optional `inboxCount`, optional `googleRatio`.
- Pipeline always runs with `manualApproval=true`.

### 2) Domain candidate generation (no spend)
- System generates/checks `.info` candidate domains.
- Job pauses at `await_domain_approval`.
- Slack/UI shows:
  - available domains
  - recommended domains
  - estimated cost
  - inbox + platform split preview

### 3) **Spend Gate #1** — domain registration approval
- Required call (or Slack approve button):
  - `POST /api/jobs/:id/answers`
  - body includes:
    - `approved: true`
    - approved `domains`
    - desired `inboxCount`
    - desired `googleRatio`
- Only after approval does status move to `register_domains`.

### 4) Domain registration + forwarding
- Registers approved domains on Porkbun.
- Applies forwarding to the client’s main URL.
- If funds are insufficient, job pauses at `await_porkbun_funds`.

### 5) Funds top-up confirmation (if needed)
- `POST /api/jobs/:id/answers` with `approved: true`
- Retries remaining registrations only.

### 6) InboxKit provisioning (no spend yet)
- Creates/uses workspace.
- Connects domains and sets nameservers.
- Waits for NS propagation/match.
- Builds mailbox plan with identity assignment.

### 7) **Spend Gate #2** — mailbox order approval
- Job pauses at `await_mailbox_plan`.
- Required call (or Slack approve button):
  - `POST /api/jobs/:id/answers`
  - body includes:
    - `approved: true`
    - optional `mailboxPlan` override
- Only after approval does status move to `buy_mailboxes`.

### 8) Mailbox purchase and activation wait
- Buys via InboxKit wallet using approved plan.
- Waits for webhook updates until target mailboxes are active.
- Optional reconcile: `POST /api/jobs/:id/sync-mailboxes`.

### 9) Smartlead load approval (non-spend gate)
- Job pauses at `await_smartlead_load`.
- Required call (or Slack approve button):
  - `POST /api/jobs/:id/answers` with `approved: true`

### 10) Smartlead load + warmup
- Google accounts: add via SMTP/app-password path.
- Microsoft accounts: InboxKit → Smartlead export/OAuth path.
- Warmup enabled per account via Smartlead endpoint:
  - `POST /api/v1/email-accounts/{account_id}/warmup?api_key=...`

### 11) Reconcile and verify
- `POST /api/jobs/:id/reload-smartlead` to link missing accounts and ensure warmup on linked accounts.
- Verify every active mailbox has Smartlead account and warmup status `ACTIVE`.

---

## Operational checks (must pass)

- [ ] Job is not in an approval gate before attempting next paid stage.
- [ ] Every spend stage was explicitly approved (`approved=true`).
- [ ] No InboxKit warmup calls were made.
- [ ] No ad-hoc email tests were sent.
- [ ] No Smartlead campaigns, PODs, or PowerGRYD (client 592842) were touched.
- [ ] Personas are made-up and client-neutral (no client/staff names).
- [ ] Final: active mailbox count equals active warming count in Smartlead.

---

## Smartlead API references used by this flow

- Get all email accounts:
  - `https://api.smartlead.ai/api-reference/email-accounts/get-all`
- Add SMTP/IMAP account:
  - `https://api.smartlead.ai/api-reference/email-accounts/add-smtp`
- Add OAuth account:
  - `https://api.smartlead.ai/api-reference/email-accounts/add-oauth`
- Update warmup settings:
  - `https://api.smartlead.ai/api-reference/email-accounts/warmup-settings`

