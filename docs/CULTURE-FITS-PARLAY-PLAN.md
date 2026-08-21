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

**50 is the cap, not the order size.** New buy = `50 − how many they already have`.

Checked in the onboarding app (2026-08-21): **no Culture Fits or Parlay jobs**. Existing completed jobs are Cornerstone (90), Vasco (80), Roofs by Peterson (80). So in *this* system both clients are at **0**.

If they already have senders in InboxKit/Smartlead outside this app, subtract those before buying. I still need a live InboxKit/Smartlead count to lock the gap.

| Client | Current (this app) | Target | New mailboxes | New domains (2/domain) |
|---|---|---|---|---|
| Culture Fits | 0 (unconfirmed outside this app) | 50 | **50 − current** | `ceil((50 − current) / 2)` |
| Parlay | 0 (unconfirmed outside this app) | 50 | **50 − current** | `ceil((50 − current) / 2)` |

If current really is 0, we buy 50 each (25 domains each, 9 Google / 16 Microsoft domains, 18/32 senders). That is the **maximum** this plan will ever buy, not an add-on on top of an existing 50.

New Google/Microsoft seats should keep the **overall** client mix at ~35/65 after counting what they already have. If they already have mostly Google, the new batch should tilt harder Microsoft, and the other way around.

The domain/mailbox lists below are the **target roster**. We provision from the top only until the gap is filled. We do not buy past 50 total per client.

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

### Year 1 one-time (domains)

| Item | Qty | Unit | Per client | Both clients |
|---|---|---|---|---|
| `.info` registration | 25 / 50 | $3.60 | **$90** | **$180** |

### Recurring (mailboxes, no Azure, no InboxKit warmup)

| Rate | Per client / mo | Both / mo | Per client / yr | Both / yr |
|---|---|---|---|---|
| $2.50 Google + Microsoft | $125 | $250 | $1,500 | $3,000 |

### Year 1 all-in (domains + first year of mailboxes)

| | Per client | Both clients |
|---|---|---|
| Domains + 12 months at $2.50 | **~$1,590** | **~$3,180** |

**Cash out if current is 0 and we buy the full gap now:** ~$180 Porkbun + ~$250 InboxKit first month = **~$430**.

If they already have `N` mailboxes, buy `50 − N` seats and `ceil((50 − N) / 2)` domains. At $2.50/mailbox and ~$3.60/domain that is:

`(50 − N) × $2.50` + `ceil((50 − N) / 2) × $3.60` per client.

Year 2 domains only hit if someone turns auto-renew back on (25 × $22.14 ≈ $554/client).

### Wave 1 only (prove the stack)

4 domains + 8 mailboxes per client (2 Google + 2 Microsoft domains each):

| Item | Per client | Both |
|---|---|---|
| Domains | ~$14.40 | ~$28.80 |
| Mailboxes @ $2.50 | $20/mo | $40/mo |
| Wave 1 cash out now | **~$34** | **~$69** |

### Optional Azure adder (only if InboxKit bills Microsoft as Azure)

16 Microsoft domains × $30/tenant/mo = **$480/client/mo** ($960 both). Do **not** assume this. Confirm at mailbox-plan gate before any Microsoft buy.

### What is not in the estimate

- Premium `.info` names (if a label is taken / premium, we swap before spend)
- Porkbun wallet top-up fees
- Smartlead subscription changes
- InboxKit warmup ($300/mo for 100 boxes — skipped on purpose)

---

## Culture Fits — target roster (use only as many rows as the gap)

Forward every domain to `https://culture-fits.com`.

### Google (9 domains / 18 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| tryculturefits.info | James Carter (`james.carter`) | Emily Brooks (`emily.brooks`) |
| goculturefits.info | Carlos Garcia (`carlos.garcia`) | Sofia Rodriguez (`sofia.rodriguez`) |
| getculturefits.info | Marcus Washington (`marcus.washington`) | Aaliyah Banks (`aaliyah.banks`) |
| nowculturefits.info | Wei Chen (`wei.chen`) | Mei Park (`mei.park`) |
| myculturefits.info | Arjun Patel (`arjun.patel`) | Priya Sharma (`priya.sharma`) |
| labculturefits.info | Benjamin Coleman (`benjamin.coleman`) | Olivia Lang (`olivia.lang`) |
| hubculturefits.info | Antonio Perez (`antonio.perez`) | Elena Cruz (`elena.cruz`) |
| boxculturefits.info | Xavier Hudson (`xavier.hudson`) | Zuri Fleming (`zuri.fleming`) |
| keyculturefits.info | Aditya Reddy (`aditya.reddy`) | Diya Nair (`diya.nair`) |

### Microsoft (16 domains / 32 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| useculturefits.info | Minh Nguyen (`minh.nguyen`) | Linh Tran (`linh.tran`) |
| proculturefits.info | Omar Hassan (`omar.hassan`) | Layla Nasser (`layla.nasser`) |
| hqculturefits.info | Luca Rossi (`luca.rossi`) | Giulia Conti (`giulia.conti`) |
| winculturefits.info | Dmitri Ivanov (`dmitri.ivanov`) | Anya Sokolov (`anya.sokolov`) |
| topculturefits.info | David Hayes (`david.hayes`) | Sarah Reed (`sarah.reed`) |
| newculturefits.info | Diego Martinez (`diego.martinez`) | Camila Lopez (`camila.lopez`) |
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

## Parlay — target roster (use only as many rows as the gap)

Forward every domain to `https://parlaytech.net`.

### Google (9 domains / 18 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| tryparlay.info | Michael Bennett (`michael.bennett`) | Jessica Walsh (`jessica.walsh`) |
| getparlay.info | Luis Hernandez (`luis.hernandez`) | Valentina Flores (`valentina.flores`) |
| nowparlay.info | Andre Jefferson (`andre.jefferson`) | Imani Booker (`imani.booker`) |
| useparlay.info | Kai Tanaka (`kai.tanaka`) | Hana Suzuki (`hana.suzuki`) |
| goparlay.info | Christopher Pratt (`christopher.pratt`) | Amanda Keller (`amanda.keller`) |
| labparlay.info | Fernando Gomez (`fernando.gomez`) | Gabriela Sanchez (`gabriela.sanchez`) |
| hubparlay.info | Kendrick Hawkins (`kendrick.hawkins`) | Tiana Parks (`tiana.parks`) |
| boxparlay.info | Jun Liu (`jun.liu`) | Yuna Kim (`yuna.kim`) |
| keyparlay.info | Nikhil Shah (`nikhil.shah`) | Neha Chopra (`neha.chopra`) |

### Microsoft (16 domains / 32 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| myparlay.info | Huy Le (`huy.le`) | Mai Pham (`mai.pham`) |
| proparlay.info | Amir Karim (`amir.karim`) | Yasmin Haddad (`yasmin.haddad`) |
| hqparlay.info | Enzo Moretti (`enzo.moretti`) | Chiara Ferrari (`chiara.ferrari`) |
| winparlay.info | Nikolas Petrov (`nikolas.petrov`) | Katya Volkov (`katya.volkov`) |
| topparlay.info | Matthew Palmer (`matthew.palmer`) | Lauren Griffin (`lauren.griffin`) |
| newparlay.info | Javier Ramirez (`javier.ramirez`) | Lucia Torres (`lucia.torres`) |
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

| Wave | Per client | Running total / client | Mix |
|---|---|---|---|
| 1 | 4 domains / 8 senders | 8 | 2 Google + 2 Microsoft domains |
| 2 | +8 domains / +16 senders | 24 | keep ~35/65 |
| 3 | +13 domains / +26 senders | 50 | remaining 5 Google + 8 Microsoft domains |

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
