# Studio Guide flow design

This document defines the conversational flow represented in
`STUDIO-GUIDE-USER-FLOWS.drawio`. Its important screen states are sketched in
`STUDIO-GUIDE-UI-STATES.drawio`, with implementation contracts in
`STUDIO-GUIDE-CHAT-WIDGETS.md`.

## Decision

The smartest flow does **not** split readers permanently into “automatic” and
“manual” branches, and it does **not** ask the reader to configure a workflow.

Two fields describe the execution. Only one of them is ever visible.

**Stored model.** Artifact ownership, set independently for Story, Characters and
Pages — **Create it for me**, **Help me create it**, **I’ll provide or edit it** —
plus a review cadence: **Take it from here**, **Check key moments**, **Ask me each
step**.

**Visible control.** One setting, phrased as involvement rather than governance,
whose three positions write both fields at once:

| Involvement | Ownership written | Cadence written |
| --- | --- | --- |
| Make it for me | Story, Characters, Pages = Create it for me | Take it from here |
| Make it with me (default) | the per-artifact defaults below | Check key moments |
| I’ll do it myself | Story, Characters, Pages = I’ll provide or edit it | Ask me each step |

The reader is never asked which cadence they want. “Make it with me” is the
invisible default, and the checkpoints ask the real question in context instead —
“Looks great, create the pages” rather than “choose a review cadence”. The
per-artifact rows stay reachable in a quiet “How we’re working” control and can be
changed in natural language (“write the story and make the characters, but let me
edit the pages”), but they are never pushed into the stream.

Because the hard checkpoints below apply at every setting, the practical
difference between two adjacent involvement levels is one or two taps. That is the
point: the control exists so a reader can opt out of being asked, not so they can
design a pipeline.

### Default ownership

“Infer it from the reader’s language” is not implementable on its own, so the
defaults are explicit:

| Artifact | Default | Why |
| --- | --- | --- |
| Story | Follows the entry choice: **Create it for me** after “Guide me”, **I’ll provide or edit it** after “I already have words” | The entry question already asked this |
| Characters | **Create them for me** | The reader supplies sources, not drawings |
| Pages | **Create pages for me** | Nobody opens a chat to lay out spreads |

Any manual edit to an artifact silently promotes that artifact to **Help me create
it**. A reader who has started editing has told us more than a setting would.

## Revised flow summary

Visuals come first, and the conversation does not fork until something is actually
rendering. Two rules make that work.

**The earliest visual is not the portrait.** The art catalog already holds
customer-facing example artwork (`ArtStyleExample.imageUrl`, explicitly never sent
to an image model), so real illustration can be on screen within one turn of the
reader giving names — at zero cost, with no generation and no waiting. The style
step is therefore not a roadblock in front of the reward; it *is* the first reward.

**Nothing is narrated as happening until it is happening.** The guide must never
say “I’m drawing Maya” while a gate is still open. Story conversation begins only
once a visual job is queued or running. A guide that claims background progress
that has not started is the fastest way to lose a reader’s trust in everything else
it says.

The opening is four beats:

1. **Names and ages.** One prose question, one receipt.
2. **One cast card for everyone named**, asking a single question: do you have a
   photo? *Upload a photo* / *Describe them* / *Let me invent them*, offered once
   for the whole cast rather than once per child.
3. **Style as a one-tap confirmation, shown as real artwork.** A recommended tile
   pre-selected beside three to five alternates. “I’ll draw them in this look.” →
   *Create Maya and Leo’s first looks · X Sparks* / *See other looks*. The action
   shows the configured charge and resulting balance before it can enqueue
   generation. The screen is full of illustration before anything has been
   generated.
4. **The visual job starts, and then the story opens.** After that informed action,
   the progress card carries the uploaded photo and the chosen style tile, and only
   now does the guide pivot: “They’re being drawn — while that happens, what should
   the seaside day be like?”

Readers who supply existing artwork skip beat 3: the style is derived in the
background and confirmed on the result card.

After beat 4 the two tracks genuinely run in parallel:

- The first result is explicitly a **first look**, not a finished design. It can be
  kept, tweaked, re-sourced or restyled.
- Story work never waits for a first look, and a first look never waits for the
  story.
- **Keeping a look is that character’s approval**, and it carries the likeness
  confirmation for a photo-sourced character. The later cast summary is a summary,
  not a second approval.
- A later recreation stays possible. Before applying it, the guide states how many
  character sheets and pages will need updating.

If the story has no character, beat 2 asks for a setting, an object or a style
sample instead. The style is still chosen first, and the product still shows visual
progress without inventing a person the book does not need.

## Text-based end-to-end flow

```text
OPEN OR RESUME BOOK
  |
  +-- Existing work?
  |     +-- Yes: summarize current artifact state and resume unresolved/stale work
  |     +-- No: Guide me / I already have words
  |
  +-- 1. NAMES AND AGES                         (receipt, not a form)
  |
  +-- 2. ONE CAST CARD FOR EVERYONE NAMED
  |        photo (of one child or several) / describe / invent
  |        no-character book: setting, object or style sample
  |
  +-- 3. BOOK STYLE - ONE TAP, REAL ARTWORK     (skipped when derived or inherited)
  |        recommended tile + alternates + Choose for me + See all styles
  |        <-- first visuals on screen here, before any generation
  |
  +-- 4. CREATE FIRST LOOKS · CONFIGURED SPARK CHARGE
  |        quantity + charge + balance after on the action itself
  |        confirmed -> visual job queued -> story conversation opens
        |
        +================= PARALLEL =================+
        |                                            |
        | STORY TRACK                                | FIRST-LOOK TRACK
        | - collect the rest of the brief            | - render; reveal inline in chat
        | - draft, co-create, or the reader writes   | - keep / tweak / re-source / restyle
        | - receipts separate said from inferred     | - keeping a look approves that
        | - explicit request, or visible Create the  |   character, likeness included
        |   story action; never readiness/timeout    | - remaining cast in a named queue
        +===================+========================+
                            |
                     STORY READY + LOOKS KEPT
                            |
                     CAST SUMMARY BEFORE PAGE ART
                     (review required only for unresolved,
                      stale, or never-reviewed subjects)
                            |
                     CREATE REFERENCE SHEETS · CONFIGURED CHARGE
                            |
                     PAGE PLAN
                     - system creates / co-designs / reader edits
                            |
                     CREATE N ILLUSTRATIONS · CONFIGURED CHARGE
                     - stream results; retry only failed/stale units
                            |
                     FLIP-THROUGH + PRINT PREFLIGHT
                            |
                     PRINT / EBOOK / KEEP EDITING
```

## Non-negotiable checkpoints

Involvement does not remove safety or cost checkpoints. Always stop for:

- consent before using a real person’s likeness photo;
- a book-style choice, or an explicit **Choose for me**, before generating any
  character, setting or object sample when the book has no style;
- a conflict between uploaded character art styles;
- a recurring subject whose look has never been reviewed, before page art depends
  on it;
- an informed confirmation before every billable image-generation action or batch;
- an affordability gate whenever the configured charge exceeds the available
  balance;
- an account moment only when a durable account is needed to preserve work across
  devices, buy Sparks, or order;
- print preflight and checkout.

Everything else follows the stored cadence.

Checkpoint hierarchy:

- **Hard**: consent, missing book style, an unreviewed or ambiguous identity,
  destructive replacement, rights and safety concerns, informed confirmation of
  every configured generation charge, affordability and payment, print and order
  approval. Cadence never skips these.
- **Key**: story ready, cast summary, page-plan approval, final page set. “Check
  key moments” pauses here.
- **Soft**: optional ideas, first looks, defaults, and recoverable background work.
  Only “Ask me each step” normally pauses here.

A checkpoint the reader has already answered for a specific subject must not fire
again for that subject. Keeping Maya’s look is the approval for Maya; the cast
summary may report her, but it may not re-ask.

Changing involvement applies prospectively. It does not cancel completed work or
silently reinterpret prior approvals.

## Conversation principles

1. **Ask in prose, answer with the easiest control.** Free text collects names,
   ages, relationships and story wishes together. Closed choices use cards or
   visual tiles.
2. **Collect once.** Infer reading age from the cast, book language from context,
   and theme or setting from the same sentence.
3. **Show before you ask for more.** Put real artwork on screen in the first few
   turns — style examples cost nothing — and get the visual job started before
   opening a second topic. One thread at a time until something is rendering.
4. **Never narrate work that has not started.** “I’m drawing Maya” is true only
   once the job is queued.
5. **Do not ask the reader to configure the product.** Involvement has one control
   and a working default; checkpoints ask the real question in context.
6. **Keep automation interruptible.** Chat stays writable during generation. A new
   instruction updates the relevant artifact and marks only its dependants stale.
7. **Results live in the conversation.** A portrait, a page or a concept appears
   inline in the stream on every screen size. The panel is for sustained work, not
   for a second copy of the same card.
8. **Automation means fewer stops, not fewer rights.** Every system-created
   artifact stays editable in the same studio.

## Master journey

### 1. Choose how to begin the words

Ask one question with two primary options:

- **Guide me**: collect the brief conversationally.
- **I already have words**: paste or open the manuscript immediately, derive what
  can be learned from it, and keep guide assistance available.

Extraction from a paste is not the same confidence as a reader answering "Who is
in the book?" directly, so it must not silently start rendering. Show a short
receipt instead — "Found Maya, 5, and Leo, 3 in your story" — with **Start their
first look** and **That's not quite right** rather than assuming the extraction is
correct and queuing a job unprompted. One tap confirms it; the receipt is not a
second intake form.

**That's not quite right** turns that same receipt into an inline correction
state. Each extracted subject can be renamed, have an age corrected, be removed,
or be supplemented with **Add someone**; the composer remains available for
natural-language corrections such as “Leo is 4, not 3”. The original manuscript
is not edited and the entire manuscript is not reparsed after each correction.
**Use these details** returns to the same point and starts the cast/style steps.
The full manuscript panel opens only when the reader chooses to change the words
themselves.

An optional secondary entry, **Start from a character**, supports returning
families and character-first books without making the opening question heavier.

The internal legacy distinction between “guided” and “co-write” should not be a
reader-facing third option. The richness of the supplied brief can select the
appropriate prompt behaviour.

While the reader is still typing, the entry screen can show the style gallery.
That costs nothing, sets expectations about the product’s quality, and means the
very first screen already contains illustration.

### 2. Names and ages

Ask:

> Who is in the book? Names and ages are enough. You can also tell me how they
> are related and what you would love to happen.

Extract and show receipts for:

- names and ages;
- relationships or roles;
- occasion, setting, theme and must-include details;
- exclusions or sensitive subjects to avoid (a missing product field today);
- optional appearance details.

Only chase required missing information, by name.

This beat ends as soon as there is at least one named subject. Everything else in
the brief can arrive during beat 4, while the first look renders.

### 3. One cast card for everyone named

Not one question per child. A single card lists every named subject and asks once
how they should look:

- **Use a photo** — including one photo containing several of them, with face
  selection assigning people to names;
- **Use existing artwork** — upload now; a reusable-character library can later
  appear in the same slot;
- **Describe them** — free text plus optional appearance chips;
- **Let me invent them** — story facts and safe defaults.

Sources may be mixed per subject, and a subject may be set up separately if the
reader prefers.

**A bulk source action needs a default, or it is ambiguous.** Tapping "Use a
photo" once for the whole card cannot mean the same thing for Maya, for the family
dog, and for the lighthouse in the story. The default: a bulk photo action applies
only to the named human subjects visible on the card; any non-human or unnamed
subject (a pet, an object, a setting) visibly becomes **Create from story · Use
photo instead** and is overridable per tile. Human tiles visibly become **Using
this photo**. If the reader's photo also shows the dog, the same
face/subject-selection step that assigns children to names lets them assign the
dog too — it is not a reason to add a second upload flow. Suggested assignments
must remain confirmable; the product never silently identifies one person as
another. A single clear face for a single human still skips assignment entirely.

**Consent and upload are one action, not a gate before one.** The permission
checkbox appears on the same tile as *Use a photo*, alongside the native photo
picker — never as a separate screen the reader must clear before they are allowed
to upload. Face-to-name assignment is conditional, not a standing step: it only
appears when a photo contains more than one recognizable face. A single clear
photo of one child skips it entirely.

**The style tap does not wait for the photo to finish uploading.** Beat 3's style
tiles are catalog examples, independent of any upload or generation job, so they
can be shown and answered while a photo is still transferring or a description is
still being typed. This is what keeps the photo path close to the same length as
the describe/invent paths — the reader answers "do you have a photo" and "which
look" in whichever order is fastest for them, and the two do not serialize.

Parents of siblings and twins are hyper-sensitive to unequal treatment, and the
common real-world artifact is one photo with both children in it. Naming everyone
on one card before any rendering starts is what prevents “did it forget my son?”.
The render queue may still be sequential; the *intake* may not be.

For a character-free book this card asks for a setting, an important object or a
style sample instead.

### 4. Book style — one tap, on real artwork

The book style is a required input to visual generation. It is resolved in one of
three ways, in this order of preference:

1. **Derived** from uploaded character artwork, then confirmed — “Use this
   drawing’s style throughout the book?”. The reader never browses a catalog they
   did not need.
2. **Inherited** from the book when it already has a style.
3. **Chosen**, as a one-tap confirmation rather than a browse: a recommended tile
   pre-selected beside three to five alternates, each rendered from the catalog’s
   customer-facing example images, plus **Choose for me** and **See all styles**.

There is no provisional house-style fallback and no **Not now**. **Choose for me**
saves a real book style. If extraction is ambiguous or fails, the required picker
replaces the derived-style proposal. If several uploaded artworks conflict, ask
which style the whole book should use while preserving each character’s identity.

A parent uploading a photo is at peak anticipation, and choosing between media
they have never seen their child rendered in is a genuine source of anxiety. Two
things defuse it: the tiles are real illustration rather than words, and **Try
another style** sits on the first-look result card, so the choice is cheap to
revise once they can see it.

**Recommendation needs catalog metadata, not inference.** `AGE_BAND_FRAMEWORK.md`
§9.7 is explicit that audience guidance constrains a style but must not pick one on
the reader’s behalf, and that a by-age recommendation belongs in the art catalog as
compatibility metadata. `ArtStyleDefinition` has no such field today, so this is a
required addition: optional recommendation metadata on the style definition,
admin-editable like the rest of the catalog. Until it exists, mark one style
recommended manually — the interaction is the same one tap.

### 5. Start the visual, then open the story

Only when a job is queued or running does the guide open a second topic.

The progress card shows immediate evidence — the uploaded source, the chosen style
tile — then honest staged progress (“Reading the photo”, “Drawing Maya”). The
composer stays live. Closing the tab is safe.

The first result is revealed **inline in the conversation**, labelled a first look,
and offers:

- **Keep this look** — the approval for that character, likeness included;
- **Tweak it**;
- **Use another photo or artwork**;
- **Try another style**;
- **Recreate later**;
- version history.

**Keep this look approves only the current appearance. It never starts or charges
for another generation.** Once the required looks are ready, the cast summary
offers the separately priced action **Create N reference sheets · X Sparks**. The
configured cast batch starts only after that informed action. The current product
generates full reference sheets; portrait-first is a proposed latency optimisation.

For several equally important children, name the queue (“Maya is ready; Leo is
next”) so the first result does not imply a ranking, and keep every child visible
on the cast card throughout.

First looks are a **soft** checkpoint (see the checkpoint hierarchy above), so
under the default involvement, **Keep this look** does not block. A reader who
moves on to talk about the story without tapping it is treated as having kept the
look — the button is there for someone who wants to steer, not a gate everyone
must clear. Only "Ask me each step" turns it into an explicit pause.

**Recreate later** must not become a silent trap. It creates a visible pending item
in the artifact outline, and the page-art cost gate must state plainly that the
pages will use the current look unless it is changed first.

### 6. Cast summary before page art

Before page illustrations depend on the cast, show the whole required set once.

This is a summary, not a second approval round. Review action is required only for
subjects that are unresolved, stale, or have never been reviewed. A reader who kept
each look as it arrived passes the review straight through, which is what makes
“Make it for me” honest. A separately priced reference-sheet batch may still need
an informed generation action; that is purchase authorization, not another visual
approval.

Copy is concrete and forward-looking: “Ready to put Maya and Leo into the story
scenes?” — not “complete visual lock”.

If full reference sheets have not already been generated, the summary contains
one scoped billable action — **Create N reference sheets · X Sparks** — with the
balance afterwards. Approval of a look and purchase of its reference sheet remain
separate decisions.

### 7. Your people versus everything else in the story

Story analysis produces the subjects the *story* needs, which is not the list the
reader named. A grandmother, a dog and a lighthouse can appear without ever having
been discussed.

Treat them as two groups with different ceremony:

- **Your people** — the named cast. Photo-sourced, individually approved, shown
  large.
- **Everything else the story mentions** — generated, grouped, lower ceremony,
  editable on request.

Never present eight unfamiliar subjects in the same grid, at the same size, as the
reader’s children.

### 8. What consistency means

“Lock” promises pixel-identical characters across twelve pages, which an image
model will not deliver. Poses, angles and light will vary.

Say so once, in the cast summary, in plain language: these sheets are the reference
every page is drawn from, so the character stays the same while the scene changes.
One honest sentence here prevents a whole class of complaint later.

## Artifact flows

### Story

**Create it for me**

Generate or accept the story, run quality and age checks, then continue. The reader
may interrupt or open the manuscript at any time. Whether the flow pauses after the
draft depends on cadence.

Drafting starts on an explicit settled signal, never on `isBriefReady`, inactivity
or a timeout alone. Names and ages satisfy the brief while the reader may still be
typing the occasion, so an eager draft is a visible misunderstanding. An explicit
request such as “write it now” starts immediately. Otherwise, once the minimum
brief is ready, the guide shows a short receipt with **Create the story** and
**Add another detail**, while leaving the composer open. It does not ask again
when the reader already gave an explicit generation instruction.

**Help me create it**

Offer concepts or an outline, create a draft from the reader’s choices, and keep
revision actions in the manuscript panel.

**I’ll provide or edit it**

Open the editor immediately. Offer optional AI actions: outline, continue, shorten,
simplify, age-check. The reader marks the manuscript ready.

Readers who chose “I already have words” begin here, and may later ask the guide to
finish or rewrite selected text.

### Characters

**Create them for me**

Use the supplied sources, derive or inherit the style, and create the remaining
recurring subjects. Each named person’s look is still shown and kept individually.

**Help me create them**

Generate reference portraits and sheets, show the cast shelf, and support individual
revision instructions.

**I’ll provide or direct them**

Open each character editor. The reader chooses photo, artwork, description or
invention and approves each required recurring subject.

### Pages

**Create pages for me**

Generate the page plan and every required illustration. Show live progress, then
open the flip-through.

**Help me design pages**

Show scene summaries and the page plan, accept structural direction, then render.
Cadence determines whether plan approval is a blocking pause.

**I’ll edit the pages**

Open the page workspace. The reader edits scene text, layout, assets and individual
image instructions, then generates or regenerates selected pages.

## Book shape: format, length and title

Page count is currently emergent from the screenplay and only validated against the
age band’s density, and book size and layout live in the terminal review step. That
means format, length and price are discovered after the art is paid for.

Do not turn the first visual reward into two more mandatory questions. As soon as
the brief supports a default, show a compact, non-blocking plan:

> Book plan: 24 pages · 8×8 hardcover · Change

The plan remains reachable from the facts strip, informs story length, and is
repeated at the page-generation cost confirmation. Tapping **Change** opens length
and format controls; accepting the default needs no separate tap. An untouched
default is labelled **Default**, not “You said” or “I inferred”. Unsupported
format, language, print-region and shipping combinations are surfaced before paid
page art, not at checkout.

Offer the title at the story checkpoint rather than silently adopting the draft’s
own title. It is one of the most personal decisions in the book and currently the
reader is never asked.

## Money and account

Both are classic drop-off points, so neither may rely on a surprise modal.

**Charging is configuration-driven.** Every configured image-generation action is
charged; nothing is called free merely because it is a preview. Catalog style
examples cost nothing because they do not invoke generation. A generated first
look is zero-cost only when its configured charge is zero or an explicit allowance
covers it.

- The action that causes generation states exactly what will be created, its
  configured Spark cost, the current balance and the balance afterwards:
  **Create 2 first looks · 8 Sparks** or **Create 12 illustrations · 48 Sparks**.
- When an allowance or promotional balance pays, say **Uses 8 included Sparks**,
  not “free”. Show the monetary top-up path when the balance is insufficient.
- Approval, editing, uploading and navigation never imply a second paid action.
  In particular, **Keep this look** does not generate a reference sheet.
- One confirmation authorizes one named generation or batch. There is no extra
  cost-gate screen when the scoped action itself contains the required disclosure.
- Preserve the confirmed quote. If configuration changes before enqueueing, honor
  the quote or ask again; never silently charge more.
- Reserve at most the confirmed quote, then charge only successful usable outputs.
  Failed or moderated units are not charged; cancellation charges completed units
  only and releases the rest. A partial batch receipt separates successful charged
  units from failed uncharged units. A retry is a new configured generation action
  and shows its charge before enqueueing.
- The completion receipt shows what was created, what was charged and what was
  released.

**Anonymous work remains first class.** The existing anonymous Firebase account
owns the project and private uploads, so intake, drafting and generation may
continue while the reader has an available balance. Do not require a durable
account before the story draft or solely because the work has become emotionally
valuable.

Ask for a durable account only when its capability is needed: preserving the book
across devices, buying Sparks, or ordering. Frame it as **Save your book and
continue**, preserve the transcript, draft, uploads, scroll position and pending
action, and prefer one-tap platform providers plus passwordless email; password is
a fallback. Optional marketing consent is separate and never a condition of
continuing. Email verification must not block continued studio work. If the
reader already confirmed an exact charge before authentication, the action may
resume automatically after sign-in; otherwise return to the same confirmation.
Signing into an existing account must merge or transfer the guest project without
loss or force one clear conflict choice.

**Likeness retention does not require sign-in.** Source photos are private,
attached to the anonymous account, deleted as soon as the likeness pipeline no
longer needs them, and hard-expire within 24 hours. Consent copy says this in
plain language and offers immediate deletion. The first-look implementation must
define whether the source can be deleted after that successful result or remains
necessary for the full reference sheet; the shorter safe lifetime wins. If a
source expires, preserve completed work and ask for a replacement only when a new
likeness generation genuinely requires it.

## Communication rules

- Call the early result a **first look** until it is kept. Do not imply that a
  photo-derived image is already an exact likeness.
- Say what is happening and why, and only once it is true: “Maya is being drawn —
  while that happens, what should the day be like?”
- Distinguish **You said**, **I inferred**, **Default** and **Book choice** in the
  facts strip.
- Replace generic actions (“Start”, “Carry on”, “Update it”) with scoped actions
  (“Create 12 page illustrations · 48 Sparks”, “Retry 2 pages · X Sparks”,
  “Update Maya and 6 pages · X Sparks”).
- Explain mandatory pauses before they happen, especially after “Make it for me”.
- Never describe a background job as finished until the project contains the result.
- Use neutral recovery copy. “Try another look” is better than telling a parent that
  their child “looks wrong”.
- For several heroes, narrate the queue without ranking them.
- State what a reference sheet guarantees and what it does not, once, in plain
  language.
- When recreation affects existing work, state the exact impact and configured charge
  before enqueueing it.
- A cost disclosure sits on the action that causes the cost; approval actions never
  hide generation.
- One voice at a time. See the speech queue below.

## One voice: the speech queue

Two tracks plus a clarification question can finish in any order, and
`nextGuideSay` dedupes per component rather than across tracks. The guide therefore
needs a single queue with a defined priority:

1. a blocking error or a required confirmation;
2. an answer to what the reader just typed;
3. a result that has landed;
4. the next question in the flow.

At most one line is spoken per change. Lower-priority items are collapsed or
dropped rather than stacked, so a finished portrait, a finished draft and a
follow-up question never arrive as three bubbles.

## Surfaces: where things appear

The chat is persistent and is where decisions happen. Results appear **inline in
the stream on every screen size**, desktop included — one portrait card, one
approval, one place to act.

The panel is for sustained work, and opens for:

- the manuscript, while writing or reviewing the story;
- the full style gallery, when the reader asks to see all of them;
- a character’s reference sheet, for close inspection;
- the page plan and the page canvas, while designing or editing pages;
- the flip-through and print preflight.

Behaviour:

- Auto-open for a required action, an error, or an explicit request — not for a
  result that already appeared in the chat.
- Peek without blocking for background progress.
- A reader close is respected; do not reopen for ordinary progress.
- Auto-collapse after approval on narrow screens.
- Keep a compact persistent strip for facts, progress and involvement.

**Targeting, without scolding.** When the panel shows one artifact and the guide
asked about another, do not warn and do not block the send. Show a quiet tag above
the composer — `Replying to: Maya’s look · talk about Story instead` — so “change
this” always has a visible, changeable subject.

**Mobile.** The Book tab is the reading and inspection surface: the flip-through,
a full reference sheet, a page up close. It is not where portraits get approved.
Results stay in the conversation, so the reader never has to leave the thread,
tap a tab, act, and come back. Badge the Book tab only for work that genuinely
lives there.

## Change and recovery

Every change is classified by its blast radius:

- Story fact changed: the story may become stale, then cast analysis, page plan,
  pages.
- Character look changed: that reference and its dependent pages become stale.
- Page instruction changed: only that page becomes stale.
- Style changed: all generated character and page art becomes stale.

The guide should:

1. acknowledge the applied change with a receipt;
2. summarize affected work once;
3. offer **Update affected work** and **Keep current work**;
4. regenerate upstream-first, and only what is affected;
5. preserve version history and allow jump-back.

A single message can change two artifacts at once — “move it to a lighthouse and
make Maya’s hair curly”. The receipt names both changes, and the staleness notice
groups both cascades into one explanation rather than firing twice.

Failure recovery is local:

- interpretation failure: ask one targeted question;
- upload failure: retry, replace the source, describe, or invent;
- generation failure: retry only the failed units, or edit the input;
- unaffordable batch: explain the gate before enqueueing;
- closed or reloaded tab: resume from project and job state, not transcript
  position.

## Ready-to-print finish

Completion means a manufacturable book, not merely generated pictures.

The final panel verifies:

- the story and all required page text are present;
- title and cover are set;
- all required illustrations are current;
- no text overflow and no unresolved stale artifacts;
- image quality is sufficient for the selected format;
- physical page count, binding and trim are valid;
- price is visible before checkout.

Anything here that can be checked earlier should be: format, length and
fulfillment region are known long before the art is rendered, and discovering them
at preflight means discovering them after the money is spent.

Then offer:

- **Order printed book**
- **Get ebook** (when enabled)
- **Change something**

An optional dedication or gift message is a product gap worth adding before print.

## Common journeys

1. **Fastest gift**: Guide me → names and ages → cast card with one photo → style
   in one tap → first looks kept as they arrive → Make it for me → flip-through →
   print.
2. **Writer, automatic art**: I already have words → manuscript ready → cast card →
   style → system creates Characters and Pages → review and print.
3. **AI story, art-directed characters**: system creates the Story → the reader
   directs Characters → system creates Pages.
4. **Story editor only**: the reader edits the Story → system creates Characters and
   Pages.
5. **Page designer**: system creates Story and Characters → the reader edits Pages.
6. **Review everything**: I’ll do it myself → approve story → approve each look →
   approve the page plan → approve the flip-through.
7. **Existing character universe**: Guide me → upload or reuse artwork → style
   derived and confirmed → missing cast created in that style.
8. **Mixed sources**: a photo, existing artwork and a described pet → one book style
   resolved → each look kept as it arrives.

## Current implementation fit and gaps

Existing foundations to reuse:

- the guide catalog, playlist and derived cursor;
- the shared project as source of truth;
- manuscript, style, cast, page and preview canvases;
- photo consent and short-lived likeness storage;
- source-art upload and style extraction;
- batch cast and page jobs with progress;
- confirmation widgets, receipts, checkpoints, staleness and retry;
- Sparks estimation, which already supports a per-batch cost figure.

### Engine work this flow requires

These are not widget changes, and they decide the schedule:

- **The cursor is single-valued.** `nextGuideStep` returns one component, and
  `guideProgress`, `coveredGuideSlots` and `nextGuideSay` all assume it. Either
  extend the cursor to a primary component plus background tracks, or keep the
  first look entirely off-cursor as an effect. The second is cheaper but makes the
  artifact outline lie about what is happening.
- **The catalog chain contradicts the new order.** `art-style` declares
  `requires: ["story-approve"]` and `cast-looks` requires `art-style`, so
  `repairOrder` will keep pushing any pre-story look component back below the
  story. `art-style` must lose that requirement, and a character-look component
  must sit above the story with `requires: ["story-cast", "art-style"]`.
- **There is nothing to draw before the story exists.** Cast references come from
  `analyzeStory`, which takes story text, and sheets are generated per `Anchor`
  with likeness and source art living on the anchor. The first look needs a
  provisional subject, plus an explicit reconciliation rule: when analysis produces
  the real anchors, match by normalized name, transfer the likeness, source art and
  generated sheet onto the matched anchor, and keep an unmatched provisional subject
  visible rather than dropping it. This rule is the difference between the feature
  feeling magic and losing a parent’s photo.
- **The story draft needs a settled signal.** `isBriefReady` goes true on names and
  ages alone.
- **The guide needs one speech queue**, because dedupe is per component and two
  tracks can complete in any order.
- **The art catalog needs recommendation metadata** so the style step can be one
  tap without inferring a style from the age band, which §9.7 forbids.

### Other required additions

- per-artifact ownership plus cadence, written by one involvement control;
- a unified cast-intake component covering several subjects and one shared photo;
- portrait-first generation, or an equivalent fast preview;
- described and invented-look chat widgets;
- an appearance slot, so “make Maya’s hair curly” has somewhere to land;
- reusable characters from previous books;
- “avoid” story constraints;
- page-plan approval as a distinct checkpoint;
- scoped configured-charge gates for first looks, the cast batch, pages and
  regenerations, with stable quotes and successful-unit settlement;
- a compact, editable default book plan for format and length, plus title as a
  reader-facing choice;
- print preflight status in the guide;
- an optional dedication;
- configuration-driven pricing disclosure on every generation action, charge
  receipts, and capability-driven account moments;
- one-tap platform authentication and passwordless email, with lossless guest
  project transfer or merge;
- a customer-visible guide/manual switch after migration (today’s toggle is
  admin-only).

### Current behaviour to correct while implementing

- Guide open creates a guided brief automatically, so the story-mode component is
  already satisfied and the reader never sees a real opening choice.
- Photo, source artwork, appearance descriptions, story revision and per-page
  editing exist in studio panels but are not first-class guide actions.
- Approving a story advances the stage but does not force the art-style gate the
  way the legacy Story workspace does.
- Artwork-derived style and style-conflict resolution are not guide components.
- A page plan counts as satisfied as soon as it exists; there is no review
  checkpoint.
- Guide generation actions are batch-oriented and reader-started; targeted effects
  and cancellation are not represented.
- Chat must keep the closed-world rule: uploads and artifact completion use trusted
  UI actions, never model-proposed patch values.

## Edge cases that need explicit product behaviour

### Early-visual race conditions

- **A first look finishes after its inputs changed.** Compare provenance against the
  current age, source and style before revealing it. Mark or discard stale results;
  never flash a portrait the reader already corrected.
- **The reader changes the source while a job is queued.** Cancel when possible;
  otherwise keep the late result as an older version and do not make it current.
- **The visual fails or is moderated while story work succeeds.** Keep the story
  moving, and offer retry, another source, description, invention, or a style sample
  so the product still shows visual progress.
- **The first render is slow.** Show the source and the chosen style tile
  immediately, then honest staged progress. Never a bare spinner that blocks chat.
- **The first look follows configured charging.** See "Money and account" above:
  the generation action shows the configured cost and resulting balance before it
  queues. The preceding catalog artwork remains the zero-cost early visual reward.
  Never claim that generated previews are free unless configuration actually makes
  them zero-cost.
- **Repeated recreation becomes a slot machine.** After a few retries, encourage a
  specific tweak or a different source rather than another blind reroll.
- **The reader chose “Recreate later” and never returned.** The pending item stays
  visible and the cost gate says which look the pages will use.

### Cast and identity

- Several children, shared ages, ages in months, twins, pets, adults, fictional
  protagonists, and books with no personalized child.
- Several equal heroes: name the queue, and keep everyone visible on the cast card.
- One photo containing several people: assign faces to names rather than asking for
  a second upload.
- Two characters with the same name: require a role or a stable internal identity.
- Several photos of one person, poor or expired photos, and conflicts between photo
  and description: state which source wins.
- Do not infer ethnicity, disability, body shape or other sensitive appearance from
  a name. Invented looks must be explicitly editable.
- A character changes clothing, age or form during the story: keep a canonical
  identity and model scene variations separately.
- Story edits add or remove cast members: re-run analysis, explain the change, and
  never delete approved references silently.
- Analysis produces subjects the reader never named: group them separately from the
  named cast.

### Comfort, rights and safety

- Someone uploading a child’s photo may not be the guardian. Consent copy must cover
  authority, private one-purpose use, deletion after the likeness pipeline no
  longer needs the source, the 24-hour hard expiry, immediate deletion, and the
  equally capable no-photo path. Anonymous-account ownership is sufficient; a
  durable sign-in is not required for retention.
- Uploaded copyrighted artwork, celebrities, public figures, branded characters and
  requests to imitate a living artist need a clear redirect rather than a vague
  generation failure.
- Unsafe, frightening, discriminatory, sexual or developmentally unsuitable content
  needs child-specific handling and actionable recovery copy.
- Sensitive family details may be valid story context without becoming visible
  illustration details.

### Story, layout and fulfillment

- A message that changes two artifacts at once needs one grouped receipt and one
  grouped staleness notice.
- A pasted story contradicts collected names or ages, or has no obvious
  protagonist: show the contradiction rather than silently overwriting facts.
- Stories too long or short for the format: offer to adapt the text, change the
  length or format, or let the reader edit.
- Unsupported language, format, print region or shipping destination should be found
  before the final emotional commitment.
- Print defects found at layout (overflow, bleed, low resolution, invalid page
  count) must point at the exact fix.
- Admin catalog changes that invalidate an older style or audience choice keep the
  old book readable and ask before migrating.

### Session and control

- Concurrent devices need revision-conflict handling; independent changes may merge,
  conflicting versions need a choice.
- A book begun in the other authoring flow resumes from artifact state, not from
  intake.
- Changing involvement applies prospectively and must not cancel paid or completed
  work silently.
- “Not now”, “Choose for me” and “Leave this out” are different outcomes. Keep them
  few and distinct; “Revisit later” only exists where a real reminder does.

### Accessibility, device and network

- A visual-first product still needs useful generated-image descriptions. Approval
  cannot depend on colour or a thumbnail alone.
- Async arrivals need an accessible announcement and must respect reduced-motion
  preferences.
- On mobile, results stay in the conversation; badge the Book tab only for work
  that lives there.
- Large phone photos, HEIC conversion, rotation metadata, slow uploads and
  low-memory devices need visible preprocessing and retry states.
- Low bandwidth or an offline interruption must preserve the typed message and the
  upload, and resume durable jobs without duplicate charges.
- Long names, non-Latin scripts, right-to-left stories and translated button copy
  need layout and print-overflow testing.
