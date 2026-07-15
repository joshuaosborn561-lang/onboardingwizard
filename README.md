# Client Onboarding Automation

Internal service that turns a client website URL into warmed Smartlead inboxes.

## Pipeline

1. **Ingest** — fetch the client site and extract brand context  
2. **Domain candidates** — Claude generates 20 `.info` domains (`try`/`go`/`win`/… + brand word)  
3. **Porkbun** — you choose the subaccount (API key + secret); available domains are registered  
4. **InboxKit** — create workspace (or paste an existing ID), connect domains via nameservers, order mailboxes (~⅔ Google / ⅓ Microsoft), wait on webhook  
5. **Smartlead** — load each mailbox using InboxKit’s assigned name + signature, enable warmup  
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
| `ANTHROPIC_API_KEY` | Domain generation |
| `INBOXKIT_API_KEY` | Workspaces, nameservers, mailboxes, webhooks |
| `SMARTLEAD_API_KEY` | Accounts, warmup, clients |
| `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` | Status notifications |
| `PUBLIC_BASE_URL` | Public HTTPS URL for InboxKit webhooks |

Optional defaults: `PORKBUN_API_KEY` / `PORKBUN_SECRET_API_KEY` (per-job subaccount answers still preferred), registrant contact fields, warmup tuning.

## API

```http
POST /api/onboarding
{ "websiteUrl": "https://acme.com", "inboxCount": 12, "googleRatio": 0.67 }

GET  /api/jobs/:id

POST /api/jobs/:id/answers
{ "porkbunApiKey": "...", "porkbunSecretApiKey": "..." }
# or
{ "inboxkitWorkspaceId": "ws_..." }

POST /webhooks/inboxkit
```

## Railway

Deploy as a web service alongside your other internal tools. Set the secrets above, and set `PUBLIC_BASE_URL` to the Railway public domain (e.g. `https://client-onboarding-automation.up.railway.app`). Persist `./data` with a volume if you want job history across redeploys.
