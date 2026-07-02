# Childbook Studio — Frontend (Next.js)

The web app. This used to be a Tauri + Vite desktop app; it is now a **Next.js
(App Router)** web app that is part of a monorepo:

```
childbooks/
├── books-frontend/   ← this app (Next.js, deployed to Firebase App Hosting)
├── functions/        ← backend (Firebase Functions): holds all secrets, proxies
│                       AI providers, runs Lulu fulfillment
└── firebase.json …   ← Firebase infra-as-code (emulators, rules, indexes)
```

- **Marketing/landing** (`/`) is server-rendered for SEO.
- **The studio** (`/studio`) is the interactive editor, mounted client-only.
- **No API keys live in the browser.** All OpenAI / Gemini / Lulu traffic goes
  through the backend, which injects the server-held keys.

## Prerequisites

- **Node.js 20+**
- **Yarn 1 (classic)**
- Run all `yarn` commands **from the repo root** (`childbooks/`) — it is a yarn
  workspace. The Firebase CLI is installed there as a dev dependency.

## Install

```bash
# from the repo root
yarn install
```

## Configure environment

Copy the templates and fill in values (the real `.env*` files are git-ignored):

```bash
cp books-frontend/.env.example books-frontend/.env.local   # public, non-secret
cp functions/.env.example     functions/.env.local         # SECRETS (local only)
```

- `books-frontend/.env.local` — only `NEXT_PUBLIC_*` values (backend URL, public
  Firebase web config). In dev you can leave them blank; the app falls back to
  the local emulator.
- `functions/.env.local` — the real `OPENAI_API_KEY`, `GOOGLE_API_KEY`, the Lulu
  OAuth credentials (`LULU_SANDBOX_CLIENT_KEY`/`LULU_SANDBOX_CLIENT_SECRET` and
  `LULU_LIVE_CLIENT_KEY`/`LULU_LIVE_CLIENT_SECRET`), and `LULU_ENV`. Lulu issues
  separate credentials per environment; the pair matching `LULU_ENV` is used. The
  emulator loads these into `process.env`.

## Run for development

Two terminals (both from the repo root):

```bash
# 1) Backend: builds the functions bundle, starts the emulators
#    (Functions + Firestore + Auth + Storage) with persistent data, and
#    LIVE-RELOADS the functions on every save (esbuild --watch).
yarn dev:backend

# 2) The Next.js dev server (http://localhost:1420)
yarn dev
```

Prefer a single terminal? `yarn dev:all` runs both of the above together.

Emulator data survives restarts (imported/exported to `./.emulator-data`).
The frontend automatically talks to the local **Functions emulator** in
development (no config needed). Generation calls are proxied through it, so the
provider keys you put in `functions/.env.local` are used — never shipped to the
browser.

> `yarn dev:backend` is just `yarn workspace functions dev`: it bundles once,
> then runs `esbuild --watch` alongside `firebase emulators:start`. Editing
> anything under `functions/src` (or the shared `books-frontend/src/core`
> modules it imports) rebuilds `lib/index.js`, and the emulator hot-reloads it.
> Need the emulators without the watcher? `yarn emulators`.

## Build

```bash
yarn build            # builds functions (esbuild) + web (next build)
yarn build:web        # just the web app
yarn build:functions  # just the backend bundle
```

## Deploy

- **Frontend** → Firebase **App Hosting** (SSR on Cloud Run). Create a backend
  in the Firebase console pointing at this `books-frontend/` directory; config
  lives in `books-frontend/apphosting.yaml`. Set `NEXT_PUBLIC_BACKEND_URL` there
  to the deployed `api` function URL.
- **Backend functions + rules** → from the repo root:

```bash
firebase functions:secrets:set OPENAI_API_KEY      # one-time, per secret
firebase functions:secrets:set GOOGLE_API_KEY
firebase functions:secrets:set LULU_SANDBOX_CLIENT_KEY
firebase functions:secrets:set LULU_SANDBOX_CLIENT_SECRET
firebase functions:secrets:set LULU_LIVE_CLIENT_KEY
firebase functions:secrets:set LULU_LIVE_CLIENT_SECRET
yarn deploy:functions
yarn deploy:rules
```

## Accounts & data (Auth + Firestore)

The studio is **guest-first**: on load it signs you in anonymously so there is
always an identity, and you can upgrade to email/password or Google from the
top-bar **Sign in** menu. Signing out drops back to a fresh guest.

- The backend `api` function **requires** a valid Firebase ID token on
  `/proxy/*` and `/print/*` (sent in the `X-Auth-Token` header, verified with the
  Admin SDK). `/health` and `/providers` stay open.
- Persistence is **per-user**: project/settings JSON lives in Firestore under
  `users/{uid}/store/{key}`, and generated image blobs in Firebase Storage under
  `users/{uid}/blobs/{id}`. Security rules restrict each path to its owner.

In **development** everything points at the emulators automatically — no extra
config. Two production prerequisites are easy to miss:

1. **Enable Anonymous sign-in** (Firebase console → Authentication → Sign-in
   method), plus any providers you offer (Email/Password, Google). Without
   Anonymous, guest-first sign-in fails and the app can't reach the backend.
2. **Configure CORS on the Storage bucket** so the browser can download blobs
   (`getBlob`) from your App Hosting origin. Use the SAME bucket as
   `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` — for this project that's the modern
   `<project>.firebasestorage.app` bucket, NOT the legacy `<project>.appspot.com`
   one. Applying CORS to the wrong bucket leaves blobs unreadable (the version
   node appears but the thumbnail/canvas stays empty):

   ```bash
   # cors.json lives at the repo root; list every origin the app is served from.
   gcloud storage buckets update gs://childbook-60f89.firebasestorage.app \
     --cors-file=cors.json
   ```

## Where do I put the Firebase private key?

**Short answer: you almost certainly don't need one — don't download it.**

| Environment | What authenticates Firebase Admin | Private key? |
| --- | --- | --- |
| Local dev (emulator) | the emulators — no credentials at all | **No** |
| Deployed (Functions / App Hosting) | Application Default Credentials = the runtime service account | **No** |

The old desktop build inlined a service-account key into the bundle because it
had no server. That is gone: the backend now uses **ADC**, so no key file is
required and the `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` variables are
no longer used.

**The only time you'd use a downloaded key** is running the Admin SDK on your
machine against the **real cloud project** (not the emulator) — e.g. a one-off
script. In that case, prefer:

```bash
gcloud auth application-default login    # sets up ADC locally, no key file
```

If you must use a JSON key instead, keep the file **outside the repo** (or in a
git-ignored location) and point Google's standard ADC variable at it in
`functions/.env.local`:

```bash
# functions/.env.local  (git-ignored — NEVER commit the key or this path)
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/outside/repo/serviceAccount.json
```

Then `initializeApp()` in the backend picks it up automatically. Do **not** put
the key anywhere under `books-frontend/` or in any `NEXT_PUBLIC_*` variable —
that would ship admin credentials to the browser.

## What changed from the desktop app

- Removed Tauri (`src-tauri/`, `@tauri-apps/*`) and Vite; added Next.js.
- `src/core/**` is unchanged pure domain logic (shared with the backend, which
  bundles the Lulu/config modules it needs).
- `src/platform/*` now targets the web + backend instead of Tauri:
  `http.ts` → backend proxy, `fulfillment.ts` → backend adapter, `storage.ts` →
  Firebase (Firestore + Storage), scoped to the signed-in user.
- API keys moved out of local settings; the Settings panel now shows which
  providers the **server** is configured for.

> Remaining Phase 2 work: move generation orchestration into a backend job queue
> (Firestore job doc + Cloud Tasks fan-out + real-time progress), public shared
> book preview pages (SSR + OG tags), and wiring the checkout UI to `/print/*`.
