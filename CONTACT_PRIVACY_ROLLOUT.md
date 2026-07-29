# Contact form & email privacy — remaining work

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done (code) — **all remaining
items in this file are manual/external, not code.**

## Context

The original problem: the site's contact form, legal texts, and transactional
emails all pointed at (or leaked) a personal email address, which is exactly
what invites spam/abuse. The code side is done — see "What's already done"
below. What's left is entirely outside this repo: mailboxes, DNS, and hosted
legal-doc content that only you can create/edit.

**None of this blocks anything from working.** The app runs correctly without
any of it — see the "why it's still worth doing" note on each item for what you
actually get by doing it.

---

## 1. `[ ]` Create the hidden mailbox + role aliases

**What:** A real, monitored mailbox (e.g. `inbox@childbook.studio`, hosted
wherever you already receive mail for the domain), plus alias/forwarders:
- `legal@childbook.studio`
- `privacy@childbook.studio`
- `support@childbook.studio`
- `dmarc@childbook.studio` (for aggregate/failure reports, see item 3)

All forwarding to the hidden mailbox. Also set up a **send-as identity** for
that mailbox so you can reply *as* `support@`/`legal@` instead of exposing the
hidden address in the `From:` header of a manual reply.

**Why it matters even though nothing breaks without it:**
- `functions/src/contact/routes.ts` sends the visitor an acknowledgement email
  (`contact_form_ack`) whose `Reply-To` defaults to `config.senders.replyTo` —
  currently `hello@childbook.studio` by default
  (`books-frontend/src/core/config/emailConfig.ts`). If a visitor hits "reply,"
  it goes there. Right now that may be nobody, or your personal inbox.
- The hosted imprint/privacy policy (item 4) need *some* real address in them.
  Until this exists, publishing `legal@`/`privacy@` there would just bounce.

**How:**
1. At your mail provider (Google Workspace, Zoho Mail, ProtonMail, etc.),
   create the mailbox and the four forwarding aliases above.
2. Set up the send-as identity for the hidden mailbox (in Gmail:
   Settings → Accounts → "Send mail as").
3. In Admin → Communication → Transactional Emails, update **Support email**
   and **Reply-to** (`books-frontend/src/ui/admin/tabs/communication/EmailTab.tsx`)
   to point at the new hidden mailbox instead of any personal address.

---

## 2. `[ ]` Register an App Check provider (Firebase Console)

**What:** In the Firebase Console → App Check, register a reCAPTCHA
Enterprise (or Cloudflare Turnstile, if you'd rather switch providers) site
key for the web app, then give me the site key to put in
`NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`.

**Why it matters even though nothing breaks without it:** `functions/src/appCheck.ts`
is staged deliberately — without a site key, App Check is inert: every request
verifies as `missing`/`skipped` and is *allowed through* either way. It's the
one bot defense here that a script can't simply wait out (unlike the honeypot
or fill-time check in `functions/src/contact/abuse.ts`), so it's worth turning
on, but the form is still rate-limited and MX/disposable-checked without it.

**How:**
1. Firebase Console → your project → App Check → Apps → register the web app.
2. Choose reCAPTCHA Enterprise (needs a Google Cloud reCAPTCHA key — Console
   walks you through creating one) or Turnstile.
3. Send me the site key. I'll wire it into `apphosting.yaml`
   (`NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`) and, once you've watched the
   `[appCheck]` logs for a day or two and they look right, flip
   `APP_CHECK_ENFORCED=true` in `functions/.env.example` /
   Secret Manager.

---

## 3. `[ ]` DNS hardening: DMARC `rua=`, SOA RNAME, WHOIS privacy

**What:** Three unrelated DNS/registrar settings that currently may leak a
personal address:
- **DMARC `rua=`** — the address aggregate spoofing reports get emailed to.
  Point it at `dmarc@childbook.studio` (see item 1) instead of a personal inbox.
- **SOA RNAME** — the "zone administrator email" field in your domain's SOA
  DNS record. Often defaults to a personal or registrar-provided address.
- **WHOIS privacy** — confirm your registrar has privacy/proxy protection
  enabled on the domain so WHOIS lookups don't show a personal address at all.

**Why it matters even though nothing breaks without it:** None of these affect
the app. They're pure exposure reduction for the original goal ("don't let my
personal email leak anywhere public") — DMARC/SOA/WHOIS are just three other
places an email address can leak besides the ones this codebase controls.

**How:**
1. At your DNS host, edit the `_dmarc.childbook.studio` TXT record's `rua=`
   value to `mailto:dmarc@childbook.studio`.
2. At your DNS host (or registrar, if it manages the zone), edit the SOA
   record's RNAME/admin-email field.
3. At your registrar, confirm WHOIS privacy/proxy is turned on (most
   registrars enable this by default now, but worth a check).

---

## 4. `[ ]` Add `legal@` / `privacy@` to the hosted legal documents

**What:** Add the new alias addresses (once item 1 exists) as plain contact
text in your Imprint/Impressum and Privacy Policy documents.

**Why it matters even though nothing breaks without it:** `firestore.rules`
and `books-frontend/src/core/config/legal.ts` only store a **label + URL** per
legal document — the documents themselves are hosted outside this repo (e.g. a
separate site, Notion, Google Docs). I have no access to edit that content;
this is unavoidably manual. Depending on your jurisdiction, a monitored
contact address in the imprint may also be a legal requirement, not just a
courtesy.

**How:**
1. Open wherever your Imprint and Privacy Policy are actually hosted.
2. Add `legal@childbook.studio` (imprint) and `privacy@childbook.studio`
   (privacy policy) as plain text — not an image, not obfuscated; legal texts
   are expected to be plain and machine-readable.
3. No code change needed — Admin → Legal & Privacy already just links to
   whatever URL is configured.

---

## 5. `[ ]` Decide the git-author-email question

**What:** Decide whether the personal email address in git commit history for
`HutzelFutzel/childbooks` is a problem worth acting on — e.g. is the repo
public, and if so, do you want future commits authored under a different
identity (a "noreply" GitHub address, or an alias)?

**Why it matters even though nothing breaks without it:** Purely about
historical/future exposure via `git log`, unrelated to anything the app does
at runtime. Rewriting history to scrub old commits is a separate, riskier
undertaking (force-push, breaks any existing clones/forks/PRs) that
should only happen with your explicit go-ahead — I won't do this
speculatively.

**How (if you decide to act on it):**
1. Check whether the repo is public: GitHub → repo → Settings → General.
2. If you want new commits to use a different address going forward:
   `git config user.email "you@users.noreply.github.com"` (a free GitHub
   "noreply" address that still credits your account without publishing your
   real one), or set it per-repo/per-account as you prefer.
3. Only rewrite *existing* history (`git filter-repo`, etc.) if you're sure —
   ask me explicitly if/when you want that, since it's destructive.

---

## What's already done (code side, verified working)

- Firestore is the system of record for `/contact` submissions
  (`functions/src/contact/store.ts`); Slack is notified
  (`functions/src/notify.ts`); the submitter gets an acknowledgement email with
  a ticket reference (`contact_form_ack` in `books-frontend/src/core/email/`).
- Abuse controls: distributed rate limiting, MX/disposable-domain checks,
  honeypot + fill-time bot detection (`functions/src/contact/abuse.ts`).
- App Check is wired end-to-end but **staged to log-only** until you complete
  item 2 above (`functions/src/appCheck.ts`).
- `emailConfig` (the admin email settings, including `contactRecipient`) moved
  from the world-readable `appConfig` collection to the admin-only
  `adminSettings` collection, with a one-time migration
  (`functions/src/appConfig.ts`).
- The public site and every transactional email footer link to `/contact`
  instead of printing a raw `mailto:` address
  (`books-frontend/src/core/email/layout.ts`).
- An admin **Contact inbox** tab (Communication → Contact inbox) lists,
  filters, and lets you mark submissions handled
  (`books-frontend/src/ui/admin/tabs/communication/ContactInboxTab.tsx`).
- `ZEPTOMAIL_TOKEN` and `SLACK_WEBHOOK_URL` are already configured (verified in
  `functions/.env.local`) — no new secret is needed for any of the above to
  send.

## Deployment note

Nothing above needs a manual `firebase deploy`. `.github/workflows/deploy.yml`
auto-deploys functions + Firestore rules/indexes + storage rules on every push
to `main`, then promotes the `release` branch (which Firebase App Hosting
auto-builds for the frontend). Merging to `main` is the only "deploy" step.
