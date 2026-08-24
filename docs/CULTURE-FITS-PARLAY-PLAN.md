# Culture Fits + Parlay — proposed send plan

**Status:** proposal + cost estimate only. No jobs created. No domains registered. No mailboxes bought. No Smartlead load. No credits used.

## Locked decisions

| Rule | Value |
|---|---|
| Senders per domain | **2 max** |
| Provider split | **65% Microsoft / 35% Google** (`googleRatio = 0.35`) |
| Volume | **50 inboxes total per client** (buy only the gap: `50 − current`) |
| Usernames | `first.last`, letters only, no digits |
| Signature | `First Last` then company name |
| Warmup | Smartlead only — do **not** buy InboxKit warmup |
| Test emails | none |

## Client identity

| Client | Website / forward-to | Signature company | Smartlead client |
|---|---|---|---|
| Culture Fits | https://culture-fits.com | Culture Fits | Culture Fits |
| Parlay | https://parlaytech.net | Parlay | Parlay |

Parlay sending domains keep the short root `parlay` (`tryparlay.info`, not `tryparlaytech.info`). Every Parlay domain forwards to `https://parlaytech.net`.

Culture Fits brand root: `culturefits`. Every Culture Fits domain forwards to `https://culture-fits.com`.

## Volume

**50 is the cap.** Assumed current inventory: **30 each**. Buy only the gap.

| Client | Current (assumed) | Target | New mailboxes | New domains | New Google | New Microsoft |
|---|---|---|---|---|---|---|
| Culture Fits | 30 | 50 | **20** | 10 | 8 (4 domains) | 12 (6 domains) |
| Parlay | 30 | 50 | **20** | 10 | 8 (4 domains) | 12 (6 domains) |
| **Total to buy** | | | **40** | **20** | **16** | **24** |

New-batch split is 40% Google / 60% Microsoft — closest even-domain fit to 35/65 on 10 domains. Existing 30 are left as-is; we do not buy replacements for them.

Do not buy past 50 total per client.

---

## Cost estimate (do not spend)

Published list prices as of Aug 2026. Live Porkbun/InboxKit quotes can move. This is **not** an approval to buy.

### Assumptions

- Porkbun `.info`: **$3.60 first year** (matches this app’s default and recent Porkbun list). Renewal about **$22.14/year**. New domains are registered with **auto-renew off**.
- InboxKit Google + Microsoft 365 mailboxes: **$2.50/mailbox/mo for both ESPs** (confirm on live account before buy).
- InboxKit warmup add-on: **$3/mailbox/mo** — **not included**. We will not enable it.
- Smartlead: existing account; no extra seat quote here.
- Gemini domain-candidate calls: cents per job; ignored below.
- Azure tenant fee (**$30/tenant/mo**, up to 100 mailboxes/tenant) is **excluded from the base number**. InboxKit lists it separately from M365 mailboxes. If Microsoft seats are provisioned as Azure tenants (one per Microsoft domain), add the Azure line below.

### Cash out if we buy the 20+20 gap now

| Charge | Per client | Both |
|---|---|---|
| Porkbun — 10 / 20 `.info` domains × $3.60 | **~$36** | **~$72** |
| InboxKit — 20 / 40 mailboxes × $2.50 first month | **$50** | **$100** |
| **Total now** | **~$86** | **~$172** |

Existing 30 per client are already paid. This number is **new spend only**.

### Optional Azure adder (only if InboxKit bills Microsoft as Azure)

6 new Microsoft domains × $30/tenant/mo = **$180/client/mo** ($360 both). Do **not** assume this. Confirm at mailbox-plan gate before any Microsoft buy.

### What is not in the estimate

- Premium `.info` names (if a label is taken / premium, we swap before spend)
- Porkbun wallet top-up fees
- Smartlead subscription changes
- InboxKit warmup ($300/mo for 100 boxes — skipped on purpose)

---

## Culture Fits — buy list (20 new)

Forward every domain to `https://culture-fits.com`. Existing 30 stay. These 10 domains / 20 senders bring the client to 50.

**Google (4 domains / 8 senders)**
- tryculturefits.info — James Carter, Emily Brooks
- goculturefits.info — Carlos Garcia, Sofia Rodriguez
- getculturefits.info — Marcus Washington, Aaliyah Banks
- nowculturefits.info — Wei Chen, Mei Park

**Microsoft (6 domains / 12 senders)**
- useculturefits.info — Minh Nguyen, Linh Tran
- proculturefits.info — Omar Hassan, Layla Nasser
- hqculturefits.info — Luca Rossi, Giulia Conti
- winculturefits.info — Dmitri Ivanov, Anya Sokolov
- topculturefits.info — David Hayes, Sarah Reed
- newculturefits.info — Diego Martinez, Camila Lopez

Spare names below are unused unless a buy-list domain is taken.

### Spare Google rows

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| myculturefits.info | Arjun Patel (`arjun.patel`) | Priya Sharma (`priya.sharma`) |
| labculturefits.info | Benjamin Coleman (`benjamin.coleman`) | Olivia Lang (`olivia.lang`) |
| hubculturefits.info | Antonio Perez (`antonio.perez`) | Elena Cruz (`elena.cruz`) |
| boxculturefits.info | Xavier Hudson (`xavier.hudson`) | Zuri Fleming (`zuri.fleming`) |
| keyculturefits.info | Aditya Reddy (`aditya.reddy`) | Diya Nair (`diya.nair`) |

### Spare Microsoft rows

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| runculturefits.info | Isaiah Freeman (`isaiah.freeman`) | Nia Haynes (`nia.haynes`) |
| appculturefits.info | Rohan Singh (`rohan.singh`) | Ananya Gupta (`ananya.gupta`) |
| heyculturefits.info | Duc Hoang (`duc.hoang`) | Trang Vu (`trang.vu`) |
| maxculturefits.info | Yusuf Abbas (`yusuf.abbas`) | Amira Saleh (`amira.saleh`) |
| oneculturefits.info | Matteo Romano (`matteo.romano`) | Francesca Ricci (`francesca.ricci`) |
| allculturefits.info | Viktor Novak (`viktor.novak`) | Irina Kowalski (`irina.kowalski`) |
| tipculturefits.info | Nathan Sloan (`nathan.sloan`) | Rachel Hale (`rachel.hale`) |
| bizculturefits.info | Ricardo Morales (`ricardo.morales`) | Daniela Rivera (`daniela.rivera`) |
| webculturefits.info | Jeremiah Bryant (`jeremiah.bryant`) | Maya Robinson (`maya.robinson`) |
| culturefitsnow.info | Kabir Joshi (`kabir.joshi`) | Kavya Desai (`kavya.desai`) |

---

## Parlay — buy list (20 new)

Forward every domain to `https://parlaytech.net`. Existing 30 stay. These 10 domains / 20 senders bring the client to 50.

**Google (4 domains / 8 senders)**
- tryparlay.info — Michael Bennett, Jessica Walsh
- getparlay.info — Luis Hernandez, Valentina Flores
- nowparlay.info — Andre Jefferson, Imani Booker
- useparlay.info — Kai Tanaka, Hana Suzuki

**Microsoft (6 domains / 12 senders)**
- myparlay.info — Huy Le, Mai Pham
- proparlay.info — Amir Karim, Yasmin Haddad
- hqparlay.info — Enzo Moretti, Chiara Ferrari
- winparlay.info — Nikolas Petrov, Katya Volkov
- topparlay.info — Matthew Palmer, Lauren Griffin
- newparlay.info — Javier Ramirez, Lucia Torres

Spare names below are unused unless a buy-list domain is taken.

### Spare Google rows

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| goparlay.info | Christopher Pratt (`christopher.pratt`) | Amanda Keller (`amanda.keller`) |
| labparlay.info | Fernando Gomez (`fernando.gomez`) | Gabriela Sanchez (`gabriela.sanchez`) |
| hubparlay.info | Kendrick Hawkins (`kendrick.hawkins`) | Tiana Parks (`tiana.parks`) |
| boxparlay.info | Jun Liu (`jun.liu`) | Yuna Kim (`yuna.kim`) |
| keyparlay.info | Nikhil Shah (`nikhil.shah`) | Neha Chopra (`neha.chopra`) |

### Spare Microsoft rows

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| runparlay.info | Darius Mosley (`darius.mosley`) | Jasmine Porter (`jasmine.porter`) |
| apparlay.info | Vikram Kumar (`vikram.kumar`) | Isha Mehta (`isha.mehta`) |
| heyparlay.info | Tuan Bui (`tuan.bui`) | Ngoc Dang (`ngoc.dang`) |
| maxparlay.info | Karim Mansour (`karim.mansour`) | Leila Khalil (`leila.khalil`) |
| oneparlay.info | Giovanni Esposito (`giovanni.esposito`) | Bianca Costa (`bianca.costa`) |
| allparlay.info | Sergei Morozov (`sergei.morozov`) | Natasha Nowak (`natasha.nowak`) |
| tipparlay.info | Andrew Boone (`andrew.boone`) | Megan Vance (`megan.vance`) |
| bizparlay.info | Alejandro Diaz (`alejandro.diaz`) | Mariana Ortiz (`mariana.ortiz`) |
| webparlay.info | Elijah Grant (`elijah.grant`) | Naomi Walker (`naomi.walker`) |
| parlaynow.info | Sanjay Rao (`sanjay.rao`) | Sanya Iyer (`sanya.iyer`) |

First names and last names are unique across **both** clients.

---

## Execution waves (after you approve spend)

Gap is only 20 per client, so two waves:

| Wave | Per client | After wave | Mix |
|---|---|---|---|
| 1 | 4 domains / 8 senders | 38 total | 2 Google + 2 Microsoft domains |
| 2 | +6 domains / +12 senders | **50 total** | 2 Google + 4 Microsoft domains |

**Wave 1 domains**
- Culture Fits: `tryculturefits.info`, `goculturefits.info`, `useculturefits.info`, `proculturefits.info`
- Parlay: `tryparlay.info`, `getparlay.info`, `myparlay.info`, `proparlay.info`

**Wave 1 go / no-go before Wave 2 spend**
- All 16 Wave 1 mailboxes active in InboxKit
- All 16 loaded in Smartlead with warmup `ACTIVE`
- Microsoft admin consent completed for each new Microsoft tenant
- No InboxKit warmup
- No test sends

---

## What I will do after you approve execution

1. Create two onboarding jobs (Gemini credits start here).
2. Check the proposed `.info` names on Porkbun (availability + live price) and swap any taken/premium names.
3. Pause at domain spend gate — register **only** after you confirm live prices.
4. Pause at mailbox spend gate — buy **only** after you confirm this list and whether Azure applies.
5. Pause at Smartlead load gate — load + Smartlead warmup **only** after you confirm.
6. Isolate each client in its own Smartlead workspace.

I will not rotate API keys. I will not enable InboxKit warmup. I will not send test email.

## What I need from you to start spending

Reply **approve Culture Fits + Parlay** and say **Wave 1 only** or **all waves after each spend gate**.
