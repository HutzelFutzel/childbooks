# Legacy ledger — retiring Steps

The Chat studio (`books-frontend/src/ui/guide/GuideStudio.tsx`) runs beside the
Steps studio (`books-frontend/src/ui/studio/StudioWorkspace.tsx`). The admin
toggle in the studio top bar switches between them, and the rollout in
`appConfig/guide` decides who may. When the team approves Chat, Steps goes.

This file is the deletion plan. It is written so that deleting Steps is a
sequence of mechanical batches, not an investigation.

**How to run a batch**

1. Do the batch's **Before** steps, if it has any. They are the only parts that
   need judgement, and a batch must not start while one is open.
2. Delete every file under **Delete**.
3. Make every edit under **Cut**. These are the only places outside the batch
   that import it.
4. Run the batch's **Verify** command. It must pass before the next batch starts.

Batches run in order. Each batch assumes the earlier ones are gone, and nothing
in a later batch is imported by an earlier one.

**The markers.** Every file under **Delete** carries `@legacy guide-v2 L<n>` in
a doc comment, where `L<n>` is its batch. A file with a legacy *part*, not
legacy as a whole, carries the marker on that part and is listed under **Cut**.
`yarn check:guide` fails if:

- a marker's batch and this ledger disagree;
- a listed file doesn't exist, or is listed for deletion twice;
- a file under **Delete** is imported from anywhere outside the batch, an
  earlier batch, or that batch's **Cut** list.

The last check keeps each batch deletable as written.

---

## Keep — shared by both flows

These are **not** legacy. Chat is built on them, so they must not be duplicated,
forked or rewritten for it. If a Chat feature seems to need its own copy of one
of these, extend the shared one instead.

| Area | Where | Why it stays |
| --- | --- | --- |
| The book itself | `books-frontend/src/core/types.ts` | `Project` and `BookConfig` are the only source of truth. Chat writes the same book. |
| Story brief | `books-frontend/src/core/story/brief.ts` | Cast, ages and readiness predicates. |
| Persistence and merge | `books-frontend/src/state/projectsStore.ts`, `books-frontend/src/core/guide/merge.ts` | `rev`-based saves; Chat adds the three-way merge and one conflict choice on top. |
| Journey | `books-frontend/src/core/guide/journey.ts` | Chat's phase, wells and views, derived from the book and its jobs. |
| Guide engine and catalog | `books-frontend/src/core/guide/engine.ts`, `books-frontend/src/core/guide/components.ts` | The interpreter and `state/chatStudio.ts` read them. Only `legacyDestination` in the catalog is legacy (L5). |
| Generation | `books-frontend/src/ui/studio/studioGen.ts`, `books-frontend/src/ui/studio/useBookGeneration.ts`, `books-frontend/src/state/jobsStore.ts` | Batch actions, durable jobs, reconciliation. |
| Models and prompts | `books-frontend/src/core/config/modelConfig.ts`, `books-frontend/src/core/prompts/registry.ts`, `books-frontend/src/core/ai/actions.ts` | Every Chat call, including `portrait`, goes through an action id. |
| Print and pricing | `books-frontend/src/core/print/preflight.ts`, `books-frontend/src/core/config/sparks.ts` | Unaffected by how the book was made. |
| Studio provider | `books-frontend/src/ui/studio/StudioContext.tsx` | Chat's book pane runs inside it. Only the step fields (L5) and the setup gate (L0) are legacy. |
| Page editor | `books-frontend/src/ui/studio/BookCanvas.tsx`, `books-frontend/src/ui/studio/SpreadEditor.tsx`, `books-frontend/src/ui/studio/studioPanelStore.ts` | Page focus opens it with `autoPreview={false}`. |
| Flip-through | `books-frontend/src/ui/studio/BookPreview.tsx`, `books-frontend/src/ui/studio/spreadModel.ts` | Cover and Pages views render `PreviewSpread`. |
| Manuscript | `books-frontend/src/ui/studio/story/StoryManuscript.tsx` | The Story view's editor. |
| Setup dock | `books-frontend/src/ui/studio/DockSetupPanel.tsx` | Page focus's size and layout. It reaches the wizard only for its pickers (see L4). |
| Shared inputs | `books-frontend/src/ui/components/LikenessPhotoField.tsx`, `books-frontend/src/ui/design/LayoutSchematic.tsx`, `books-frontend/src/ui/hooks/useOfferableFormats.ts`, `books-frontend/src/ui/hooks/useBlobUrl.ts` | Cast photos with consent, arrangement schematics, formats, image URLs. |
| Checkout | `books-frontend/src/ui/checkout/OrderDialog.tsx` | Chat's Order well opens it. |

Deleting Steps also orphans a few files that stay on purpose. `core/story/revision.ts`
is used by the server (`functions/src/storyRevisionJobs.ts`); `core/book/characterAge.ts`
and `core/book/anchorDescription.ts` are pipeline logic; `Callout` and `Progress`
are generic primitives; `ShipToNote` and `OptionCard` move with the pickers in L4.

---

## Retire

### L0 — delete now (orphans)

Nothing renders these. The Steps setup gate, three unused Steps pieces, and the
first Chat attempt's widget engine, which the current Chat replaced.

**Delete**

- `books-frontend/src/ui/studio/DesignSetup.tsx`
- `books-frontend/src/ui/components/StageHeader.tsx`
- `books-frontend/src/ui/wizard/steps/ReviewStep.tsx`
- `books-frontend/src/ui/studio/story/HeroNamesInput.tsx`
- `books-frontend/src/ui/anchors/AnchorReelThumb.tsx`
- `books-frontend/src/ui/anchors/AnchorCellView.tsx`
- `books-frontend/src/ui/studio/useStudioPipeline.ts`
- `books-frontend/src/state/guideStore.ts`
- `books-frontend/src/state/guideEffects.ts`
- `books-frontend/src/core/guide/voice.ts`
- `books-frontend/src/core/guide/widgets.ts`
- `books-frontend/src/core/guide/effects.ts`
- `books-frontend/src/core/guide/staleness.ts`
- `books-frontend/src/core/guide/legacyRetirement.ts`
- `scripts/guide-widget-invariants.ts`
- `scripts/guide-effect-invariants.ts`

**Cut**

- `books-frontend/src/ui/studio/DesignWorkspace.tsx`: drop the `DesignSetup` import and the `showDesignSetup` branch.
- `books-frontend/src/ui/studio/StudioContext.tsx`: drop `designSetupOpen`, `openDesignSetup` and `closeDesignSetup` (marked L0).
- `scripts/guide-invariants.ts`: drop the `checkGuideWidgets` and `checkGuideEffects` imports, calls and report lines.
- `scripts/guide-session-invariants.ts`: drop the `core/guide/voice` import and the checks that use it.
- `scripts/guide-memory-invariants.ts`: drop the `core/guide/staleness` import and the "Staleness is ordered" section.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd .. && yarn check:guide`

### L1 — the Steps shell

This is the flip. After it, every book opens in Chat.

**Before**

- Chat's Order sells the printed book only. `books-frontend/src/ui/checkout/EbookDialog.tsx`
  is reached only from `OrderStage`. Either add the eBook to Chat's Order well
  (`books-frontend/src/ui/guide/chat/ComposerWell.tsx`) or decide to drop it.
  Deleting `OrderStage` without that decision removes eBook sales.
- Set the rollout to `on` for at least one release, so no reader is still mid-book in Steps.

**Delete**

- `books-frontend/src/ui/studio/StudioWorkspace.tsx`
- `books-frontend/src/ui/studio/StudioNavigator.tsx`
- `books-frontend/src/ui/studio/DesignWorkspace.tsx`
- `books-frontend/src/ui/studio/StoryStage.tsx`
- `books-frontend/src/ui/studio/StoryWorkspace.tsx`
- `books-frontend/src/ui/studio/StyleSetup.tsx`
- `books-frontend/src/ui/studio/ArtworkLookGate.tsx`
- `books-frontend/src/ui/studio/artworkLook.ts`
- `books-frontend/src/ui/studio/OrderStage.tsx`
- `books-frontend/src/ui/studio/StyleRenewBanner.tsx`
- `books-frontend/src/ui/studio/useStyleRenew.ts`
- `books-frontend/src/ui/studio/styleRenew.ts`
- `books-frontend/src/ui/studio/useStudioHotkeys.ts`

**Cut**

- `books-frontend/src/ui/project/ProjectWorkspace.tsx`: render `GuideStudio` unconditionally; drop the `guided` prop and the `StudioWorkspace` import.
- `books-frontend/src/app/studio/StudioApp.tsx`: stop passing `guided`; `chatStudio` becomes `inProject`.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd .. && yarn check:guide`

### L2 — the Steps cast stage

**Delete**

- `books-frontend/src/ui/studio/CastWorkspace.tsx`
- `books-frontend/src/ui/studio/AnchorsStage.tsx`
- `books-frontend/src/ui/anchors/AnchorCard.tsx`
- `books-frontend/src/ui/anchors/AnchorEditor.tsx`
- `books-frontend/src/ui/components/ImagePreview.tsx`
- `books-frontend/src/ui/generation/GenerationOverlay.tsx`
- `books-frontend/src/ui/generation/useGenerationProgress.ts`

**Cut**: none. Everything that imported these went in L1.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd .. && yarn check:guide`

### L3 — the Steps story intake

Keep the shared reader-fit and reviewed-revision modules now used by Chat:
`AgeFitCheck.tsx`, `StoryDiffReview.tsx`, `useStoryRevision.ts`, and
`platform/storyRevisions.ts`.

**Delete**

- `books-frontend/src/ui/studio/story/GuidedComposer.tsx`
- `books-frontend/src/ui/studio/story/CoWriteComposer.tsx`
- `books-frontend/src/ui/studio/story/StoryModePicker.tsx`
- `books-frontend/src/ui/studio/story/StoryAdaptCard.tsx`
- `books-frontend/src/ui/studio/story/StoryRefinePanel.tsx`
- `books-frontend/src/ui/studio/story/useStoryDraft.ts`
- `books-frontend/src/ui/studio/story/CastEditor.tsx`
- `books-frontend/src/ui/studio/story/WrittenForPicker.tsx`
- `books-frontend/src/ui/studio/story/OptionChips.tsx`
- `books-frontend/src/ui/studio/story/LanguageSelector.tsx`
- `books-frontend/src/platform/artLook.ts`
- `books-frontend/src/ui/components/SourceArtField.tsx`
- `books-frontend/src/ui/wizard/storyQuestions.tsx`
- `books-frontend/src/ui/wizard/steps/StoryStep.tsx`
- `books-frontend/src/ui/wizard/steps/ReaderStep.tsx`

The wizard's story and reader steps are here, not in L4, because they are the
only callers of the composers above.

**Cut**: none. The server routes behind `storyRevisions.ts` and `artLook.ts` stay until their
last caller is checked in `functions/src`.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd .. && yarn check:guide`

### L4 — the wizard

**Before**

- Move `SizeQuestion` and `LayoutQuestion` out of `books-frontend/src/ui/wizard/designQuestions.tsx`
  into a file beside `books-frontend/src/ui/studio/DockSetupPanel.tsx`, taking
  `ShipToNote` and `OptionCard` with them. After the move, nothing outside the wizard imports it.

**Delete**

- `books-frontend/src/ui/wizard/ChoiceSet.tsx`
- `books-frontend/src/ui/wizard/GuidedQuestions.tsx`
- `books-frontend/src/ui/wizard/ReadingModePicker.tsx`
- `books-frontend/src/ui/wizard/designQuestions.tsx`
- `books-frontend/src/ui/wizard/schema.ts`
- `books-frontend/src/ui/wizard/visuals.tsx`
- `books-frontend/src/ui/wizard/steps/StyleStep.tsx`
- `books-frontend/src/ui/wizard/steps/types.ts`

**Cut**

- `books-frontend/src/ui/studio/DockSetupPanel.tsx`: import the moved pickers.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd .. && yarn check:guide && test ! -d books-frontend/src/ui/wizard`

### L5 — routing and flow scaffolding

With one studio left, nothing needs to choose between them or record which one was used.

**Before**

- Nothing to move for the milestones: `usePreviewReached` and `useMilestoneReached` already live in
  `books-frontend/src/ui/studio/useMilestoneReached.ts`, so `useFlowAttribution.ts` is only the flow half.
- Move `useGuidePlaylist` out of `books-frontend/src/ui/guide/useGuideMode.ts`
  only if something other than the Chat gate still reads it. Otherwise, delete it with the file.

**Delete**

- `books-frontend/src/ui/studio/guideRouting.ts`
- `books-frontend/src/ui/studio/useFlowAttribution.ts`
- `books-frontend/src/ui/guide/GuideModeToggle.tsx`
- `books-frontend/src/ui/guide/useGuideMode.ts`
- `books-frontend/src/ui/admin/tabs/guide/GuideStepFlowPanel.tsx`

**Cut**

- `books-frontend/src/ui/studio/studioRoutes.ts`: drop the `guideDestination` import and the playlist branch that uses it.
- `books-frontend/src/ui/studio/StudioContext.tsx`: drop `step`, `setStep` and `openSetup` (marked L5), and `studioSteps.ts` if nothing else reads it.
- `books-frontend/src/core/guide/components.ts`: drop `legacyDestination` and `GuideLegacyDestination` (marked L5).
- `books-frontend/src/core/guide/mode.ts`: `resolveGuideMode` collapses to `"guide"` (marked L5); drop `guideToggleAvailable`, the override and the preference.
- `books-frontend/src/app/studio/StudioApp.tsx`: drop the toggle, `useFlowAttribution` and `useGuidePlaylist`.
- `books-frontend/src/ui/dashboard/Dashboard.tsx`: Create always opens `/studio/{id}`; drop `guideModeNow`.
- `books-frontend/src/ui/admin/tabs/GuideTab.tsx`: drop the Step flow panel and its segment.
- `scripts/guide-dual-flow-invariants.ts`: drop the `useGuideMode` playlist exemption and the `if (guided)` seam check.
- `functions/src/projects.ts`: drop the mirror's `authoring` flow field, and the `flow` parameter on `touchProject` and `/ai/project-touch`. Also drop `flow` from `touchProjectRemote` in `books-frontend/src/platform/aiClient.ts`. Keep the milestones (`previewed`, `finished`, `setupLocked`, `checkoutStarted`) and `reached` on `touchProject`/`/ai/project-touch`.

**Verify**: `cd books-frontend && npx tsc --noEmit && cd ../functions && npx tsc --noEmit -p . && cd .. && yarn check:guide`

After L5, the Retire section is empty and this file can be deleted along with
the ledger check in `scripts/guide-invariants.ts`.
