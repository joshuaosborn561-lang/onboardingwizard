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
conventions). Treat that document as binding, not advisory.

## Working together without stepping on each other

- Don't push directly to `main`. Work on a branch, open a PR.
- If your change touches anything listed under "Non-negotiable rule" above,
  say so explicitly in the PR description and get Josh to sign off before
  merging.
- Keep `HANDOFF.md`-style context (what you changed and why) in your commit
  messages and PR descriptions so the next session — human or AI — can pick
  up where you left off without re-deriving it.

## Cursor Cloud specific instructions

Single Node.js/TypeScript Express service (no database, no docker-compose). State
is flat JSON files under `DATA_DIR` (`./data`, git-ignored). Standard commands
live in `package.json`: `npm run dev` (tsx watch), `npm run build` (tsc),
`npm run typecheck` (tsc --noEmit — this is the closest thing to a lint step;
there is no ESLint and no test suite), `npm start` (runs the built `dist/`).
The server listens on port **8080** and serves the UI, `/api`, and
`/webhooks/inboxkit` from that one port. Health check: `GET /api/health`.

Non-obvious gotchas for running/testing here:

- **The server boots with no secrets.** All required-secret validators in
  `src/config.ts` are lazy functions that only throw when a route/pipeline step
  that needs them actually runs. So `npm run dev` works with an empty/missing
  `.env`, and the UI + `/api/health` are fully usable without any credentials.
- **Spend-safe smoke test (no keys, no money):** `POST /api/onboarding`
  `{"websiteUrl":"https://example.com","companyName":"Example Co"}` runs the
  first two pipeline stages — website ingest (`src/vendors/website.ts`, needs
  outbound network to fetch the site) and `.info` domain-candidate generation —
  then pauses at the `await_porkbun` / `porkbun_credentials` gate. Poll with
  `GET /api/jobs/:id`. This is the recommended end-to-end check; it exercises
  core functionality and spends nothing. The same flow works through the web
  wizard at `http://localhost:8080`.
- Despite the name, `src/vendors/gemini.ts` generates candidates **locally**
  (`generateAffixCandidates`), so `GEMINI_API_KEY` is not needed to reach the
  domain step.
- **Everything past `await_porkbun` needs real vendor credentials** (Porkbun,
  InboxKit, Smartlead, Slack) and, per the non-negotiable spend rules above,
  MUST NOT be driven to a paid step (domain registration, mailbox purchase,
  Porkbun top-up) during testing. Keep testing to the pre-spend stages.
