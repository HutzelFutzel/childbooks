# Studio Guide chat widgets

This is the implementation inventory for the UI states in
`STUDIO-GUIDE-UI-STATES.drawio`. The chat should orchestrate the existing studio
surfaces rather than duplicate their editors.

## Widget contract

Every chat widget must:

- read current truth from the `Project` or durable job state;
- write through a typed fact writer or a trusted UI action;
- render loading, empty, success, partial, stale, failed, and disabled states;
- identify the artifact/entity it targets;
- remain usable with keyboard and screen reader;
- preserve the composer unless a destructive confirmation is active;
- record a readable transcript event and an exact applied-value receipt;
- survive refresh by deriving state from the book, not local component state;
- render its result inline in the chat stream on every screen size, rather than only
  in the side panel;
- never announce work as running before the job is queued.

Uploads, approval flags, generation starts, payment, and artifact completion are
trusted actions. They must not be emitted as model-proposed patches.

## Persistent shell widgets

### 1. Guide context header

Shows what the conversation currently targets:

- `Book setup`
- `Story`
- `Maya’s look`
- `Page 4`
- `Print review`

Actions:

- open the target in the side panel;
- clear an explicitly pinned target and return to the guide’s current question.

This prevents “change this” from being applied to the wrong artifact. When the panel
and the guide’s question diverge, the composer tag in widget 5 resolves it — never a
warning banner, and never a blocked send.

### 2. Book facts strip

Upgrade the existing facts strip to distinguish:

- **You said**
- **I inferred**
- **Default**
- **Book choice**

Each item opens its owning surface and offers change/history actions. Inferred
values and untouched defaults must never look like user-confirmed facts.

### 3. Artifact outline

Compact outline:

- Story
- Characters
- Pages
- Preview

Per-item states:

- not started;
- working;
- ready;
- needs review;
- approved;
- stale;
- failed.

The outline is navigation, not a linear wizard. Selecting an item updates both the
side panel and chat context.

### 4. Involvement control

One visible setting with three positions — Make it for me / Make it with me / I’ll
do it myself — which writes both stored fields at once: per-artifact ownership for
Story, Characters and Pages, and the review cadence.

The reader is never asked to pick a cadence on its own. Checkpoints ask the real
question in context.

The per-artifact rows stay collapsed behind “How we’re working” for readers who want
them. A natural-language change updates the same settings and shows a receipt.

### 5. Composer

Needs:

- multiline text;
- a quiet context tag: `Replying to: Maya’s look · talk about Story instead`;
- send and retry;
- paste/import handoff for long stories;
- attachment entry for supported visual sources;
- enabled use while background generation runs;
- preserved draft on navigation, offline interruption, and upload failure.

The composer must not be the full-story paste surface. “I already have words” opens
the manuscript/import panel.

The context tag is the only disambiguation mechanism. It never disables the send
button and never warns; tapping it retargets the conversation.

### 6. Mobile panel switch

Chat / Book tabs, where Book is the reading and inspection surface: the flip-through,
a full reference sheet, a page up close. Portraits are **not** approved there —
results and their actions stay in the conversation, so the reader never has to leave
the thread, act in a tab, and come back.

Needs:

- a badge only for work that genuinely lives in the Book tab;
- failed-action badge;
- progress indicator;
- return to prior scroll/editor position;
- accessible announcement when a new visual arrives.

## Conversation widgets

### 7. Guide message

Open text, optional explanation, and one primary request. It should not contain
stale progress numbers.

### 8. Reader message

Reader bubble with:

- failed/send state;
- visible message menu on touch and keyboard;
- Undo this;
- Copy;
- Edit/resend when safe.

Undo cannot be hover-only.

### 9. Applied-value receipt

Shows what actually changed after a turn:

- every value that changed, not only the first;
- source category (said/inferred/choice);
- each affected artifact;
- a Change action per item.

One message can change two artifacts — “move it to a lighthouse and make Maya’s hair
curly”. Both changes appear in one receipt, and their staleness cascades group into
one notice rather than firing twice.

It reads from the updated book, not model output.

### 10. Targeted clarification

Used for one missing or low-confidence fact:

> “How old is Leo?”

It can combine:

- free text;
- unit-aware number input;
- age-in-months option;
- “I don’t know” when a safe default is possible.

It must not replay the broad intake question.

### 11. Closed-choice cards

For small, closed choices such as:

- Guide me / I already have words;
- involvement (Make it for me / Make it with me / I'll do it myself) — never
  review cadence on its own, which the involvement control writes and the reader
  is never asked for directly;
- use derived artwork style;
- choose which person appears in a group photo.

Cards need concise labels, full non-truncated explanations, selected/disabled
states, and a free-text escape where appropriate.

### 12. Optional-action row

Never overload one ambiguous Skip link, but keep the vocabulary small enough to tell
apart:

- Choose for me;
- Leave this out;
- Not now — only where returning is genuinely expected.

Four near-synonyms are their own friction. Show at most two actions, and only ones
that are semantically valid for the current component.

## Parallel first-look widgets

### 13. Unified cast intake card

One card for every named subject, asked once — not one question per child.

Shows a tile per subject (name and age) and four equal choices for how they should
look:

- Use a photo — including one photo containing several of them;
- Use existing artwork;
- Describe them;
- Let me invent them.

Also needs:

- **Upload a photo of them together**, with face-to-name assignment — shown only
  when the photo contains more than one recognizable face; a single clear face
  skips this step entirely;
- consent bundled onto the same tile as the photo picker, not a screen gating it;
- Set up separately, for readers who prefer it;
- mixed sources across subjects;
- equal visual weight for every child, with no implied ranking;
- a defined default for the bulk action: tapping **Use a photo** once applies to
  the named human subjects on the card only. Their tiles visibly change to
  **Using this photo**. Any pet, object or setting on the same card visibly
  changes to **Create from story · Use photo instead** and is overridable per
  tile; if the photo also shows the dog, the same face/subject-assignment step
  covers it rather than requiring a second upload flow;
- confirmable suggested assignments rather than silent identity matching. A
  single clear face for one human skips assignment entirely.

The style step (widget 17) does not wait for this card's upload to finish. It can
be answered in parallel with an in-flight upload or a still-being-typed
description, so the photo path is not longer than the describe/invent paths.

Parents of siblings and twins read a sequential queue as “did it forget my son?”, and
the common real-world artifact is one photo with several children in it. Intake covers
everyone before any rendering starts; the render queue may still be sequential.

For a character-free book the card asks instead for:

- Setting sample;
- Important object;
- Style sample.

The card supports a prior reusable character when that feature exists. Every route
proceeds through the book-style step before visual generation unless the book already
has a valid style.

### 14. Photo consent and upload

One compact card, not a multi-step wizard: the consent checkbox and the picker
appear together, so accepting and choosing a photo is a single action, not a
gate the reader must clear before they are allowed to upload. States within that
one card:

1. privacy/authority explanation + consent checkbox, shown alongside the picker;
2. camera or photo library;
3. local preview and upload progress;
4. face/person selection — only rendered when the photo has more than one
   recognizable face; skipped entirely otherwise;
5. uploaded/expiring/expired/error.

The permission copy states that the source is private, used only for likeness,
deleted as soon as the likeness pipeline no longer needs it, and hard-expires
within 24 hours. Anonymous-account ownership is sufficient; a durable sign-in is
not required. **Delete now** is available after upload. If a source expires,
completed generated work remains and replacement is requested only when another
likeness generation needs it.

Recovery:

- retry;
- choose another photo;
- describe instead;
- invent instead;
- delete source.

The no-photo routes must be equally prominent.

### 15. Existing-artwork upload

Supports up to the product limit, with:

- upload/drop;
- image preview;
- canonical image selection;
- add supporting views;
- replace/remove;
- extraction progress;
- rights reminder;
- conflict state.

### 16. Character description

Free text first, optional chips second:

- hair;
- skin tone;
- glasses;
- clothing;
- favorite color;
- species/body plan for non-human characters.

Do not infer sensitive appearance from a name. Description and photo conflicts must
identify which source will win.

### 17. Book-style confirmation

Required before generating any character, setting, object or other visual sample —
and deliberately built as a one-tap confirmation rather than a browse, because this is
also the reader’s **first visual reward**.

Shows one of:

- the inherited book style;
- a style derived from existing character artwork, awaiting confirmation;
- a recommended style pre-selected beside three to five alternates.

Every tile renders real illustration from `ArtStyleExample.imageUrl`, which the catalog
defines as a customer-facing preview never sent to an image model. The screen is full
of artwork before anything has been generated, at zero cost and zero latency. The
generated first-look action, by contrast, shows its configured Spark cost before
enqueueing.

Actions:

- Use this derived style;
- Create their first looks in this style · X Sparks (the pre-selected
  recommendation);
- See other looks;
- Choose for me;
- See all styles, which opens the full gallery in the panel.

`Choose for me` must save a real style selection on the book. There is no provisional
house-style fallback and no **Not now**. The cast card comes first, so readers who
supply existing artwork never make a redundant style choice. If extraction is ambiguous
or fails, the required picker replaces the derived-style proposal.

This card does not wait for the cast card's upload or description to finish. It shows
zero-cost catalog tiles the moment beat 2 is answered, so a reader can pick a style
while their photo is still transferring — the two beats run in parallel rather than
serializing into a longer photo path.

**Recommendation needs catalog metadata.** `AGE_BAND_FRAMEWORK.md` §9.7 forbids
selecting a style on the reader’s behalf from audience guidance, and states that a
by-age recommendation belongs in the art catalog as compatibility metadata.
`ArtStyleDefinition` has no such field today, so add optional recommendation metadata,
admin-editable like the rest of the catalog. Until then, mark one style recommended
manually; the interaction is identical.

### 18. First-look generation card

Durable visual progress:

- immediate source/style evidence;
- “Reading the photo”;
- “Drawing Maya”;
- queued/running/result/stale/failed/cancelled.

Before queued state, the card's action shows how many first looks it will create,
their configured Spark charge, the available balance and balance afterwards. If
an allowance covers it, say **Uses X included Sparks**, not “free”. The action
itself is the informed cost confirmation; do not add a second modal.

The job cannot start until the book style is saved and that action is confirmed,
and the guide must not narrate drawing before the job is queued. “Maya is being
drawn” while a gate is still open is a false-background claim the reader will
notice, and it undermines every other status the guide reports.

The card keeps chat usable. It must compare result provenance with current
character/style facts before presenting the result as current.

### 19. First-look result card

Rendered inline in the chat stream, not only in the panel. Large portrait or sample
with:

- First look label;
- source/style summary;
- Keep this look;
- Tweak it;
- New photo/artwork;
- Try another style;
- Recreate later;
- version history.

**Keep this look is that character’s approval**, and it carries the likeness
confirmation for a photo-sourced subject. Nothing may re-ask for the same subject
later. It never starts or charges for a full reference sheet; approval and paid
generation are separate actions.

This is a soft checkpoint: under the default involvement, it must not block. A reader
who continues the story conversation instead of tapping Keep is treated as having kept
the look — the button is for a reader who wants to steer, not a gate. Only "Ask me each
step" turns it into a required pause.

`Try another style` is the cheap escape from a style chosen before the reader could see
their child rendered in it, so it belongs here as a first-class action rather than
buried in a settings surface.

`Recreate later` creates a visible pending item in the artifact outline, and the
page-art cost gate must state which look the pages will use.

For a real likeness, avoid claiming an exact match. Use neutral copy such as “Try
another look.”

### 20. Multi-character queue

Shows:

- whose look is ready;
- who is next;
- completed/working/failed counts;
- equal visual treatment for siblings/twins;
- open individual character;
- retry failed only.

### 21. Style-conflict resolver

When source artworks differ:

- preview each style;
- explain that identity/design stays intact;
- choose which rendering style applies to the book;
- optionally open the full style gallery.

### 22. Cast summary before page art

A summary, not a second approval round. A reader who kept each look as it arrived
passes the visual review straight through, which is what makes “Make it for me”
honest. A separately priced reference-sheet action authorizes generation; it is
not another approval of the appearance.

Shows:

- every required recurring subject, grouped as **your people** and **everything else the
  story mentions**, with different size and ceremony;
- unresolved, stale, or never-reviewed items, which are the only things that
  require review action;
- one plain sentence about what a reference sheet guarantees: every page is drawn from
  it, so the character stays the same while poses, angles and light change.

Actions:

- Create N reference sheets · X Sparks, when sheets do not exist yet;
- Ready to put them into the story scenes, when sheets are current;
- Edit one;
- Recreate later.

Copy is forward-looking (“Ready to put Maya and Leo into the story scenes?”), never
“complete visual lock” — “lock” promises pixel-identical output that an image model will
not deliver, and that expectation becomes a complaint twelve pages later. If a later
recreation affects pages, route through the impact widget first.

## Story widgets

### 23. Broad intake prompt

One conversational request for:

- names;
- ages;
- relationships;
- story wish;
- optional must-include and avoid details.

Its response is the facts/receipt UI, not another form.

Drafting does not begin merely because the minimum brief is technically ready or
because the reader stopped interacting. An explicit typed instruction such as
“write it now” starts it immediately. Otherwise the ready state shows a compact
summary with **Create the story** and **Add another detail**, while the composer
remains available. Do not show this confirmation when the reader already gave the
explicit instruction.

### 24. Story import/paste card

Opens the manuscript panel and supports:

- paste;
- plain-text/document import when supported;
- word count;
- language detection;
- cast/audience extraction preview;
- contradiction review;
- preserve original version.

The extraction preview must not silently trigger the first-look track. Pasted-text
extraction is lower confidence than a reader answering "Who is in the book?"
directly, so it surfaces as a receipt with an explicit **Start their first look**
action — "Found Maya, 5, and Leo, 3 in your story" — plus **That's not quite
right**. One tap confirms it; the cast card and style step (widgets 13 and 17)
only begin after that confirmation, not automatically on parse.

**That's not quite right** transforms the receipt in place rather than opening a
blank form. The reader can rename, correct an age, remove, or add a subject using
editable rows/chips, and can also type a natural-language correction in the
composer. The original manuscript remains unchanged; do not reparse all of it
after every edit. **Use these details** returns directly to the cast/style flow.
Open the manuscript panel only when the reader chooses to edit the words.

### 25. Story concept/outline chooser

Only for “Help me create it”:

- 2–4 distinct concepts or outlines;
- choose one;
- combine;
- request another;
- provide own idea.

Avoid endless rerolling before any draft exists.

### 26. Story checkpoint

Manuscript summary plus:

- Use this story;
- Revise for me;
- Edit myself;
- Restore version;
- change ownership/cadence.

Show age/language checks and any safety or length issue with a direct fix.

## Page widgets

### 27. Page-plan summary

Visual spread cards containing:

- page/spread number;
- story text excerpt;
- scene summary;
- required characters;
- status warning.

Actions:

- Use this plan;
- move/split/combine;
- edit text or scene;
- add/remove spread when print constraints permit.

Plan existence is not plan approval.

### 28. Batch-generation gate

Used for every configured billable image-generation action, including first looks,
full reference sheets, pages, covers, targeted regeneration and paid retry. It is
usually not a separate screen: a scoped action containing the required disclosure
is the gate. Approval actions such as **Keep this look** never double as generation
gates.

Shows:

- exact number of first looks, pages, covers or sheets;
- configured Spark cost, available balance and the balance afterwards;
- **Uses X included Sparks** when an allowance covers the charge, without calling
  the generated result free;
- whether closing the tab is safe;
- the character and style version being used;
- an explicit note when any subject is marked **Recreate later**, naming the look the
  pages will actually use;
- a scoped action such as **Create 12 illustrations · 48 Sparks**;
- return to cast or page plan.

The confirmed quote is stable: if configuration changes before enqueueing, honor
it or ask again. Reserve at most that quote, charge only successful usable units,
and release the rest: failed or moderated units are uncharged, and cancellation
charges completed units only. Partial-batch and completion receipts show charged,
uncharged and released amounts. A retry is a new configured generation action and
discloses its charge before enqueueing.

### 29. Batch progress

Shows:

- completed / total;
- queued / running / failed;
- live thumbnails as they land;
- continue chatting;
- open completed page;
- cancel remaining work when supported.

Use scoped labels such as “Create 12 illustrations,” not “Start.”

### 30. Per-page result and recovery

For each page:

- current version;
- stale/failed/current status;
- edit text;
- change composition;
- regenerate;
- upload/use own asset;
- apply direction to remaining pages;
- keep this version.

Retry only failed or affected units, and show any configured retry charge on the
retry action.

## Change, recovery, and resume widgets

### 31. Impact summary

Before a downstream-changing edit:

> “Changing Maya’s look will update her reference sheet and 6 pages.”

Shows:

- affected story/cast/plan/pages;
- configured charge and resulting balance;
- Update affected work;
- Keep current work;
- Cancel change.

### 32. Stale-work notice

One grouped explanation, upstream first. It must distinguish:

- needs update;
- update running;
- intentionally kept old;
- failed.

Avoid multiple alarming warnings for one change.

### 33. Local error recovery

Error message includes the next useful actions:

- resend;
- retry failed unit;
- edit input;
- use another source;
- choose for me;
- contact support when no local recovery exists.

Never discard successful sibling units.

### 34. Resume summary

On reopen:

> “Your story is ready. Maya’s look finished while you were away. 4 pages still
> need pictures.”

Actions:

- Continue;
- Review newest result;
- Take it from here;
- open failed item.

### 35. Conflict resolver

For concurrent-device revision conflict:

- what changed here;
- what changed elsewhere;
- merge independent changes;
- keep this version;
- keep other version;
- preserve both as versions.

## Final review widgets

### 36. Print-preflight checklist

Checks:

- story/page text;
- title and cover;
- current illustrations;
- unresolved stale work;
- text overflow;
- image quality;
- page count;
- trim/binding compatibility;
- supported fulfillment region.

Each failure opens the exact artifact and recommended fix.

### 37. Final outcome card

Actions:

- Order printed book;
- Get ebook;
- Change something;
- Save and return later.

Show price before checkout. Payment and final order remain explicit confirmations.

### 38. Dedication widget

Optional:

- dedication/gift message;
- skip;
- preview placement;
- edit from final review.

## Accessibility infrastructure

### 39. Async live region

Polite announcements:

- first look ready;
- generation failed;
- page batch completed;
- unseen Book-tab result.

Do not announce every progress increment.

### 40. Reduced-motion and focus manager

- disable decorative message/result motion when requested;
- move focus to blocking errors or confirmation only;
- do not steal focus for background results;
- restore focus when closing the side panel/dialog;
- keep sticky composer from covering focused controls.

### 41. Generated-image description

Every generated visual needs a useful description for readers who cannot inspect
the image directly. Approval and error states cannot rely on color alone.

## Money, account, and book-shape widgets

### 42. Pricing and balance line

Persistent in the shell from the first screen, but configuration-driven rather
than making a promise the next generation can contradict:

> Style previews cost nothing. Image generation uses Sparks; you’ll always see
> the cost before it starts.

Show a Spark balance only when the reader has one, with a transparent top-up path.
Every generation action carries its own quantity and cost; the persistent line is
orientation, not a substitute for the informed action.

### 43. Account moment

The anonymous Firebase account owns the project and private uploads, so intake,
drafting and generation continue while the reader has an available balance. Do
not require a durable account before the story draft or because the work has
become emotionally valuable.

Ask for a durable account only when its capability is needed: cross-device
preservation, buying Sparks, or ordering. Frame it as **Save your book and
continue**, never as a wall.

Needs:

- what is being saved, named;
- one-tap platform providers, including Apple where available, plus passwordless
  email; password signup remains a fallback;
- optional marketing consent separated from the continuation action;
- no email-verification gate on continued studio work;
- sign-in and sign-up in place, without losing the transcript, draft, upload,
  scroll position, current target or pending action;
- guest-project transfer or merge when the identity already belongs to another
  account, with one clear conflict choice only when automatic merge is unsafe;
- automatic continuation only when the reader already confirmed the exact charge;
  otherwise return to the same confirmation.

### 44. Format and length

Do not add two mandatory decisions to the first visual reward. Once the brief can
support defaults, show one compact non-blocking summary:

> Book plan: 24 pages · 8×8 hardcover · Change

The untouched values are marked **Default** in the facts strip. **Change** opens
the length and format controls; proceeding with the defaults needs no separate
tap. Repeat the plan at the page-generation gate because page count drives cost
and text overflow. Unsupported format, language, print region and shipping
combinations are surfaced before paid page art.

### 45. Title

Offered at the story checkpoint rather than silently adopting the draft’s own title:

- the proposed title;
- Use this;
- Edit;
- Suggest others.

## One voice

### 46. Speech queue

Two tracks plus a clarification question can finish in any order, and per-component
dedupe does not cover that. One queue, with priority:

1. a blocking error or required confirmation;
2. an answer to what the reader just typed;
3. a result that has landed;
4. the next question in the flow.

At most one line per change. Lower-priority items collapse or drop rather than stack, so
a finished portrait, a finished draft and a follow-up question never arrive as three
bubbles.

## Recommended implementation order

Build the vertical slice that produces a visible book first. Plumbing before value means
the design is not validated until late.

### Slice 1 — a first look and a printable book

1. Engine work: cursor shape, the catalog dependency chain, and the provisional subject
   with its reconciliation rule.
2. Unified cast intake card.
3. Photo consent/upload and artwork upload wrappers.
4. Book-style confirmation on real artwork.
5. Durable first-look progress and inline result card, with Keep this look as the
   approval.
6. Visible story settled action; configured first-look, cast and page generation
   gates; charge receipts; page batch progress.
7. Flip-through and order.

### Slice 2 — trust and control

8. Facts with said/inferred/default/choice provenance, and multi-artifact receipts.
9. Involvement control and the default ownership table.
10. Context header plus composer context tag.
11. Speech queue.
12. Configuration-driven pricing line and capability-driven account moments.
13. Scoped action labels, visible history and undo.
14. Async live region and reduced-motion handling.

### Slice 3 — completeness

15. Story import, concepts and checkpoint; title.
16. Page-plan summary and approval; format and length.
17. Per-page recovery; impact, stale and resume widgets.
18. Cast summary grouping and multi-character queue polish.
19. Print preflight, dedication, conflict resolver.

## Existing surfaces to reuse

Do not rebuild these inside chat:

- manuscript editor and story revision surfaces;
- art-style gallery;
- cast shelf and character editor;
- `LikenessPhotoField`;
- `SourceArtField`;
- page-plan/page editor and asset library;
- flip-through preview;
- order and ebook checkout;
- shared version trees, staleness detectors, jobs, and project persistence.

Chat widgets should open, target, and summarize these surfaces while the side panel
renders the real editor.
