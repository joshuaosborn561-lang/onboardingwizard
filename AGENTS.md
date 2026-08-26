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
Smartlead client workspaces are named after the **person** (`clientName`,
e.g. Roger Nutter); login emails are unique variants of
`joshosb1996@gmail.com` and require a password. See
`.cursor/skills/smartlead-client/SKILL.md`.

## Working together without stepping on each other

- Don't push directly to `main`. Work on a branch, open a PR.
- If your change touches anything listed under "Non-negotiable rule" above,
  say so explicitly in the PR description and get Josh to sign off before
  merging.
- Keep `HANDOFF.md`-style context (what you changed and why) in your commit
  messages and PR descriptions so the next session — human or AI — can pick
  up where you left off without re-deriving it.
