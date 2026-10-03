# Project Rules (read this first — every session, every contributor)

This file is the source of truth for how this repo is allowed to be changed.
It is written by Josh (repo owner) and loaded automatically at the start of
every AI coding session (Claude Code, Cursor, etc.). If a task, a teammate,
or another document seems to conflict with this file, **this file wins** —
stop and ask Josh before proceeding.

Anyone — human or AI agent — is free to build, refactor, and ship whatever
they want in this repo, **as long as it does not contradict the rules below**.

## Non-negotiable rule: no spend without explicit human approval

This app spends real money and credits (Porkbun domain registration, InboxKit
mailbox wallet purchases, and API credits on other connected services). That
must never happen without an explicit, contemporaneous "yes" from a human.

This is already implemented two ways. **Both must stay intact:**

1. **App-level spend gates** (`ONBOARDING_SOP.md`, `src/lib/approveToken.ts`,
   `src/pipeline/onboarding.ts`): `manualApproval` is hard-locked to `true` —
   callers cannot turn it off. Domain registration, mailbox purchases, and
   Porkbun funds top-ups all pause the job at an `await_*` state until a
   human sends `approved: true` via `/api/jobs/:id/answers` or a Slack
   approve button. Do not add a bypass, a default-approve flag, a "skip for
   testing" mode, or anything that lets a paid step run unattended.

2. **Session-level tool gate** (`.claude/settings.json`): forces Claude Code
   to stop and ask before calling any MCP tool that can itself spend money or
   credits (getleads, AI_Ark, Supabase, Railway, DocuSign, etc.), independent
   of the app. Do not remove entries from `permissions.ask` or weaken this
   file without Josh's explicit sign-off.

**Any change that removes, weakens, disables, or adds a way around either of
these mechanisms requires Josh's explicit approval before it is merged** —
no exceptions, even for "just testing" or "temporary" changes.

## Other rules carried over from the onboarding SOP

See `ONBOARDING_SOP.md` for the full operational rules (no ad-hoc test
sends, InboxKit warmup is disabled/Smartlead-only, mailbox naming
conventions, **max 2 senders per domain**). Treat that document as binding, not advisory.

What the wizard already automates vs remaining hand work:
[`docs/AUTOMATION-GAPS.md`](./docs/AUTOMATION-GAPS.md). Constants used by
code live in `src/lib/standards.ts`.

## Josh’s STANDARDS (binding — do not weaken)

Owner: Joshua Osborn. Spend approver: Cayden normally; Josh can approve.

- **Never spend money without explicit human approval** (Porkbun domains,
  InboxKit seats/wallet, Porkbun top-ups). Never auto-approve.
- **Cancellations/deletions** are allowed only under the weekday sweep rule
  in `ONBOARDING_SOP.md` (Josh’s standing approval for that rule) or an
  explicit human `confirmed=true` on the existing per-job trim/restore
  endpoints. Do not cancel anything else.
- **Personas:** never the client’s name or any real client staff name in
  local parts, display names, or personas. Made-up neutral personas only
  (e.g. marcus@ / Marcus Whitaker), even on branded domains.
- **Domains:** prefer generic client-neutral names (no client or industry
  words). No forwarding on generic domains; still assign those inboxes to
  the client’s InboxKit workspace and Smartlead client. Branded domains may
  forward to the client site. **Max 2 inboxes per domain.** Usernames
  letters only, unique, no digits. A **SURBL** listing is fine; any other
  blacklist listing is a blocker.
- **Smartlead:** every ACTIVE InboxKit mailbox must be in Smartlead (never
  `sequencer_status=na`), tagged to the right client, warmup on
  (Smartlead-only). Signature `First Last` / Company. No duplicates.
  Microsoft via InboxKit export; Google via Smartlead API.
- **Do not touch** Smartlead campaigns, PODs, campaign mailbox links, or
  **PowerGRYD (Smartlead client 592842)**. After import, Deliverability owns
  warmup tuning / POD A/B / CANON / staffing. Onboarding only reports new
  imports.
- **Weekday inventory sweep** (~8:26am America/Chicago, never Sat/Sun): all
  InboxKit workspaces including **DW Generic**. ACTIVE-in-IK-not-in-SL →
  load + tag + warmup. CANCELLED → delete IK + remove SL; Porkbun
  auto-renew off only when every seat on that domain is cancelled. Leave
  `scheduled_for_cancellation` seats alone. Persist a cancellation log.
- **NOTHING** runs Saturday or Sunday (America/Chicago). No daily status
  pings to Josh — only blocked, needs a decision/approval, or a real
  failure. Slack/status dumps: counts plus **≤10 samples**. Never print or
  commit secrets.
- **Offer language:** no free POC. SalesGlider guarantees meetings or keeps
  working until they hit the number.

Live mutation paths stay behind these rules. Development is dry-run / mocks
only. Do not spend money, do not cancel inventory, do not push `main`.

## Working together without stepping on each other

- Don't push directly to `main`. Work on a branch, open a PR.
- If your change touches anything listed under "Non-negotiable rule" above,
  say so explicitly in the PR description and get Josh to sign off before
  merging.
- Keep `HANDOFF.md`-style context (what you changed and why) in your commit
  messages and PR descriptions so the next session — human or AI — can pick
  up where you left off without re-deriving it.
