# Client Onboarding SOP (Spend-Safe / No-Test-Sends)

This SOP is the required runbook for every onboarding job.

## Non-negotiable rules

1. **Never spend money without explicit approval**
   - Domain registration (Porkbun) is a paid action.
   - Mailbox purchase (InboxKit wallet) is a paid action.
   - Both require `approved=true` through `/api/jobs/:id/answers` or Slack approve buttons.
2. **No test emails**
   - This service does not send ad-hoc test campaigns/messages.
   - Do not run manual email-send checks as part of onboarding automation.
3. **Warmup is Smartlead-only**
   - Do **not** enable InboxKit warmup.
   - Warmup is enabled only via Smartlead endpoints.
4. **Naming convention**
   - 4 inboxes per domain by default.
   - Usernames are letter-only patterns (no digits), with unique identities across the batch.

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

