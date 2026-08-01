# Ownership and conflict map

Ownership is a coordination tool, not permission to bypass review. Claim a task in
Slack before editing, and include the owner in the PR description.

## Suggested two-person split

| Area | Primary responsibility | Files |
|---|---|---|
| Pipeline and state | Job lifecycle, approval gates, spend safety, naming, persistence | `src/pipeline/**`, `src/types.ts`, `src/store/**`, `src/lib/**`, `ONBOARDING_SOP.md` |
| API and integrations | HTTP surface, vendor adapters, operator UI, runtime/deploy configuration | `src/api/**`, `src/vendors/**`, `public/**`, `src/index.ts`, `src/config.ts`, `Dockerfile`, `railway.*`, `README.md` |

Assign the two rows to Josh and Cayden at the beginning of a work cycle. Swap areas
when useful, but avoid both actively editing the same shared file.

## Shared contracts

Changes to these contracts require a quick sync and review from the other
contributor:

- `JobStep`, `PendingPrompt`, or `OnboardingJob` in `src/types.ts`
- approval behavior in `src/pipeline/onboarding.ts`
- endpoint payloads in `src/api/routes.ts`
- Slack approval messages in `src/vendors/slack.ts`
- operator behavior in `public/app.js`
- environment variables in `src/config.ts` and `.env.example`

When one contract changes, check every dependent surface in the same PR:

```text
types → pipeline → routes → Slack → public UI → SOP/README
```

## High-conflict files

| File | Coordination rule |
|---|---|
| `src/pipeline/onboarding.ts` | One active owner at a time; announce exact step/function |
| `src/types.ts` | Notify the other contributor before changing shared types |
| `src/api/routes.ts` | Coordinate endpoint additions and response-shape changes |
| `src/vendors/inboxkit.ts` | Separate mailbox-purchase work from export/auth work |
| `src/vendors/slack.ts` | Keep changes paired with the relevant approval-flow PR |
| `public/app.js` | Confirm API payload ownership before UI work |
| `package-lock.json` | Only the dependency-changing PR should edit it |
| Ops docs | The behavior-changing PR updates the docs it affects |

## Handoff format

Use this in Slack or the PR:

```text
Owner:
Branch:
Scope completed:
Files changed:
Validation run:
Known follow-ups:
Production/external actions performed:
```

