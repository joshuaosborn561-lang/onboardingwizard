# Automation gaps

Audit of what `onboardingwizard` already runs vs Josh’s STANDARDS and the remaining InboxKit / Porkbun / Smartlead hand work. Scope is the **job-scoped wizard** on Railway (`client-onboarding`). This file is the thread-1 deliverable; later threads own the sweep, naming guards, and bulk rename.

Spend gates are intact. This audit did not register domains, buy seats, cancel anything, or mutate Smartlead.

## Already automated (per onboarding job)

The wizard, given a website URL, can take **one new client job** from ingest through warmed Smartlead accounts:

| Step | What the code does | Human still clicks |
|---|---|---|
| Intake | `POST /api/onboarding` + guided UI. `manualApproval` is hard-locked `true`. | Start the job |
| Domains | Gemini + affix spins of the **client brand** on `.info` (`tryroofsbypeterson.info`). Porkbun availability check (throttled). | Approve domains + inbox count + Google/MS split |
| Porkbun | Register approved domains on the **main** account, auto-renew off at create, URL-forward to the client site, NS cutover. Pauses at `await_porkbun_funds` if the wallet is short. | Approve spend; confirm a funds top-up if needed |
| InboxKit | Create/reuse **this job’s** workspace, connect domains, wait NS (15m in-process poller), plan exactly **2** senders/domain, letter-only unique usernames from a made-up persona pool. InboxKit warmup is never enabled. | Approve mailbox wallet spend |
| Mailboxes | Wallet buy, webhook wait, optional `sync-mailboxes`. Stuck provision/export can Slack-ping InboxKit after 12h. | Wait / ping InboxKit if their side stalls |
| Smartlead | Google: SMTP/app-password import. Microsoft: InboxKit sequencer export (needs IK↔SL connection). Dedupes by email, enables Smartlead warmup, signature `First Last` + company line, assigns a Smartlead client (or stays on the main account if client/save is plan-gated). Extra load gate before import. | Approve Smartlead load |
| Recovery | Per-job retry and reload-smartlead. Trim/restore endpoints still exist in code but are **not** a STANDARDS-approved cancel path (Josh has not approved that extra path). | Retry / reload only |

Secrets stay in Railway env (`PORKBUN_*`, `INBOXKIT_API_KEY`, `SMARTLEAD_API_KEY`, `SLACK_*`). API responses mask Porkbun keys and mailbox passwords.

## Gaps vs STANDARDS / the plan

These are still **manual**, missing, or only half-covered. Thread numbers match the automation plan.

### Weekday inventory sweep (thread 2) — not built

The wizard only sees mailboxes it just bought for **that job**. It does not walk **all InboxKit workspaces** (including **DW Generic**).

Missing weekday cron (~8:26am America/Chicago, **never Sat/Sun**):

- ACTIVE in InboxKit but missing from Smartlead → load (Google API / Microsoft IK export), tag the correct Smartlead client (IK workspace → SL client), warmup on, no duplicates, never leave `sequencer_status=na`.
- CANCELLED in InboxKit → delete IK seat, remove from Smartlead; turn off Porkbun auto-renew (or delete the domain) **only when every seat on that domain is cancelled**.
- `scheduled_for_cancellation` seats that are still active/sending → **leave them**.
- Persist a cancellation log: domain, mailbox_email, client_id, IK status, renewal/cancel date, reason, state (`upcoming` / `due` / `deleted_IK` / `deleted_SL`).
- Tell Deliverability about **new imports** only (not a daily Josh ping).

Today’s 15-minute `setInterval` (NS wait + InboxKit stuck watch) runs **seven days a week**. Railway `railway.toml` / `railway.json` define a web service only — **no weekday cron**. Microsoft export retries exist **inside a job** (~10 minutes) then stop; there is no weekday chase until the mailbox is in Smartlead and client-tagged. No dry-run sweep mode. No compact `GET /api/status` (counts, ≤10 stuck samples, human decisions). Slack already does approval + failure + optional job-complete; it must not grow into a daily digest.

`listWorkspaces()` exists in the InboxKit client but is unused for inventory.

### Naming / domain policy (thread 3) — partial

| STANDARDS | Wizard today |
|---|---|
| Never use the client’s name or real staff names in local parts, display names, or personas | Default pool is made-up, but `mailboxPlan` overrides accept any `firstName` / `lastName` / `username`. The pool includes last names like `Peterson` and first names like `Joshua` with **no client/staff denylist**. |
| Prefer **generic, client-neutral** domains (no client or industry words) | Always spins the **brand root** onto `.info`. |
| No forwarding on generic domains; branded domains **may** forward | Always forwards Porkbun + InboxKit to the client site. |
| Max 2 / domain; usernames letters only, unique, no digits | Enforced on **new** plans. Existing >2/domain left alone (per-job trim is not standing-approved). |
| SURBL listing is fine; any **other** blacklist is a blocker | **No blacklist check at all.** |

### Bulk persona rename (thread 4) — not built

No code path to rename existing InboxKit + Smartlead mailboxes (e.g. the ~30 client-named inboxes) under dry-run / approval rules.

### Hard “do not touch” — not encoded in runtime

- **PowerGRYD / Smartlead client `592842`**: runtime refuse covers destination assignment **and** warmup / signature / rename / delete / tag on accounts already tagged `592842`. Campaigns, PODs, and campaign mailbox links stay off-limits.
- Campaigns, PODs, and campaign mailbox links: the wizard does not call those APIs today, but nothing asserts that invariant.
- Deliverability (separate agent) owns warmup **tuning**, POD A/B, CANON, staffing after import. The wizard already sets warmup on; it must not start tuning or linking campaigns.

### Slack / data hygiene

STANDARDS: never dump big lists; counts plus **≤10 samples**. Smartlead-load Slack posts the **full** mailbox + signature list (chunked). InboxKit stuck pings can list every in-flight seat. Job-complete “✅ onboarding complete” is event-driven (not a daily ping) and is fine to keep.

Secrets: sanitized on `GET /api/jobs/:id`. Do not log raw API keys or dump Smartlead/InboxKit payloads into Slack or chat.

### Offer language

No client-facing copy in the wizard UI. If any is added later: **no free POC**. SalesGlider guarantees meetings or keeps working until they hit the number.

## Human still required (do not automate away)

Even after threads 2–4, a human (Cayden normally; Josh can approve) must still:

1. **Say yes to spend** — Porkbun domain registration, InboxKit wallet buys, Porkbun funds top-ups. No bypass, no default-approve, no “skip for testing.”
2. **Confirm per-job Smartlead load** until product decides that gate can drop (it is not a spend gate, but it is the last chance to catch bad personas/domains).
3. **Paste an InboxKit workspace id** when workspace create is unavailable via API.
4. **Connect InboxKit → Smartlead** (login/password) so Microsoft exports can run. Google can import without that connection.
5. **Handle non-SURBL blacklist hits** once that check exists — those are blockers, not auto-skips.
6. **Own Deliverability after import** — warmup tuning, POD A/B, CANON, staffing. Onboarding only reports “N new imports.”
7. **Approve the first live sweep mutations** — implementation must ship dry-run first. Standing approval covers **only** the documented weekday CANCELLED cleanup, not ad-hoc deletes.
8. **Never point jobs at PowerGRYD (`592842`)**.
9. **Weekday-only operations** — nothing scheduled Sat/Sun America/Chicago.

Do not cancel live seats, do not touch Smartlead campaigns/PODs, and do not spend from this repo without an explicit contemporaneous yes.
