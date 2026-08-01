# Contributing

This repository is maintained by a small team. The goal is to keep work visible,
branches short-lived, and production changes safe.

Read [`AGENTS.md`](./AGENTS.md) and [`ONBOARDING_SOP.md`](./ONBOARDING_SOP.md)
before changing code. Their spend-approval and no-test-send rules are binding.

## Branch-per-task workflow

Never commit directly to `main`.

Start each task from the latest `main`:

```bash
git switch main
git pull --ff-only origin main
git switch -c <your-name>/<short-task>
```

Examples:

```text
cayden/lead-scraper-fix
josh/smartlead-pagination
```

Use lowercase, hyphenated task names. Keep one concern per branch. Do not reuse a
merged branch for unrelated work.

If `main` changes while you are working:

```bash
git fetch origin main
git merge origin/main
```

Resolve conflicts on your feature branch, run validation, and push the resolution.
Never force-push a shared branch.

## Claim work before editing

Before starting, post a short message in the team Slack channel:

```text
Working on <task> in <area/files>.
Branch: <branch-name>
Expected shared files: <files or "none">
```

If someone already owns an overlapping file, coordinate the boundary first. This
matters most for:

- `src/pipeline/onboarding.ts`
- `src/types.ts`
- `src/api/routes.ts`
- `src/vendors/inboxkit.ts`
- `src/vendors/slack.ts`
- `public/app.js`
- `package-lock.json`
- `README.md` and `ONBOARDING_SOP.md`

See [`.github/OWNERSHIP.md`](./.github/OWNERSHIP.md) for the suggested two-person
split and handoff rules.

## Commit and push habits

- Commit one logical change at a time.
- Push at least at each stable checkpoint; do not keep multi-day work only locally.
- Write commit subjects as an imperative summary, for example:
  `Handle Smartlead pagination`.
- Do not mix formatting, refactors, dependencies, and feature behavior in one PR.
- Never commit `.env`, API keys, passwords, tokens, production exports, or job data.

## Pull requests

Every change reaches `main` through a pull request, including documentation and
configuration changes.

Before opening a PR:

```bash
npm ci
npm run check
```

For deployment-related changes, also run:

```bash
docker build -t client-onboarding-automation .
```

Then:

1. Push the feature branch.
2. Open a focused PR against `main`.
3. Complete the PR template, including owner, shared files, and validation.
4. Ask the other contributor to review.
5. Resolve every review conversation.
6. Merge only after CI passes. Prefer squash merge for a concise `main` history.
7. Delete the merged feature branch.

## Conflict handling

The contributor whose PR merges second resolves the conflict on their branch.

For simple conflicts:

1. Fetch and merge current `main`.
2. Resolve only the overlapping intent.
3. Re-run `npm run check`.
4. Push the merge resolution.

For non-trivial conflicts in approval gates, job-state types, shared vendor logic,
or UI/API contracts, stop and talk through the intended behavior before choosing
either side.

## Safety rules for production-facing work

The following always require explicit approval from Josh before execution:

- Any domain or mailbox purchase.
- Any action that consumes paid credits.
- Rotating, revoking, regenerating, or replacing API keys or credentials.
- Changing production environment variables.
- Deploying to production.
- Sending any email test or test campaign.
- Weakening an approval gate.

Read-only checks do not require approval. Code may be prepared in a PR, but do not
perform the external mutation without approval.

