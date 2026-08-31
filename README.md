# Client Onboarding Automation

Internal service that turns a client website URL into warmed Smartlead inboxes.

## Guided web UI

Open the service root URL (for example, the Railway public URL) to use the guided
onboarding wizard. It collects:

- client main website and forwarding destination
- company name used in mailbox signatures
- target inbox count (two per domain max)
- Google/Microsoft provider split

The UI then follows the job through domain selection, paid approval gates,
nameserver setup, mailbox provisioning, Smartlead loading, and warmup. Recent jobs
can be reopened from the sidebar or linked directly with `/?job=<job-id>`.

## Operating policy (must-read)

- **SOP:** [`ONBOARDING_SOP.md`](./ONBOARDING_SOP.md)
- **Max 2 senders per domain** on new jobs.
- **Never spend without explicit approval** (`approved=true` at approval gates).
- **No ad-hoc test email sends** as part of onboarding automation.
- **Warmup is Smartlead-only** (InboxKit warmup stays disabled).
- Proposed Culture Fits + Parlay send plan: [`docs/CULTURE-FITS-PARLAY-PLAN.md`](./docs/CULTURE-FITS-PARLAY-PLAN.md)

## Pipeline

1. **Ingest** — fetch the client site and extract brand context  
2. **Domain candidates** — affix variations of the client's primary domain on `.info` (`try`/`go`/`now`/… + full brand root, e.g. `tryroofsbypeterson.info`)  
3. **Porkbun** — explicit approval gate before domain spend; registers approved domains on your **main** Porkbun account; URL-forwards each domain to the client main site  
4. **InboxKit** — create workspace (or paste an existing ID), connect domains via nameservers, set forwarding, **wait for NS match**, explicit mailbox-order approval gate before wallet spend, then buy mailboxes with unique letter-only usernames (no digits), wait on webhook  
5. **Smartlead** — explicit load approval gate, load each mailbox with matching signature (`First Last` / `Company`), enable warmup via Smartlead API (retries on 429/5xx)  
6. **Smartlead client** — create an isolated client workspace and assign mailboxes  
7. **Slack** — success summary, or immediate failure alerts per step/domain/mailbox  

## Run locally

```bash
cp .env.example .env
# fill credentials
npm install
npm run dev
```

Open http://localhost:8080

## Required secrets

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Domain generation (Gemini Flash) |
| `GEMINI_MODEL` | Optional override (default `gemini-2.5-flash`) |
| `PORKBUN_API_KEY` / `PORKBUN_SECRET_API_KEY` | Main Porkbun account (all clients) |
| `INBOXKIT_API_KEY` | Workspaces, nameservers, mailboxes, webhooks |
| `SMARTLEAD_API_KEY` | Accounts, warmup, clients |
| `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` | Status notifications |
| `SLACK_INBOXKIT_CHANNEL_ID` | Slack Connect channel shared with InboxKit; ping only when *their* mailbox provision or Microsoft export is in-flight > 12h (not approvals, NS waits, or our credential failures) |

In-progress jobs are checked every **30 minutes** (InboxKit mailbox sync, Smartlead load retry). Approval and spend gates are never auto-advanced. InboxKit is messaged only if their work is still in-flight after 12 hours.
| `PUBLIC_BASE_URL` | Public HTTPS URL for InboxKit webhooks |

Optional: registrant contact fields, warmup tuning.

## API

```http
POST /api/onboarding
{ "websiteUrl": "https://acme.com", "inboxCount": 12, "googleRatio": 0.35 }

GET  /api/jobs/:id

POST /api/jobs/:id/answers
{ "porkbunApiKey": "...", "porkbunSecretApiKey": "..." }
# or
{ "inboxkitWorkspaceId": "ws_..." }
# or (approval gates)
{ "approved": true, "domains": ["tryacme.info", "goacme.info"], "inboxCount": 4, "googleRatio": 0.35 }
{ "approved": true } # mailbox plan / smartlead load / porkbun funds gates

POST /webhooks/inboxkit
```

## Railway

Deploy as a web service alongside your other internal tools. Set the secrets above, and set `PUBLIC_BASE_URL` to the Railway public domain (e.g. `https://client-onboarding-automation.up.railway.app`). Persist `./data` with a volume if you want job history across redeploys.
