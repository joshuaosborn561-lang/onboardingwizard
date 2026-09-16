# SalesGlider Onboarding Slack app

Dedicated Slack app for **in-channel** Block Kit buttons in `#onboarding`.
Pressing **Approve** stays in Slack — no browser tab — and still goes through
the same signed spend-gate path as `GET /api/approve` and
`POST /api/jobs/:id/answers` with `approved: true`.

This does **not** bypass `manualApproval`. There is no auto-approve.

## What the buttons do

| Button | Where | Effect |
|---|---|---|
| **Approve** (gate-specific) | Domain / mailbox / Smartlead / Porkbun funds prompts | Same as today's URL approve → `applySlackApproval` |
| **Retry** | Failed-job alerts | Same as `POST /api/jobs/:id/retry` |
| **Ping InboxKit** | InboxKit-blocked / failed InboxKit steps | Re-sends the stuck nudge to `SLACK_INBOXKIT_CHANNEL_ID` |
| **Resend buttons** | When a job still has a pending approval | Same as `POST /api/jobs/:id/slack-nudge` |

Each button `value` is an HMAC-signed token (72h, same family as
`src/lib/approveToken.ts`). Slack's request signature is verified with
`SLACK_SIGNING_SECRET` before any action runs.

`GET /api/approve?token=…` remains as a browser fallback (also linked under
each approval message).

## Create and install (minutes)

1. Open [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From an app manifest**.
2. Paste [`docs/slack-app-manifest.yaml`](./slack-app-manifest.yaml).
3. Create the app. Confirm **Interactivity** is on and the Request URL is:
   `https://client-onboarding-production-1da8.up.railway.app/api/slack/interactions`
   (or your `PUBLIC_BASE_URL` + `/api/slack/interactions`).
4. **Install to Workspace** → allow `chat:write` and `chat:write.public`.
5. Invite the bot:
   - `/invite @SalesGlider Onboarding` in `#onboarding` (`C0BKJJ5LUAY`)
   - same in `#salesglidergrowth-inboxkit` (`C0ANENNTHL3`) if it should post there
6. Copy credentials (never commit them):
   - **Bot User OAuth Token** → `SLACK_BOT_TOKEN`
   - **Signing Secret** (Basic Information) → `SLACK_SIGNING_SECRET`

Event subscriptions are **not** required for v1. Slash commands are optional and unused.

## Railway env vars after install

Set these on the `client-onboarding` / onboardingwizard service and redeploy:

| Variable | Required | Notes |
|---|---|---|
| `SLACK_BOT_TOKEN` | yes | New `xoxb-` token from this app (replaces the old bot if you are switching) |
| `SLACK_SIGNING_SECRET` | yes | Required for interactive buttons |
| `SLACK_CHANNEL_ID` | yes | `#onboarding` = `C0BKJJ5LUAY` |
| `SLACK_INBOXKIT_CHANNEL_ID` | yes for Ping InboxKit | `#salesglidergrowth-inboxkit` = `C0ANENNTHL3` |
| `PUBLIC_BASE_URL` | yes | `https://client-onboarding-production-1da8.up.railway.app` |
| `SLACK_ACTION_SECRET` | no | HMAC for button tokens; defaults to `SLACK_SIGNING_SECRET`, then `SLACK_BOT_TOKEN` |

Already-used vars (`GEMINI_*`, Porkbun, InboxKit, Smartlead, etc.) stay as they are.

## Verify

1. Slack app settings → Interactivity → the Request URL should show verified.
2. Trigger a job that pauses at a spend gate.
3. In `#onboarding`, press **Approve** — buttons should disappear and the job should advance.
4. If interactivity is misconfigured, use the **approve in browser** fallback under the message.

## Security notes

- Do not commit tokens or signing secrets.
- Button values are signed; `action_id` alone is never trusted.
- Approve still requires a human click and still calls `submitAnswers({ approved: true })`.
- `manualApproval` remains hard-locked to `true` in `src/api/routes.ts` / `src/types.ts`.
