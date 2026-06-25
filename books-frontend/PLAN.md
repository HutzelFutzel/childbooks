# Childbook Studio — Execution Plan

Status legend: [ ] todo · [~] in progress · [x] done

All phases below (0–11) are now implemented. See per-phase notes.

## Done so far
- Foundation, dynamic model registry, setup wizard
- Analysis, References (anchors) with versioning
- Screenplay with printability + book sketch
- Generate (illustrations) with ordered reference images + add/remove + edit

## Phase 0 — Renames
- [x] Stage labels: `generation` → "Generate Pages", `review` → "Final Design"
- [x] "Anchor" → "Characters & Places" (step) / "reference" (artifact) in all UI copy
- [x] Keep persisted stage key `anchors` (no migration)

## Phase 1 — Reference reliability
- [x] Require an image for every included reference before leaving the step
- [x] Record per-illustration provenance: which reference version each used

## Phase 2 — Localized edits
- [x] Prompt-locking ("change only X; keep others identical")
- [x] Mask inpainting: `ImageRequest.mask`, OpenAI edits mask, brush UI

## Phase 3 — Covers & spine (from Screenplay)
- [x] `ScreenplayDoc.frontCover/backCover/spine` specs
- [x] LLM drafts covers; show in screenplay + sketch
- [x] Generate covers in Generate Pages

## Phase 4 — Per-page text mode
- [x] `spread.textMode: 'in-image' | 'overlay'`
- [x] in-image: length-aware reserved space

## Phase 5 — Propagate reference changes
- [x] Detect stale illustrations via provenance
- [x] "Update affected pages" action

## Phase 6 — Typography
- [x] `@fontsource` ~36 book fonts, lazy loaded
- [x] Font + size picker with live preview
- [x] Age-based default sizes; per-box/word overrides

## Phase 7 — Final Design editor core
- [x] `project.design` layer (normalized coords)
- [x] Scaled page stage + page navigator; seed boxes from screenplay

## Phase 8 — Editing toolset
- [x] react-moveable drag/resize/rotate/multiselect/snap + guides
- [x] 15 text-box designs (configurable colors)
- [x] Rich text per-word styling; align toolbar; undo/redo

## Phase 9 — Color system
- [x] react-colorful RGBA + alpha
- [x] Canvas pipette (sample from page image)

## Phase 10 — Patterns
- [x] Procedural SVG pattern engine (~15) for boxes/blank pages

## Phase 11 — Review polish + export
- [x] Placement notes, print-safe view
- [x] PDF export
