---
name: smartlead-client
description: Create and assign Smartlead client workspaces during onboarding. Use when creating a Smartlead client, client/save 500s, naming a client workspace, or assigning mailboxes to a client. Login emails are unique variants of joshosb1996@gmail.com.
---

# Smartlead client workspaces

Smartlead **clients** are person workspaces (Randy Haba, Corey Tapper, Roger Nutter), not company names. The company (`Nutter Group`) is only the signature line.

## Intake

The onboarding UI and `POST /api/onboarding` take both:

| Field | Example | Used for |
|---|---|---|
| `clientName` | Roger Nutter | Smartlead workspace name + UI/Slack label |
| `companyName` | Nutter Group | Signature (`First Last` / `Company`) |

Never create the workspace as the company name when a person name is known.

## Create (`POST client/save`)

1. Reuse an existing client if the name already matches `clientName` or `companyName`.
2. Otherwise create with:
   - `name`: the person (`Roger Nutter`)
   - `email`: a unique variant of `joshosb1996@gmail.com` (or `SMARTLEAD_CLIENT_EMAIL`)
   - `password`: **required**. Omitting it returns an HTML **500** (Sequelize insert), not 403.
3. Parse `clientId` from the 201 body (`{ ok, clientId, name, email }`).
4. Do not use `REGISTRANT_EMAIL` — it is already client Corey Tapper and 500s as a duplicate.

Email helper: `uniqueClientLoginEmail('joshosb1996@gmail.com', 'Roger Nutter')` → `joshosb1996rogernutter@gmail.com`. Keep the local-part unique across existing clients.

## Assign mailboxes

After create, `POST /email-accounts/{id}` with `{ client_id }` for every loaded account. Rate-limit with a short delay; retry 429s.

## Do not fail the job

If create still 500s / 401 / 403 / "already exists", skip the workspace and leave accounts warming on the main Smartlead account. Mailboxes already loaded matter more than the client folder.

## Nutter Group (done)

- Person: **Roger Nutter**
- Company: Nutter Group
- Smartlead client id **566991**
- Login: `joshosb1996nutterg@gmail.com`
- 50 mailboxes assigned

## Spend

Creating a Smartlead client is not a Porkbun/InboxKit spend. Do not register domains or buy mailboxes as part of this step.
