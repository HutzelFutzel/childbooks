# Studio Guide chat widgets

This is the implementation inventory for the UI states in
`STUDIO-GUIDE-UI-STATES.drawio`. The chat should orchestrate the existing studio
surfaces rather than duplicate their editors. The region beside the chat is the
book pane. `new studio guide doc.md` is the authoritative presentation and journey
contract through **Order the book**. This inventory supplies implementation states
only where they support that contract; older widget actions do not create extra
user-facing checkpoints.

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
- render a live choice in the composer well, and the resulting object on the book
  pane. The transcript keeps the receipt. A thumbnail in the thread may scroll the
  book pane to that object;
- never announce work as running before the job is queued.

Uploads, approval flags, generation starts, payment, and artifact completion are
trusted actions. They must not be emitted as model-proposed patches.

## Persistent shell widgets

### 1. Context chip

The conversation's target is a chip inside the composer, not a header bar:

- `Story`
- `Maya’s look`
- `Page 4`
- `Print review`

Clicking the book sets the chip. Tapping the chip retargets. When the book pane
shows one thing and the guide asked about another, the chip is the only
disambiguation. It never disables send and never warns.

### 2. Facts on the book

There is no rendered facts strip in Chat. Names, ages, style, story, shape, title
and page count appear on their owning book surfaces. The transcript records an
inference once in its applied-value receipt. Inferred values and untouched defaults
must never look like user-stated facts.

### 3. Book views

The book pane switches among Cover, Style, Story, Cast, and Pages. A view exists only
once that part of the book exists. The switch is navigation of the book, not a
linear wizard. Selecting a view updates the book pane and the composer chip.

Working, stale, and failed show on the object itself. There is no pipeline
outline in the chat.

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
- a context chip inside the field, naming the target (`Page 4`);
- the live choice in a well directly above the field, in the same stack, never
  inside the textarea and never left behind in the scroll;
- send and retry;
- paste/import handoff for long stories;
- attachment entry for supported visual sources;
- enabled use while background generation runs;
- preserved draft on navigation, offline interruption, and upload failure.

A cheap, reversible choice commits on the tap. The recommended option is focused,
so Enter on an empty field accepts it. Selecting a style, source, subject, or
instruction never spends Sparks. A scoped generation button names the units, shows
the capped estimate, and is the commit. Typing
remains a valid answer while the well is open. After the answer, the well clears
and one receipt is appended.

The composer must not be the full-story paste surface. “I’ll use my own words”
focuses the story view of the book pane. The story on that view is typed directly.
The composer is the only place a reader talks to the guide.

The context chip is the only disambiguation mechanism. It never disables the send
button and never warns. Tapping it retargets the conversation.

### 6. Mobile

The screen is the book. The composer docks at the bottom. The live choice opens as a sheet over the book, with the book still visible above it. There are no Chat / Book tabs.

Portraits are judged on the book. Keep, Tweak, and the other actions stay in the
sheet, so the reader does not leave the book to approve a look.

Needs:

- a polite announcement when a new visual arrives;
- the sheet does not steal focus while the reader is typing;
- return to the prior book position when the sheet closes;
- page focus still hides the transcript and docks this same composer.

## Conversation widgets

### 7. Guide message

One or two short sentences, casual and friendly, about 25 words unless the line
is a required disclosure (consent, a charge, likeness, or blast radius). The line
asks or acknowledges. It does not repeat the control, narrate the interface, or
carry stale progress numbers. Known beats use configured copy and appear with the
well in the same frame. See the voice contract in the flow design.

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

Live in the composer well, then collapse to a receipt. For small, closed choices such as:

- Guide me / I’ll use my own words;
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

The row lives in the composer well. The chosen artwork fills the book pane. Every
tile renders real illustration from `ArtStyleExample.imageUrl`, which the catalog
defines as a customer-facing preview never sent to an image model. The screen is full
of artwork before anything has been generated. Selecting the style invokes no model
and spends no Sparks. The generated portrait action, by contrast, shows its capped
Spark estimate before enqueueing.

Actions:

- Use this derived style;
- Draw Maya and Leo in this look · about X Sparks (the pre-selected
  recommendation);
- See other looks;
- Choose for me;
- See all styles, which fills the book pane with a horizontal row: the chosen
  plate large, the alternates smaller. The one-tap row stays in the composer well.

`Choose for me` must save a real style selection on the book. There is no provisional
house-style fallback and no **Not now**. The cast card comes first, so readers who
supply existing artwork never make a redundant style choice. If extraction is ambiguous
or fails, the required picker replaces the derived-style proposal.

This card does not wait for the cast card's upload or description to finish. It shows
catalog tiles the moment beat 2 is answered, so a reader can pick a style
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

Before queued state, the card's action names the stable cast units, shows one
portrait per unit, and gives the capped estimate: **Draw Maya and Leo in this
look · about X Sparks**. The initial granted Sparks are ordinary balance, not a
reason to call the portraits free. The action itself is the informed cost
confirmation; do not add a second modal.

The job cannot start until the book style is saved and that action is confirmed,
and the guide must not narrate drawing before the job is queued. “Maya is being
drawn” while a gate is still open is a false-background claim the reader will
notice, and it undermines every other status the guide reports.

The card keeps chat usable. It must compare result provenance with current
character/style facts before presenting the result as current.

### 19. First-look result card

The portrait is large on the book pane. While it is the live decision, the
composer well holds:

- First look label, on the book;
- source/style summary, on the book;
- Keep this look;
- Tweak it;
- New photo/artwork;
- Try another style;
- Recreate later;
- version history.

**Keep this look is that character’s approval**, and it carries the likeness
confirmation for a photo-sourced subject. Nothing may re-ask for the same subject
later. It never starts paid generation. Internal references needed later are
included in the Draw-the-book quote.

This is a soft checkpoint: under the default involvement, it must not block. A reader
who continues the story conversation instead of tapping Keep is treated as having kept
the look — the button is for a reader who wants to steer, not a gate. Only "Ask me each
step" turns it into a required pause.

`Try another style` is the cheap escape from a style chosen before the reader could see
their child rendered in it, so it belongs here as a first-class action rather than
buried in a settings surface.

`Recreate later` stays visible on the cast view, and the page-art cost gate must
state which look the pages will use. Once the look settles, the thread records
one receipt.

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
honest. It does not introduce a separately priced reference-sheet action.

Shows:

- every required recurring subject, grouped as **your people** and **everything else the
  story mentions**, with different size and ceremony;
- unresolved, stale, or never-reviewed items, which are the only things that
  require review action;
- which internal references Draw the book still needs, shown as part of that
  generation scope rather than as another product decision.

Actions:

- Edit one;
- Recreate later;
- Draw the book, once the story and book plan are ready.

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
“write it now” starts it immediately. Otherwise the patch that resolves every
required fact and every optional fact the guide actually asked starts it
automatically, provided no clarification or identity assignment remains open. The
job queues before the guide says it is drafting, and the composer remains available.

### 24. Story import/paste card

Focuses the story view of the book pane. That view is the manuscript, and it is
directly editable. The card supports:

- paste;
- plain-text/document import when supported;
- word count;
- language detection;
- cast/audience extraction preview;
- contradiction review;
- preserve original version.

The extraction preview must not silently trigger portrait generation. Pasted-text
extraction is lower confidence than a reader answering "Who is in the book?"
directly, so it surfaces as "Found Maya, 5, and Leo, 3 in your story" with
**Edit people** beside the scoped portrait action. For a high-confidence result,
that action both accepts the visible cast and authorizes exactly those portraits.
An ambiguous result must be corrected first.

**That's not quite right** transforms the receipt in place rather than opening a
blank form. The reader can rename, correct an age, remove, or add a subject using
editable rows/chips, and can also type a natural-language correction in the
composer. The original manuscript remains unchanged; do not reparse all of it
after every edit. Returning from correction restores the same cast/style flow.
"I’ll use my own words" focuses the story view. Correcting an extracted name does
not require it, because those corrections happen in the composer well.

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

The plan is visible on the book and remains editable until Draw the book. It does
not need a separate approval action; the scoped Draw-the-book button is the
commitment.

### 28. Batch-generation gate

Used for every billable image-generation action: named portraits, Draw the book,
targeted regeneration and paid retry. Draw the book is one user-authorized batch
whose units may include internal references, cover images and page illustrations.
The gate is usually not a separate screen: a scoped action containing the required
disclosure is the gate. Approval actions such as **Keep this look** never double as
generation gates.

Shows:

- exact generated units: portraits, internal references, cover images and pages;
- capped Spark estimate and the note that actual token use can settle lower but
  cannot exceed it;
- whether closing the tab is safe;
- the character and style version being used;
- an explicit note when any subject is marked **Recreate later**, naming the look the
  pages will actually use;
- a scoped action such as **Draw the book · 24 pages · about 48 Sparks**;
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

Use scoped labels such as “Draw the book · 24 pages,” not “Start.”

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

Retry only failed or affected units, and show the capped retry estimate on the
retry action.

## Change, recovery, and resume widgets

### 31. Impact summary

Before a downstream-changing edit:

> “Changing Maya’s look will update her internal reference and 6 pages.”

Shows:

- affected story/cast/plan/pages;
- capped estimate;
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

### 37. Final outcome

When preflight passes, the composer well shows **Order the book · from [price]**,
or the exact price when the product is already known. It opens checkout. Editing
and saving remain available through the book and normal navigation rather than
adding another required final card. Ebook is a separate optional product action.

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
- a new visual on the book the reader has not seen.

Do not announce every progress increment.

### 40. Reduced-motion and focus manager

- disable decorative message/result motion when requested;
- move focus to blocking errors or confirmation only;
- do not steal focus for background results;
- restore focus when closing the conversation overlay or the mobile sheet;
- keep sticky composer from covering focused controls.

### 41. Generated-image description

Every generated visual needs a useful description for readers who cannot inspect
the image directly. Approval and error states cannot rely on color alone.

## Money, account, and book-shape widgets

### 42. Sparks information row

Shown once before the opening line of a new book, then stored as seen:

> Image generation uses Sparks. You’ll see the estimate before anything is drawn.

There is no persistent balance or billing header. Every generation action names
its units and carries its own capped estimate. An insufficient balance puts the
smallest sufficient top-up or account action in that same well.

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
- automatic continuation only when the reader already confirmed the same unexpired
  capped quote;
  otherwise return to the same confirmation.

### 44. Format and length

Do not add two mandatory decisions to the first visual reward. Once the brief can
support defaults, show one compact non-blocking summary:

> Book plan: 24 pages · 8×8 hardcover · Change

The untouched values are visibly defaults on the book. **Change** opens the length
and format controls; proceeding with the defaults needs no separate tap. Repeat
the plan at the Draw-the-book gate because page count drives cost
and text overflow. Unsupported format, language, print region and shipping
combinations are surfaced before paid page art.

### 45. Title

The proposed title appears on the cover plan and follows the draft until the
reader edits it. It is directly editable; alternatives can be requested through
the composer. It creates no separate mandatory checkpoint.

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
5. Durable first-look progress, the portrait on the book pane, and Keep this look
   in the composer well.
6. Visible story settled action; configured first-look, cast and page generation
   gates; charge receipts; page batch progress.
7. Flip-through and order.

### Slice 2 — trust and control

8. Facts with said/inferred/default/choice provenance, and multi-artifact receipts.
9. Involvement control and the default ownership table.
10. Composer context chip. There is no separate context header.
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

The book pane reuses the manuscript and the page canvas. The story-refine prompt
is not mounted. Chat widgets open, target, and summarize these surfaces. The book
pane renders the book, and the page canvas is the only focus mode.
