# Childbook Studio — Plan

Status legend: [ ] todo · [~] in progress · [x] done

## Architecture (current)

Monorepo split into a web frontend + a Firebase backend:

```
childbooks/
├── books-frontend/   Next.js (App Router) web app → Firebase App Hosting
├── functions/        Firebase Functions (2nd gen): the `api` function holds all
│                     secrets, proxies OpenAI/Gemini, runs Lulu fulfillment
└── firebase.json …   infra-as-code: emulators, Firestore/Storage rules, indexes
```

- Marketing (`/`) is SSR for SEO; the studio (`/studio`) is a client-only island.
- No API keys in the browser — all provider/Lulu traffic goes through the backend.
- Dev uses the Firebase emulator (persistent data via import/export); prod is a
  single Firebase project. Secrets: Secret Manager (prod) / `.env.local` (dev).

### Phase 1 — Backend split + Next.js migration  [x]
- [x] Monorepo workspaces (`books-frontend`, `functions`) + Firebase infra files
- [x] Backend `api` function: `/proxy/openai`, `/proxy/google`, `/providers`, `/lulu/*`
- [x] Secrets moved server-side (OpenAI / Gemini / Lulu); ADC for Firebase Admin
- [x] Removed Tauri + Vite; Next.js App Router; provider keys out of the client
- [x] dev(emulator)/prod env wiring; rules locked to backend-only access
- [x] Verified: both build green; emulator + dev server boot; proxy injects keys

### Phase 2 — In progress  [~]
- [x] Firebase Auth — client wiring: `getFirebaseAuth()` + emulator connect,
      `authStore` (email, Google, anonymous, sign-out), `AuthDialog`/`AuthMenu` in
      the studio top bar. Guest-first: auto anonymous sign-in so a token always
      exists. Verified email/anon flows against the Auth emulator.
- [x] Backend ID-token enforcement — client sends the token in `X-Auth-Token`;
      `attachUser` verifies it (Admin SDK), `requireAuth` guards `/proxy/*` and
      `/lulu/*` (401 without/invalid token); `/health` + `/providers` stay open.
      Verified against Auth+Functions emulators.
- [x] Migrate project/settings persistence from IndexedDB → Firestore (per-user;
      blobs → Firebase Storage). `storage-firebase.ts` implements the storage
      port: KV → `users/{uid}/store/{key}` (JSON-string field, so nested arrays
      survive); blobs → `users/{uid}/blobs/{id}`. Studio reloads on uid change.
      Old IndexedDB adapter + `idb` dep removed. Verified round-trips + isolation.
- [x] Per-user Firestore/Storage security rules — `users/{uid}/**` readable/
      writable only by that uid; everything else denied. Verified cross-user
      reads/writes are rejected against the emulators.
- [~] Move generation orchestration into a Functions job queue (Firestore job
      doc + real-time progress). Decided: Firestore-triggered worker (not Cloud
      Tasks) for v1; full scope (incl. mask/surgical) is the target.
      - [x] Decouple core providers from `platform/http` via injectable HTTP
            context (`httpContext.ts`); frontend binds to the proxy, backend to
            upstream. Prereq for any server-side generation.
      - [x] Backend job engine: `onGenerationJob` Firestore trigger processes a
            batch of image-render tasks (download refs from the user's Storage,
            call the provider with the server key, optional `sharp` composite,
            upload result, live progress on the job doc). Mask/composite ported
            to `sharp` (`imaging.ts`). Job model shared in `core/jobs/types.ts`.
            Verified: imaging unit test + full job lifecycle on the emulator.
      - [x] Client: enqueue jobs + subscribe + apply results to version trees.
            `platform/jobs.ts` (create/subscribe/per-project subscribe), `ai.ts`
            task assembly + result application. Bulk "Generate all pages" runs
            through the queue (server-side, survives refresh).
      - [x] Job progress + reconcile-on-reopen. `jobsStore` subscribes to the
            open project's jobs (`projectId` on the job doc), shows a TopBar
            progress pill (`JobProgress`), and is the single applier of results:
            it reconciles done tasks into the version trees idempotently (skips
            blobs already present), so work that finished while the studio was
            closed appears on reopen. `generateAllPages` now only drives the
            per-spread spinners. Unit listing moved to `state/bookUnits.ts`.
            Build + typecheck green. Next: route the bulk-anchors path too.
      - [x] Move the full pipeline server-side, reusing core.
            - [x] Stage A: extracted illustration orchestration into
                  platform-agnostic core (`core/pipeline/illustrationRun.ts` +
                  `provenance.ts`) — whole-page, edits, mask inpaint, and
                  surgical in-place refresh, with prompt/reference assembly,
                  compositing and version-tree bookkeeping. All side effects
                  (blob IO, compositing, models, keys) injected via `PipelineEnv`
                  so the same code runs on the client and in the worker. Client
                  rewired onto it (`clientPipelineEnv`) at zero behavior change;
                  build green.
            - [x] Stage B: worker runs the full illustration pipeline via the
                  shared core. Decision (interactive stays inline; bulk/long runs
                  server-side): split `renderIllustration` (heavy work → stored
                  blob + provenance) from the pure `applyIllustrationRender`
                  (folds into the version tree). New `refresh` job kind carries a
                  project snapshot + resolved models; `onGenerationJob` dispatches
                  image vs. refresh, the worker renders each stale spread with a
                  backend `PipelineEnv` (Admin Storage + `sharp`), and the client
                  folds results in on reconcile (single writer). A "Update N stale
                  pages" sidebar action enqueues it. Unit listing moved to
                  `core/book/units.ts`. Build + typecheck + bundle green;
                  live emulator run (needs provider keys) is the remaining check.
            - [x] Stage C: anchor image generation server-side. Extracted the
                  anchor orchestration into platform-agnostic core
                  (`core/pipeline/anchorRun.ts` = `renderAnchor` +
                  `applyAnchorRender`) and the relationship graph into
                  `core/book/anchorGraph.ts` (contained/related/linked +
                  `orderAnchorsByDependency`). Client `generateAnchorVersion`
                  rewired onto it (interactive stays inline). New `anchors` job
                  kind carries a project snapshot + resolved models; the worker
                  renders in dependency layers, folding each render into its
                  in-memory snapshot so a contained anchor (e.g. a bed) is ready
                  before the anchor that references it (the room). Bulk "Generate
                  all" enqueues one anchors job, tracks progress for the
                  per-anchor spinners, and waits for the jobs store to reconcile
                  renders into the version trees before page generation proceeds.
                  Build + typecheck + bundle green; live emulator run (needs keys)
                  shared with Stage B.
            - [x] Stage D: analysis / anchor-description / screenplay text steps —
                  decision: **stay inline** (no queue). They're interactive
                  single-shot text calls (seconds), already keyless on the client
                  (the proxy injects keys), and their pipelines already live in
                  platform-agnostic core (`core/pipeline/analysis.ts`,
                  `screenplay.ts`, `anchors.ts`) with zero platform/state
                  coupling — so they're worker-ready if ever needed, but queuing
                  would only add Firestore round-trips + reconcile complexity for
                  no durability/security/timeout gain and there's no batch
                  fan-out. Pipeline migration is complete: bulk image work
                  (pages, stale-refresh, anchors) runs server-side via the job
                  queue; interactive single-item ops + text stay inline on the
                  shared core.
- [x] Public shared-book preview pages (SSR + OG tags). "Share" in the studio
      toolbar rasterizes every finished page (the export render path) to PNGs,
      uploads them to world-readable Storage (`public/books/{shareId}/…`), and
      writes a self-contained `publishedBooks/{shareId}` doc (public read, owner
      write — see `firestore.rules`). The dynamic route `app/book/[shareId]`
      reads it server-side (`server/publishedBook.ts`, client SDK in Node →
      emulator in dev, live in prod), emits OpenGraph/Twitter meta from the title
      + summary + cover, and renders a crawlable gallery with a "Make your own"
      CTA. Re-publish overwrites the same stable id.
- [x] Wire the fulfillment/checkout UI to the backend `/lulu/*` endpoints.
      "Order print" opens a checkout dialog (`ui/checkout/OrderDialog.tsx`) that
      uses the backend-backed `createFulfillment()` adapter: shows the chosen
      product, captures recipient/address + copies + shipping, and fetches a live
      price/shipping quote (`/lulu/quote`) as inputs change. Placing an order
      fetches the wraparound cover size (`/lulu/cover-dimensions`), renders the
      print files via `OrderAssetRunner` (full-bleed interior PDF + a composed
      back|spine|front cover, see `core/fulfillment/coverLayout.ts`), assembles
      the draft with `buildOrderDraft`, and submits via `/lulu/order`, showing the
      returned order id/stage. NOTE: print-file specs (bleed/spine/page-count
      minimums) follow the still-`verified:false` product catalog and need a Lulu
      product-sheet proof + sandbox order before going live.

### Phase 3 — Admin, configurable models, server-side AI, cost tracking  [~]

Goal: an admin-only dashboard (admin status set in the Firebase console) that
configures the app; all AI execution moves server-side; usage/cost is captured.

- Admin identity: source of truth is a Firestore `admins/{uid}` doc (set in the
  console). `requireAdmin` (backend) reads it via the Admin SDK and guards every
  admin write. `authStore.isAdmin` is a cosmetic UI gate only.
- Global config (public read, backend-only write): `appConfig/models`,
  `appConfig/artStyles`, `appConfig/modelCosts`. Read live on the client via
  `appConfigStore`; written only through `/admin/*` backend routes.
- Model config (2-stage, `core/config/modelConfig.ts` + `core/ai/actions.ts`):
  Stage 1 = per-provider speed slots (text: ultrafast/fast/slow, image:
  fast/slow), each a concrete model id. Stage 2 = bind each LLM action to a slot
  (text actions → text slots, image actions → image slots). Adding an action =
  one entry in the action registry + a default binding.
- Server-authoritative resolution: the server resolves `action → model` from
  `appConfig/models` for both the sync AI endpoints and the worker; jobs carry
  the action id, never a client-chosen model.
- Server-side AI execution: new sync `/ai/*` endpoints run the existing
  platform-agnostic pipelines server-side and return the render/result for the
  client to fold into its version trees. The job queue stays for bulk work.
- Art-style examples: admin uploads per-style images to `public/artStyles/...`;
  the setup wizard shows them when present (gradient swatch fallback).
- Cost tracking: providers capture token `usage`; a server `recordUsage()`
  (called from the AI endpoints + worker) prices it via `appConfig/modelCosts`
  (granular per-model components + tiers) and writes `users/{uid}/usage/{id}`
  line items + `usageAggregates/{period}`.
  Quotas + Stripe billing are deferred; only capture lands now.

---

## Feature history (studio capabilities — all implemented)

- Foundation, dynamic model registry, setup wizard
- Analysis, References (anchors) with versioning
- Screenplay with printability + book sketch
- Generate (illustrations) with ordered reference images + add/remove + edit
- Phase 0: stage renames (Generate Pages / Final Design; Characters & Places)
- Phase 1: reference reliability + per-illustration provenance
- Phase 2: localized edits (prompt-locking, mask inpainting)
- Phase 3: covers & spine from screenplay
- Phase 4: per-page text mode (in-image / overlay)
- Phase 5: propagate reference changes (stale detection + update)
- Phase 6: typography (~36 fonts, picker, age-based sizing)
- Phase 7: Final Design editor core (normalized design layer, page stage)
- Phase 8: editing toolset (drag/resize/rotate, text-box designs, rich text)
- Phase 9: color system (RGBA picker, canvas pipette)
- Phase 10: procedural SVG pattern engine
- Phase 11: review polish + PDF export
