# Culture Fits + Parlay — proposed send plan

**Status:** proposal only. No jobs created. No domains registered. No mailboxes bought. No Smartlead load. No credits used.

Reply with **approve Culture Fits + Parlay** (and confirm the two URLs) before any execution. App spend gates still apply for live Porkbun / InboxKit prices.

## Rules for this plan

| Rule | Value |
|---|---|
| Senders per domain | **2 max** (new global ops rule) |
| Provider split | **65% Microsoft / 35% Google** (`googleRatio = 0.35`) |
| Combined cap | **50 senders total** |
| Usernames | `first.last`, letters only, no digits |
| Signature | `First Last` then company name |
| Warmup | Smartlead only |
| Test emails | none |

If you instead want **50 senders each** (100 total), say so — do not execute this 50-total list.

## Assumed client identity

Confirm or correct before I start:

| Client | Website / forward-to | Signature company | Smartlead client |
|---|---|---|---|
| Culture Fits | https://culture-fits.com | Culture Fits | Culture Fits |
| Parlay | https://goparlay.io | Parlay | Parlay |

Parlay sending domains use the short brand root `parlay` (not `goparlay`) so names stay readable. Forwarding still goes to `https://goparlay.io`.

Culture Fits brand root: `culturefits` from `culture-fits.com`.

## Volume

| Client | Domains | Senders | Google domains | Microsoft domains | Google senders | Microsoft senders |
|---|---|---|---|---|---|---|
| Culture Fits | 13 | 26 | 5 | 8 | 10 | 16 |
| Parlay | 12 | 24 | 4 | 8 | 8 | 16 |
| **Total** | **25** | **50** | **9** | **16** | **18 (36%)** | **32 (64%)** |

64/36 is the closest even-domain split to 65/35 at 2 senders/domain.

---

## Culture Fits — domains and mailboxes

Forward every domain to `https://culture-fits.com`.

### Google (5 domains / 10 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| tryculturefits.info | James Carter (`james.carter`) | Emily Brooks (`emily.brooks`) |
| goculturefits.info | Carlos Garcia (`carlos.garcia`) | Sofia Rodriguez (`sofia.rodriguez`) |
| getculturefits.info | Marcus Washington (`marcus.washington`) | Aaliyah Banks (`aaliyah.banks`) |
| nowculturefits.info | Wei Chen (`wei.chen`) | Mei Park (`mei.park`) |
| myculturefits.info | Arjun Patel (`arjun.patel`) | Priya Sharma (`priya.sharma`) |

### Microsoft (8 domains / 16 senders)

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

---

## Parlay — domains and mailboxes

Forward every domain to `https://goparlay.io`.

### Google (4 domains / 8 senders)

| Domain | Sender 1 | Sender 2 |
|---|---|---|
| tryparlay.info | Michael Bennett (`michael.bennett`) | Jessica Walsh (`jessica.walsh`) |
| getparlay.info | Luis Hernandez (`luis.hernandez`) | Valentina Flores (`valentina.flores`) |
| nowparlay.info | Andre Jefferson (`andre.jefferson`) | Imani Booker (`imani.booker`) |
| useparlay.info | Kai Tanaka (`kai.tanaka`) | Hana Suzuki (`hana.suzuki`) |

### Microsoft (8 domains / 16 senders)

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

First names and last names are unique across **both** clients.

---

## Execution waves (after you approve)

Do not buy all 25 domains on day one. Prove Microsoft consent and warmup first.

| Wave | Client | Domains | Senders | Mix |
|---|---|---|---|---|
| 1a | Culture Fits | try, go, use, pro | 8 | 2 Google + 2 Microsoft |
| 1b | Parlay | try, get, my, pro | 8 | 2 Google + 2 Microsoft |
| 2a | Culture Fits | remaining 9 | +18 → 26 | 3 Google + 6 Microsoft |
| 2b | Parlay | remaining 8 | +16 → 24 | 2 Google + 6 Microsoft |

**Wave 1 go / no-go before Wave 2 spend:**
- All 16 Wave 1 mailboxes active in InboxKit
- All 16 loaded in Smartlead with warmup `ACTIVE`
- Microsoft admin consent completed for each new Microsoft tenant
- No InboxKit warmup
- No test sends

---

## What I will do after you approve

1. Create two onboarding jobs (this uses Gemini credits for domain candidates).
2. Check the proposed `.info` names on Porkbun (availability + live price).
3. Stop and show you any names that are taken, with replacements.
4. Pause at domain spend gate — register **only** after you confirm live prices.
5. Pause at mailbox spend gate — buy **only** after you confirm the plan still matches this list.
6. Pause at Smartlead load gate — load + Smartlead warmup **only** after you confirm.
7. Isolate each client in its own Smartlead workspace.

I will not rotate API keys. I will not enable InboxKit warmup. I will not send test email.

## What I need from you to start

1. Confirm or correct the two websites.
2. Confirm **50 total (26 + 24)** vs **50 each**.
3. Reply **approve Culture Fits + Parlay**.
4. Say whether I may proceed through **Wave 1 only** or through **all waves** after each spend gate.
