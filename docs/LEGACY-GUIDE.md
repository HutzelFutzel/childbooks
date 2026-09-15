# Legacy manifest — the guided studio migration

The chat-guided studio is being built beside the existing wizard, not on top of
it. Both ship; a rollout decides which one a reader gets
(`books-frontend/src/core/config/guide.ts`). That is the safe way to do it, and
it has one cost: for as long as the migration runs, some code is only there to
serve readers who are still on the old flow.

This file is the list of that code. It exists because "we'll delete it later"
without a written list is how a codebase ends up with two of everything and
nobody willing to touch either.

**The rule:** anything superseded gets a `@legacy guide-v2` marker in its own
doc comment *and* a row in the Retire table below. `yarn check:guide` fails if
one exists without the other, so the list cannot quietly go stale.

**Reading a row:** *Superseded by* is what a reader gets instead once the
rollout reaches them. *Retire when* is the condition that makes deletion safe —
not a date, because dates in a manifest are wishes.

---

## Keep — shared by both flows

These are **not** legacy. They are the parts the guided studio is built *on*, so
they must not be duplicated, forked or rewritten for it. If a guide feature seems
to need its own copy of one of these, that is the signal to extend the shared
one instead.

| Area | Where | Why it stays |
| --- | --- | --- |
| The book itself | `books-frontend/src/core/types.ts` | `Project` / `BookConfig` are the source of truth for both flows. The guide writes the same book; it does not get a parallel document. |
| Story brief | `books-frontend/src/core/story/brief.ts` | Cast, ages, readiness predicates. What the guide's interpreter produces has to satisfy exactly these, which is what makes a book portable between flows. |
| Persistence | `books-frontend/src/core/storage/repositories.ts`, `books-frontend/src/state/projectsStore.ts` | Per-project documents, `rev`-based optimistic concurrency. The guide gets no second write path. |
| Version trees | `books-frontend/src/core/versioning.ts` | Undo, redo and branching for every artifact. The guide's "go back and change one thing" is this, not a new mechanism. |
| Staleness | `books-frontend/src/core/pipeline/provenance.ts`, `books-frontend/src/state/ai.ts` | What a changed fact invalidates downstream. Already correct; the guide only needs to *report* it conversationally. |
| Generation | `books-frontend/src/ui/studio/studioGen.ts`, `books-frontend/src/ui/studio/useBookGeneration.ts` | The batch actions and the shared "what is missing / stale" model. |
| Jobs | `books-frontend/src/state/jobsStore.ts`, `functions/src/storyRevisionJobs.ts` | Durable server work and result reconciliation. |
| Models & prompts | `books-frontend/src/core/config/modelConfig.ts`, `books-frontend/src/core/prompts/registry.ts`, `books-frontend/src/core/ai/actions.ts` | Slots, bindings and templates. Every guide LLM call goes through an action id like every other call, which is what makes it model-change-proof. |
| Audience | `books-frontend/src/core/config/audience.ts`, `books-frontend/src/core/config/audienceCatalog.ts` | Age bands and every editorial guardrail. |
| Print & pricing | `books-frontend/src/core/print/*`, `books-frontend/src/core/pricing/*` | Untouched by how the book was authored. |
| The rendering surface | `books-frontend/src/ui/studio/BookCanvas.tsx`, `books-frontend/src/ui/studio/BookPreview.tsx`, `books-frontend/src/ui/studio/SpreadEditor.tsx` | The guide *opens* the editor and the flip-through; it does not reimplement them. |

## Retire — superseded, deleted at the end of the migration

| What | Where | Superseded by | Retire when |
| --- | --- | --- | --- |
| Full-page book-setup gate | `books-frontend/src/ui/studio/DesignSetup.tsx` | Shipped size/layout defaults + the docked Setup panel (`books-frontend/src/ui/studio/DockSetupPanel.tsx`). Nothing routes here as of phase 1. | Now unreachable; delete together with the `designSetupOpen` state in `books-frontend/src/ui/studio/StudioContext.tsx`. Safe once no project can still be mid-gate — i.e. after one release, since `designReady` is set on arrival at Pages. |
| The guided-question flow | `books-frontend/src/ui/wizard/GuidedQuestions.tsx` | The chat itself asks the questions. Note: only the *component* is superseded — the `GuidedQuestion` type still describes the story and design topic lists and stays. | The guide owns every question the studio asks (phase 6). |
| Engine → wizard destination bridge | `books-frontend/src/ui/studio/guideRouting.ts` | Nothing — it is scaffolding. It translates the engine's chosen component into a wizard destination so the engine can be exercised against real books before the chat surface exists. | The wizard's destinations are gone (phase 9). The `legacyDestination` field on every component in `books-frontend/src/core/guide/components.ts` goes with it, as does the `chrome` prop on `books-frontend/src/ui/studio/StudioWorkspace.tsx` — the guide passes `"bare"` to suppress the wizard's step rail, and with one flow left there is nothing to choose between. (Not marked: the workspace itself stays. Only the prop goes.) |

## Phases

Phase 0 (foundations), phase 1 (preview-first Pages), phase 2 (the state model:
catalog, playlist, engine, patch), phase 3 (the interpreter: free text in, facts
out) and phase 4 (the surface: chat beside the book, tap-to-answer widgets, and the
artifact pane driven by `component.canvas`) have landed. Phases 5–9
finish the guide; nothing in the Retire table can be deleted before phase 9, and
phase 9 is not done until this table is empty.

Phase 4 is where the two flows become visible at once, so it is worth being explicit
about what it did *not* do: it did not reimplement a single panel. The artifact pane
is `StudioWorkspace` with its step rail suppressed, which is why a book can still be
moved between the flows mid-way. Replacing those panels with conversational
equivalents is phases 5–8, one at a time, and each one is a chance to get this wrong
by forking something in the Keep table above.
