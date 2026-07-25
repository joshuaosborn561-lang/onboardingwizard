# Client Onboarding Automation

Internal service that turns a client website URL into warmed Smartlead inboxes.

## Operating policy (must-read)

- **SOP:** [`ONBOARDING_SOP.md`](./ONBOARDING_SOP.md)
- **Never spend without explicit approval** (`approved=true` at approval gates).
- **No ad-hoc test email sends** as part of onboarding automation.
- **Warmup is Smartlead-only** (InboxKit warmup stays disabled).

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
| `PUBLIC_BASE_URL` | Public HTTPS URL for InboxKit webhooks |

Optional: registrant contact fields, warmup tuning.

## API

```http
POST /api/onboarding
{ "websiteUrl": "https://acme.com", "inboxCount": 12, "googleRatio": 0.67 }

GET  /api/jobs/:id

POST /api/jobs/:id/answers
{ "porkbunApiKey": "...", "porkbunSecretApiKey": "..." }
# or
{ "inboxkitWorkspaceId": "ws_..." }
# or (approval gates)
{ "approved": true, "domains": ["tryacme.info", "goacme.info"], "inboxCount": 8, "googleRatio": 0.67 }
{ "approved": true } # mailbox plan / smartlead load / porkbun funds gates

POST /webhooks/inboxkit
```

## Railway

Deploy as a web service alongside your other internal tools. Set the secrets above, and set `PUBLIC_BASE_URL` to the Railway public domain (e.g. `https://client-onboarding-automation.up.railway.app`). Persist `./data` with a volume if you want job history across redeploys.
