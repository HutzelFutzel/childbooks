# Studio Guide dual-flow implementation

Status: accepted for implementation.

This plan turns the product behavior in:

- `new studio guide doc.md`;
- `STUDIO-GUIDE-FLOW-DESIGN.md`;
- `STUDIO-GUIDE-CHAT-WIDGETS.md`;
- `GUIDE-EXTRACTION.md`;
- `STUDIO-GUIDE-UI-STATES.drawio`;
- `STUDIO-GUIDE-USER-FLOWS.drawio`;

into an additive migration beside the existing Steps studio. It does not replace
the Steps presentation while the new Chat presentation is being built.

`LEGACY-GUIDE.md` remains the retirement ledger. This document owns implementation
order and architecture decisions; it does not redefine product requirements.

## Non-negotiable boundaries

1. `Project` and durable jobs are the source of truth for both presentations.
2. Steps and Chat branch only at the project workspace presentation boundary.
3. Both presentations use the same persistence, version trees, staleness,
   generation, Sparks settlement, artifact editors, print preflight and checkout.
4. Model output may write only registered fact slots through `applyGuidePatch`.
5. Uploads, reviews, generation starts, payment and completion are typed trusted
   actions.
6. Persisted additions are optional and normalized for old projects.
7. Chat targets, opens and summarizes existing editors; it does not clone them.
8. No Steps-only implementation is removed during feature construction.

## Architecture decisions

### ADR-1 — Dual presentation, shared application

The existing Steps flow and new Chat flow are separate presentation adapters over
one application and domain model. Neither presentation imports the other's private
components or session state.

Customers are assigned one flow through the existing rollout resolver. Only admins
may switch manually during the migration. Rollout `off` is the immediate rollback.
Opening a book in both flows keeps the existing `mixed` attribution.

### ADR-2 — First look is a distinct product action

A first look is not a cropped or relabelled internal reference. It has its own image
action, artifact version, durable job, quote, price attribution and settlement.
Keeping a first look never starts paid generation. Internal references required by
page generation are units in the later Draw-the-book quote, not a separate
user-facing action.

### ADR-3 — Primary cursor plus durable background tracks

The Guide has one primary conversational cursor and zero or more background tracks
derived from project/job state. First-look setup is primary until its job is queued;
story work then becomes primary while first-look progress remains a background
track. No cursor is persisted.

### ADR-4 — One canonical authoring policy

The project stores per-artifact ownership and one review cadence. The visible
involvement preset is derived from that policy and is not stored separately.
`Make it with me` is the default. A manual artifact edit promotes only that
artifact to assisted ownership, prospectively.

### ADR-5 — Version-scoped reviews

Story, subject-look, page-plan and final-page reviews name the artifact version
they reviewed. A changed version naturally becomes unresolved. With non-blocking
cadence, continuing after seeing a first look records an implicit review; with
every-step cadence, explicit Keep is required.

`Recreate later` stays visible but does not block page generation when the paid
action explicitly names the current look that pages will use. A recurring subject
whose look has never been reviewed remains a hard stop.

### ADR-6 — Style is saved before generation

Artwork-derived style skips the catalog picker, not confirmation. The derived style
must be confirmed and saved before any image job starts. Character-free books pick
style before creating a setting, object or style sample.

### ADR-7 — One subject identity

Pre-story subjects evolve the existing story-cast identity rather than introducing
a Guide-only person type. Analysis reconciles anchors by stable subject id first and
normalized name only as a migration fallback. Unmatched provisional subjects remain
visible.

### ADR-8 — Photo lifetime

A likeness photo remains available only for already-authorized likeness work that
still requires it and never beyond the configured hard expiry. It is deleted sooner
when that work succeeds or the reader chooses Delete now.

### ADR-9 — Stable, idempotent generation quotes

Every billable action starts from a backend quote naming exact units, maximum charge,
configuration revision, balance before/after and expiry. Enqueue uses a quote id and
idempotency key. Settlement charges successful usable units only and releases failed,
moderated or cancelled units. A retry requires a new disclosed quote.

### ADR-10 — Code/configuration boundary

Code owns schemas, writers, dependencies, satisfaction, checkpoint classes and
closed-world enforcement. Configuration owns rollout, playlist order, wording,
model binding and parameters, confidence/evidence policy, per-slot kill switches,
examples, recommendation metadata and pricing.

### ADR-11 — Book pane and composer well

Chat is a fixed column on the left. The book pane fills the right and always
shows the book: Cover, Style, Story, Cast, and Pages, each only once that part exists.
Selectors render in the composer well. The transcript stores prose and receipts.
The story is directly editable on the book pane. The page canvas is the only
focus mode, and it hides the transcript when the pane would drop under about
960px. Configured copy, not a model round-trip, speaks the known beats. The
guide's right pane is the book pane, not the bare step workspace.

## Delivery slices

### Slice 1 — Migration safety

- Preserve the lazy Steps/Chat branch and single mode resolver.
- Add architectural boundary checks.
- Add Steps regression and cross-flow portability fixtures.
- Add backward-compatible authoring, subject, review, provenance and first-look
  contracts with normalizers.

Exit: old, Steps-created, Chat-created and mixed projects normalize and open in
both presentations without conversion or generation restart.

### Slice 2 — Guide domain platform

- Consolidate slots into descriptors containing schema, operations, capture,
  writer, description, prompt examples, choices and default policy.
- Add operation-aware claims and surfaced `unhandled` fragments.
- Add primary/background runtime, checkpoint router, version-scoped reviews,
  provenance, grouped impact planning and one speech arbiter.
- Remove Chat's automatic guided-brief write and correct visual-first dependencies.

Exit: deterministic invariants prove ordering, claims, checkpoints, impact and
speech across synthesized books.

### Slice 3 — Reusable widget platform

- Split the Guide shell, timeline, composer well, and widget renderer. A live
  choice renders in the well. A receipt renders in the transcript. The object
  renders on the book pane.
- Add a serializable widget model with target, state, artifact/job/version
  references and typed trusted actions.
- Add exhaustive renderer and action registries.
- Build shared shell, conversation, generation, recovery and accessibility
  primitives.

Exit: new widget kinds do not require another branch in the monolithic chat
component and no widget owns book truth.

### Slice 4 — First-look vertical

- Add the distinct first-look image action and durable backend job.
- Add unified cast/source intake and shared-photo assignment.
- Add catalog style recommendations and derived-style confirmation.
- Add stable quotes, affordability, idempotent enqueue and successful-unit
  settlement.
- Add durable progress, stale-input checking, result actions in the composer well,
  the portrait on the book pane, and versions.

Exit: a Chat-assigned new book can run durable first looks and the resolved-facts
story draft in parallel, survives refresh, cannot double-charge and still opens
correctly in Steps.

### Slice 5 — Complete book

- Story intake/import/concepts/ownership, resolved-facts auto-start and editable title.
- Cast queue, reviews, summary and internal references included in Draw the book.
- Versioned page plan, visible book plan, combined reference/cover/page quote,
  durable batch progress and targeted recovery.
- Grouped change impact, resume and conflict handling.
- Preflight deep links, flip-through, dedication, account moments, order and ebook.

Exit: all common journeys reach a printable or downloadable book in Chat while
Steps remains operational.

### Slice 6 — Operations and evaluation

- Per-slot policy, configurable copy and extraction limits.
- Guide-turn analysis, dry-run bench, reviewed examples and self-repeat query.
- Scheduled live extraction corpus.
- Separate flow metrics and shadow runtime contradictions.
- Stable project-bucket rollout after admin-only evaluation.

Exit: the comparison has enough clean, attributable data to make a retirement
decision.

## Required verification

- Existing Steps regression journeys run on every shared-domain, editor,
  generation, billing or persistence change.
- Cross-flow tests open the same project in either presentation.
- Offline invariants cover slot descriptors, operations, runtime tracks,
  checkpoint matrices, speech priority, widget commands, quotes, reconciliation,
  provenance and migration.
- Widget-family tests cover loading, empty, success, partial, stale, failed and
  disabled states, including keyboard, screen-reader, focus and reduced motion.
- End-to-end journeys cover fastest gift, imported story, mixed sources,
  siblings/shared photo, character-free books, mid-flow changes, partial failure,
  offline/reload, concurrent edits and crossing between Steps and Chat.

## Retirement rule

Retire one `LEGACY-GUIDE.md` row at a time only when the Guide has parity for that
behavior, assigned cohorts meet the agreed product and reliability metrics, no
unresolved hard-stop defect remains, rollback has survived the observation window,
usage/import scans show the old item is unreachable, and the row's own retirement
condition is satisfied.
