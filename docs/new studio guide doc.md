# New studio guide

The Chat presentation. The Steps studio stays as it is. Shared editors, jobs, and the project stay shared. This file is the authoritative UI and behaviour contract from an empty book through the order button. `STUDIO-GUIDE-FLOW-DESIGN.md` owns checkout after that button; its earlier journey material is supporting rationale only where it does not conflict with this file.

## UI

The studio is the full viewport. No centered max-width frame.

**Chat, left, once the book exists.** A fixed column, 26–30rem. It does not grow on a wide monitor. Guide lines stay near 65 characters.

**Book pane, right, once the book has something to show.** The rest of the window. The name of the region is the book pane. What it shows is the book. Not a panel, not an artifact list, and not a canvas. `canvas` remains the code name for which view is active.

The page inside the book pane stays at the book's real aspect ratio, centered. The manuscript stays near 65 characters. Extra width becomes margin around the book.

When the book has nothing to show, the pane is absent and the chat sits in the middle of the window. It does not stay pinned left beside an empty room. The first fact brings the pane back and returns the chat to the left: a name grows a cover plan, "I'll use my own words" opens the manuscript, a chosen style fills the pane. Page focus is the same idea in the other direction. The surface that holds the work takes the room.

A control that cannot be used is absent. It is not shown disabled.

Every change of place, size, or presence is a smooth transition. The book arriving, the chat centering, a view changing aspect, a well appearing, and a picture landing all move. Motion explains the change. It is quick, modern, and quiet. Reduced motion plays the same change without the travel.

### Chat

Cream ground, same as the book pane, split by a 1px ink hairline. No glass, no mesh, no second theme.

- The guide speaks in open type, Fredoka, about 15px, no bubble.
- The reader's line is the only bubble: a compact right-aligned chip, ink fill, hairline, Inter. Undo, Copy, and Edit sit on that line and work on touch, not only on hover.
- A receipt is one small row under the guide line, including when two things changed. The value is dark. An inference is named once ("Leo is 4, inferred"). No card, and no facts strip.
- A new line rises about 8px and fades in, about 200ms. Nothing bounces.

Before the opening line, a new book shows one quiet information row: "Image generation uses Sparks. You'll see the estimate before anything is drawn." It is orientation, not approval for a later charge. It does not return when the book is reopened. There is no Sparks balance or billing header. Every action that spends Sparks still names what it will draw and shows the estimate.

The composer is the one memorable object. White field, 1px ink ring, send as a small ink circle with a white arrow. The context chip sits inside the field, on the left, and can be cleared. The chat language sits there too, as a short code such as `de-DE`. Tapping it switches the language and does not restart the book. The placeholder is the live question, in one short line.

Violet is only the moment work is running. A 1px violet edge traces the composer ring once, then rests. The same edge appears on the book object that is being drawn. Coral is only the paid action. No typing-dot row. The ring is the signal.

### Choices

A choice that is the whole task sits in the middle of the chat, large, and the composer is absent. The opening line is "Let's create a storybook." The choices are **Guide me** and **I'll use my own words**. Two choices, and nothing else. "Guide me" brings the composer and the style artwork together, because the next answer is a sentence and the look can be chosen in parallel. "I'll use my own words" brings the manuscript, and the story is typed or pasted there. The composer stays hidden until they ask the guide for something.

A short choice beside an ongoing book sits in the composer well, directly above the field. Not inside the textarea. Not left behind in the scroll. Typing still answers it, so the composer stays.

A large set does not go in the well or in the thread. A recommended style plus a few alternates fits the well, and the chosen artwork is large on the book. The full catalog is the book pane: a horizontal row, the chosen plate large, the others smaller. Choosing one commits, and the pane settles back to that plate. If the book has not arrived yet, that gallery is the centered stage, with one guide line above it.

### Composer well

The thread holds prose and receipts. A widget has three states:

1. **Live.** Full size, in the well.
2. **Settled.** One receipt line.
3. **Superseded.** Still readable, no dead buttons.

A tile is a short label and a selected state. No explanation under it, and no extra actions unless skipping would trap the reader.

Cast intake is one card for everyone named. Equal tiles, no ranking. Choosing a photo updates the tile in place. Consent is on that tile. One clear face skips assignment.

Style is a recommended tile plus a few alternates, real artwork, or the look already taken from uploaded artwork. "See all" fills the book pane. A portrait is large on the book and lands on the plate. Moving on keeps it. A change is the redraw in Changing a picture. Later pages do not dump a full illustration into the thread. A thumbnail receipt scrolls the book pane to that spread.

### Book pane

One quiet room. One white object, one soft shadow. A printed page is almost sharp, about 2–4px. A portrait may be a softer rounded rectangle, at illustration proportions. The cover is a still book, capped near 360px wide. It does not tilt on hover.

A view switch sits at the top center: Cover, Style, Story, Cast, Pages. A label exists only once that part of the book exists. The active label is darker. No icons, no counts, no track.

Names, ages, the style, and the story are the book. They are not listed beside it.

- **Cover.** The book, then the title. A subtitle and an author are lines under it, empty until typed. Blank before there is a title.
- **Style.** Artwork full-bleed, name and one short line beneath. "See all" is a horizontal row: the chosen plate large, the others smaller.
- **Cast.** One large plate, name and age beneath, the others in a short row. Choosing one promotes it.
- **Story.** While the story step is current, one printed page, large, at the book's real shape. The words sit where they will be printed. The other shapes and the other word arrangements are a smaller row beside that page. The chosen one is the page. Title in Fredoka. Body about 17px. Click a paragraph and type. After the pages start, the row is gone.
- **Pages.** One spread. A page number under it. Previous and next appear on hover. Arrow keys turn the page, and so does clicking either half.

Working, stale, and failed show on the object. While a picture is drawing, the plate keeps the violet edge. Finished pages appear on the spread. The chat does not grow a status card. A print problem selects that page or cover, and the well offers the fix.

Changing view animates the frame to the new aspect, about 250ms. A new picture crossfades. Reduced motion: it just appears.

**Page focus** is the only mode that hides the transcript, and only when the book pane would drop under about 960px. The spread grows. A filmstrip about 64px tall sits along the bottom. Handles appear on the thing that was clicked. The same composer docks on the book. "Conversation" opens the thread as an overlay. Leaving focus restores the column and its scroll position. Reading, the story, and style leave the column up.

### Mobile

Before the book has anything to show, the screen is the centered choice, and the composer is absent. After that, the screen is the book. The composer docks at the bottom when there is something to type. The live choice opens as a sheet, with the book still visible above it. No Chat / Book tabs.

## UX

As few clicks as the decision allows. Do not confirm a step that can be undone.

- Ask in one or two short sentences. Answer with the easiest control. Free text collects names, ages, and wishes together. A choice that is the whole task sits in the center of the chat. A short choice beside the book sits in the well.
- A cheap, reversible choice commits on the tap. The recommended option is focused, so Enter on an empty field accepts it. Style is one tap, invokes no model, and spends no Sparks. Every generated picture uses the saved style.
- Selecting a source, style, subject, or instruction never spends Sparks. The scoped generation button names what will be drawn, shows the estimate, and is the one commit. The line says the charge is based on token use, can come out a little lower, and will not be higher. No second modal.
- Typing is always a valid answer while the well is open.
- The story is the editor while the story step is current. No Edit toggle, no Done, no second prompt. It autosaves. Small changes apply immediately, with undo. A rewrite of the whole story may show an inline diff. Leaving a step locks it. Opening it again still shows it.
- Page layout is the one focus mode. "Make the moon larger" happens from the composer while looking at the spread. The canvas is for what a sentence cannot do.
- Clicking the book sets the context chip ("Page 4"). The chip is the only way to retarget. A picture the book has already drawn is not dragged into the field. Send is never blocked. No warning banner.
- The guide may move the book pane to what it is talking about. The reader may look somewhere else.
- Facts live on the book. A receipt records an inference once. Involvement ("Make it for me / with me / myself") stays in a quiet menu. Checkpoints ask the real question in context.
- Show real artwork before asking for more. Do not say work is happening until the job is queued.
- One question at a time until something is rendering. After that, story and first looks run together. Chat stays writable during generation.
- Under the default involvement, moving on counts as keeping a look. Keep is for someone who wants to steer.
- Collect a fact once. Infer age band, language, and setting. Do not ask the reader to configure a pipeline.
- Ordering is the paid action on the composer once the book can be printed, not a link under the art.

### Changing a picture

A picture the book has already drawn is not dropped into the composer. A drop is a new photo or a new drawing, and it lands on a plate.

They tap the picture. The chip becomes Maya, Cover, or Page 4. They type the change in the composer. If the sentence already names Maya, the tap is unnecessary. If several people are in view and the sentence names nobody, the well asks which name. Nothing redraws until the chip is one target.

Typing the sentence does not spend Sparks. The button under the field becomes "Redraw Maya · about N Sparks," or "Redraw this page · about N Sparks." That tap redraws only that picture. The same path is a portrait from the moment it lands, the cover picture, and a page. It is available only while that step is still open.

### Photos and likeness

Consent and upload are one compact action on the person's plate, not a separate screen. The copy says that the uploader has authority to use the photo, the source is private and used only for likeness, it is deleted when the likeness pipeline no longer needs it, and it hard-expires within 24 hours. **Delete now** remains available after upload. Deleting or expiring a source keeps completed generated work; a replacement is requested only when a later likeness action genuinely needs one.

The picker, local preview, upload progress, and consent live together. One clear face for one person skips assignment. Several recognizable faces open a conditional face-to-name assignment; a suggestion never silently identifies one person as another. A failed or unsupported upload offers retry, another photo, describe instead, or invent instead. The no-photo routes have equal weight. Photo, drawing, and description conflicts state which source will win before generation.

### Until the story

This replaces the opening beats in `STUDIO-GUIDE-FLOW-DESIGN.md` through story generation.

**Create new storybook** opens this studio when it is on. The book pane is absent. The chat is centered. The Sparks information row appears once, then "Let's create a storybook." The choices are **Guide me** and **I'll use my own words**. A control switches between them until the pages start and does not restart the book. Switching to own words opens the manuscript with whatever text exists. Switching back asks only for facts that are still missing.

**Guide me.** The guide asks one broad question: "Who is it for, and what should happen?" At the same time, the book pane arrives with a recommended style large and a few alternates. The recommendation is already selected; choosing another style is one tap. **I have a drawing** derives a proposed style from that artwork and asks which style wins only when uploaded drawings conflict. A photo is a likeness source, not a style. Nothing is generated until a style is saved and at least one subject is known.

Names in the answer create equal plates immediately. Each plate can take a photo, a drawing, or a description; leaving it alone means invent from the stated story facts and safe defaults. A drawing uploaded before its person is named waits unassigned, then can be placed on a plate. Several drawings in different styles ask once which look the whole book uses while preserving each character's identity.

Once the saved style and current named cast are known, the well shows one scoped action: **Draw Maya and Leo in this look · about N Sparks**. Its quote contains exactly those stable cast members and one portrait per member. Selecting the style or sources did not spend Sparks. The tap confirms that portrait batch; there is no second confirmation and no confirmation per child. A person added after that quote is not silently added to it. Before pages start, their portrait is either offered as another scoped action or included and named in **Draw the book**.

The portraits and the remaining fact conversation then run together. A portrait starts only for a member in the confirmed batch, using the saved style and the latest source present when the job was queued. It fades onto that plate. The chat names the first result once; the others appear without interrupting the current question.

The reading age is taken from the first child's age. That slot is confirm once: the guide says it once, and continuing accepts it. They can correct it or skip. A fact they actually said, such as "Leo is Maya's brother," is not this. It is saved, and the existing confidence thresholds decide whether it is named back.

The story is written in the chat language. "Write it in English," or "auf Deutsch," sets the book language, even when the sentence is in another language. If the two languages differ, the guide says it once: "I'll write the story in English." Continuing accepts it. It locks with the story. Changing the chat language later changes the guide only. A pasted story keeps the language it is written in, and the same one line covers that.

Which facts are required, and what happens when a fact was not said, is an admin setting. The guide asks the ones that belong together in one message, then asks only for a required fact that is still missing. An optional fact is skipped with a skip control, or by the reader saying they do not want to answer. Anything they type is an answer, including a correction.

The story starts automatically when every required fact has a value, every optional fact the guide actually asked has been answered or explicitly skipped, and no clarification or identity assignment is unresolved. The trigger is the patch that resolves the final item, never silence, inactivity, or a timeout. There is no Create the story button. The job is queued first; then the guide says, "That's everything I need—I'm drafting the story now. You can still add something while I write." Another detail sent while it is writing supersedes the older run and updates the draft from the latest facts. If the draft fails, the page stays as it was and the well is "Try the story again." They can also type a correction. The story is text, so that retry spends nothing.

The story streams onto the printed page. The chat says "Here it is." They change it on the page or by prompting. Continue sits in the well and does not block reading. It is Draw the book, in After the story.

**I'll use my own words.** The manuscript opens for writing or pasting. Extraction reads names and stated ages without rewriting the manuscript. A high-confidence result becomes a receipt: "Found Maya and Leo," with **Edit people** beside the same style, source, and portrait action used by Guide me. Tapping **Draw Maya and Leo in this look · about N Sparks** confirms both that visible extraction and that exact generation batch; it does not need a separate confirmation. An ambiguous result, duplicate name, contradiction, or uncertain protagonist must be corrected before generation. Inline correction can rename, change an age, remove, or add someone without reparsing the whole manuscript. After that, this book takes the same road: the printed page and its shapes, the account moment, and Draw the book.

### After the story

The reader is looking at the manuscript. The story is editable only while this step is current. Opening the cast shows the plates and does not edit the manuscript. The cast stays editable through the story, including a person the story adds.

A result updates the book only when it was made from the story on screen. A result from an older draft is dropped, even if it finishes later. While a new run is working, the previous result stays, so the book does not go blank. A typo or a reworded sentence leaves the result. A real change, while the story step is still current, starts one new run on the latest text: someone added or removed, an age changed, or what happens changed. A burst of typing is one pause, then one run.

**While they read.** Cast extraction starts on the draft. Plates already there keep their photo, drawing, description, and portrait. A new recurring person appears as a plate. A place or an object gets a plate only when the pictures would repeat it. The page layout starts as soon as the cast matches this draft, and the manuscript stays up. A real change runs extraction again, then the layout again. No new visual starts merely because analysis found it. A required portrait or internal reference not covered by an earlier batch is named and included in the Draw-the-book quote. If the subject disappears before that action, it disappears from the quote.

**Cover.** Before generation, the cover is a live plan: title, subtitle, author, shape, and the people intended for it. The generated front, back, and spine belong to the Draw-the-book batch; the opening Sparks information row is not authorization for them. After they land, each person on the cover is tied to that person's settled plate. "Make the hair darker" changes that plate, and a later scoped redraw states the cover and page impact. If more than one person is on the cover and the sentence names nobody, the well asks which name. Tapping a person sets the chip to that name. Nothing redraws until the chip is one target.

The title follows the draft until they edit the cover. A subtitle and an author are lines on the cover, empty until typed. They are text on the book. Typing them does not redraw the picture and does not change a person.

**Size and layout.** A new book is already a square, with the words on the picture along the outer edge. The page count comes from the story and shows on that page. The shape and the word arrangement need no extra tap. Throughout the story step the book pane shows one printed page, large, at that shape, with the story sitting where the words will go. The other shapes and the other arrangements stay in a smaller row beside it. The chosen one is the page itself. Tapping a shape animates the page. Tapping an arrangement moves the words. They can read the story and never tap. The cover is drawn at this shape. Changing the shape before that picture exists only changes the frame. After the cover exists, the picture redraws, and the estimate is on the button. Changing where the words sit reruns the page plan and costs nothing until the pages are drawn.

A line that does not fit that page is moved to the next page while the story step is current. If that changes whether the book reaches a hardcover, the guide says so. Order stays away only if a page still overflows after that.

**Hardcover.** Softcover and hardcover are chosen at checkout. While the story can still change, the printed page shows the count the story wants. The hardcover minimum is the minimum page count of the hardcover product configured for this shape, on the step that product allows. The softcover minimum is that product's own number. The guide never writes a fixed 24 into the sentence. If this shape has no hardcover, it says nothing about one.

The check runs when the draft settles. It counts the words and the separate moments, and divides the words by how many this reading age puts on a page. A younger page holds less, so the same story fills more pages. A stretch is sensible when those moments can fill the hardcover minimum without a page dropping under about half the words this age expects. Repetition the age band already wants can carry a moment onto another page. A new event does not count as room.

When the story can hold it, the pages aim at that hardcover minimum, rounded up to a count that product sells. The guide does not ask. One line: "I'll spread it over N, so a hardcover is possible." A softcover of the shorter book stays available when that product allows it.

When the story cannot hold it, the page keeps the shorter count, and the line is plain: "This story is too short for a hardcover. A hardcover of this size needs at least N pages, and stretching it would leave thin pages. I can spread it if you want one. A softcover can stay at M." Spreading waits for them to agree. Continuing keeps the shorter book. M is rounded up to a count the softcover product sells. Order stays away until the count is one a product for this shape can print.

A guest can reach this cover plan. The generated cover and inside pages start together after the account moment when a durable account is required.

**Sparks.** Every Sparks number is an estimate. The button says "about 40 Sparks," or "about 40–55" when the range is wide. The line under it: "Based on token use. It can come out a little lower, and it won't be higher." When the next picture needs more than the balance, the well is that estimate, the same line, and the smallest pack that covers the top of the range. A guest cannot buy a pack, so that button is create an account. They return to this book. A charge they already confirmed then starts. Otherwise the same button is still there.

**Draw the book.** Continue is one button in the well: **Draw the book · Square · N pages · about N Sparks**. The shape and count on the button are the ones on the page. This one quote authorizes the generated front/back/spine, every inside-page illustration, and any required internal character, place, or object references not already paid for. It names the number of generated units behind the estimate; portraits already paid for are not included again. Internal reference sheets remain pipeline artifacts, not another user-facing step or charge gate. For a guest, this well asks them to create an account first. They return to the same valid quote and button. Each page starts as soon as its dependencies are current. Pictures fill the spread as they finish, and the pages can be turned while the rest draw.

Starting the pages removes the row and locks the look, the cast, the story, the cover text, the shape, where the words sit, and the page count. Opening those views still shows them. A story change no longer reruns the cast or the layout.

**Typed changes that make a portrait necessary.** When a typed message changes who someone is (a child's age, or a different kind of being), the chat draws the new portrait without a tap, because the old one is no longer them. A change of age counts when it is as large as what a person of that age visibly changes in: two months for a baby, half a year for a toddler, a year for a child, two years for a teenager, a decade for an adult. So 2 to 3 redraws, and 35 to 36 does not, and an adult's portrait is not marked out of date. Typing a look, a description, or a style that lets portraits be drawn starts them, as tapping the same choice does. Both go through the same gate as every automatic start: the admin `autoSpendSparks` cap, the Sparks balance, and no unit already drawing. One message starts at most one batch, and Undo is dropped once Sparks are spent. A person drawn from a photo that is gone is left for the reader to decide. A typed art style over a look taken from the reader's own drawing asks first, the same as the button does.

**Pages.** Editable only while the pages are the current step, and only the page they are looking at. The person in an edit is the one already named on that page. The sentence is typed in the composer, and typing it does not spend Sparks. Successful sibling pages remain visible when another page fails. A failed, moderated, stale, or mismatched page is selected on the book and the well offers **Redraw this page · about N Sparks** with a new quote. A partial batch receipt separates successful charged units from failed or released units. Order stays absent until the cover and every page are current.

**Print preflight.** Preflight runs continuously and says nothing when the book passes. It checks story and page text, title and cover, current illustrations, overflow, image quality, page count, trim and binding compatibility, and supported fulfillment region. A real problem selects the exact cover or page and puts its smallest useful fix in the well. Unsupported shape, language, product, or region is found before Draw the book whenever the inputs make that possible.

**Order.** When preflight passes, the well is **Order the book · from [money price]** until checkout knows the binding and other price-bearing options. If the exact product is already known, the exact price replaces "from." That action locks the pages and opens checkout. Payment, address, shipping, copies, and final order confirmation are outside this flow.

The reading age follows the first child's age until they confirm or replace it. If that age changes before they answer, the line updates. After they have replaced it, it stays at their choice. It locks with the story.

### After the book is drawn

The book is finished when the pages start. From then on, one switch at the top of the book pane, **Preview | Edit**, moves between reading the book and working on a page. It is always in the same place, in both states, and it exists only once there is a page to work on. Edit is the page canvas for the page in view. Preview is the flip-through. Leaving Edit by the switch, the Escape key, or finishing the book returns to the same spread.

The chat does everything the canvas does to the words, so nobody has to find a tool to change how their book reads. A sentence is read the same way as before the pages were drawn, and the same ideas are always under the composer on the Pages tab (**Make the text a bit larger**, **Center the text**, **Make the text …**, **Change the font to …**, **Move the text up a little**). They stay in view while a picture draws, while a card is open, and in Edit. They hide only while the field has words in it, because a tap replaces them.

What it can do, all free and each undone by one Undo:

- **Size.** Larger or smaller, one step at a time, never below what prints legibly or above what fits. The reading text by default, or the title, subtitle or author on the cover when named. The whole book unless the sentence says this page, so the type matches from page to page.
- **Color, alignment, font.** A color is a name (English or German) or a hex code the app knows. A font is one the book's language offers. "A serif font" asks which of a few. Anything the app does not know is said no to with the reason. These replace a word's own color or font, because "make the text blue" means all of it.
- **Position.** A small step up, down, left or right on the page in view, or every page when asked. The words stay on the page. If they end too close to the edge for print, the print check says so.

**This page.** The page or cover they selected, else the spread open in front of them, else the page in Edit. It is never taken from the model. A person's picture still needs the chip: a typed change to a drawing starts nothing until it is one target, and a selected page redraws only for a sentence that is a change to the picture.

**The book's facts are settled.** What a reader says about their finished book is a request, never a new fact. The story, the cast and the setup are not rewritten by a sentence, and a skill that needs them says what it needs.

**If a title is painted into the cover picture**, the guide says so instead of changing a text box that is not there. Two devices editing different pages both keep their changes; the same page edited on both asks which to keep.

### Resume and recovery

The Project and durable jobs, not transcript position, determine where a reopened book resumes. Chat and Steps both reconstruct from the same artifact versions. A book begun in Steps opens in Chat at its current book state, never at intake merely because Chat has no transcript.

On reopen, show one short summary only when something changed or needs attention: "Your story is ready. Maya's portrait finished while you were away. Two pages need attention." The available actions open the newest result, the failed object, or the current next action. If nothing changed, return directly to the book and live well.

Uploads resume when possible and otherwise remain on their plate with retry, replace, describe, invent, or delete. A generation result commits only when its subject, source, style, story, and target artifact versions still match. A late stale result is kept as history or discarded according to the action, but never flashes as current. A failed or moderated unit does not erase successful siblings. Retry quotes only the failed or affected units.

Closing, refreshing, going offline, signing in, creating an account, or buying Sparks preserves the composer draft, transcript scroll, selected view, context chip, uploads, artifact versions, and pending action. A confirmed unexpired quote may continue after return; otherwise the same action is shown with a fresh estimate. Idempotency prevents a reload, double tap, or return URL from starting or charging the same unit twice.

When two devices changed independent fields, merge them. When they changed the same field or artifact, show one choice between the versions and preserve both in history. A blocking conflict, failed upload, failed job, insufficient balance, or invalid print state always has a local next action; it never leaves a disabled control as the only explanation.

### Voice

Casual, friendly, short. The child's name. Contractions. About 25 words, unless the line is a required disclosure: consent, a charge, likeness, or blast radius.

The line asks or acknowledges. The control carries the label and the price. The sentence does not repeat the button and does not narrate the interface.

- "Image generation uses Sparks. You'll see the estimate before anything is drawn." Once, as information at the start of a book.
- "Maya and Leo. Got them. Do you have a photo?"
- "I'll draw them in this look."
- "Maya's ready. What should the seaside day be like?"

Not: "Please select an art style from the options below to continue."

One line per change. Priority: a blocking error or a required confirmation, then the answer to what was just typed, then a result that landed, then the next question. A finished look, a finished draft, and a follow-up never arrive as three bubbles.

Every line the guide says or asks is written by the model in the chat language, including a known beat. The configured sentence is the meaning. A name stays as it was typed. Trusted controls appear in the application's localized UI language and never depend on model output. The line appears with the control in the same frame. After a typed turn, the receipt renders from the patch immediately. A spoken line follows only when something still needs saying, and it does not delay the receipt.

## Logical and quality

`Project` and durable jobs are the source of truth. Chat and Steps are two presentations. Neither imports the other's private state. Nothing Steps-only is removed while Chat is built.

The guide's right region is the book pane, not the step workspace with its rail hidden. It reuses the manuscript and the page canvas. It does not clone them. The story-refine prompt is not mounted. If the page canvas has its own instruction field, that field is off when the guide mounts it. The composer is the only natural-language input. A picture the book has already drawn is targeted with the chip, not dropped into the field. The controls are trusted application UI with fixed, localized labels; the model never invents an action label, price, or effect.

Build the shell before the new engine. Today's cover, story, cast, and spreads can fill the book pane. A first look, a Spark quote, and the speech queue land in their own slices. A layout bug and a job bug should not ship together.

A background result commits only against the current story. An older run is discarded when it finishes. Who is in the story, and how the pages are laid out, rerun on a real change only while the story step is current, and keep the previous result visible until the new one replaces it. Starting the pages locks the earlier steps. During the pages step, the page on screen can be redrawn with the estimate shown. Leaving for an account or a Sparks payment returns to the same book and the same pending action.

The hardcover check is deterministic. It reads the current draft, the reading age's words per page, and the minimum page count and page step on the hardcover and softcover products for the current shape. A sensible stretch is one where each page stays at about half those words or more, using only moments the story already has. When that holds, the page plan is told to aim at the hardcover minimum, rounded up to a count that product sells. When it does not, the plan stays at the natural length, rounded the same way for the softcover, until the reader agrees to a thin stretch. The page-plan prompt receives the target count, the age band's words per page, and which case this is. It may only spread existing moments. A thin stretch is told the pages will be sparse and must not add events. Nothing user-facing calls this a screenplay.

A widget reads the book, not its own memory. It survives refresh. A live choice renders in the well. The object renders on the book. The transcript stores the receipt, read from the book after the patch, not from what the model claimed. Model output may write only registered fact slots. Uploads, approvals, generation, payment, and completion are trusted actions.

The composer draft survives navigation, a failed upload, and an offline gap. Page focus restores the transcript scroll. The mobile sheet does not steal focus while the reader is typing. A new visual is announced. The opening Sparks line is stored with the book, so reopening does not repeat it.

Keyboard reaches the well: arrows move tiles, Enter accepts the focused cheap choice, and the field keeps the cursor. Every generated image has a useful description. Approval does not depend on color alone. Reduced motion removes the rise, the crossfade, and the violet trace.

## Admin

Guide-specific settings only. The art-style catalog, age bands, and languages stay where they already are.

The Guided studio tab already owns who gets this studio, and how sure an answer must be before it is saved, said back, or allowed to change a fact. The model and prompts that read a turn stay under Models and Prompts. There is no control for how long to wait before the story starts because waiting is not the trigger. It starts on the patch that resolves every required fact and every optional fact the guide actually asked, provided no clarification or identity assignment remains open.

**Facts.** Code owns the order of the look, the plates, and the story. For each fact the guide may collect, the admin sets:

- required or optional;
- whether it may be asked inside "Who is it for, and what should happen?";
- what happens when the reader did not say it: **use it**, **confirm once**, or **never**.

Use it saves the value and moves on. Confirm once says the derived value once. Continuing accepts it. A correction or a skip replaces it, and it is not asked again. Never leaves the fact empty unless they said it. "Leo is Maya's brother," when they said it, is a stated fact and follows the confidence thresholds, not this control. The reading age, taken from the first child's age, is confirm once.

**Portrait.** The same three settings as any other image action: prompt, model, and Sparks price. The prompt is new. It asks for one picture in the saved style, from a photo, a drawing, a description, or the name alone. It is not the internal reference-sheet prompt, which may still build the consistent views needed by page generation. The portrait price is included only in the scoped portrait batch that names that person.

**Own words.** A prompt, or a section of the interpret prompt, that reads a pasted manuscript and returns names and ages without rewriting the story.

**Story.** Which existing story-draft prompt the guide uses once the facts are in. A separate guide prompt only if that draft should be written differently from the wizard's guided draft.

**Pages.** The existing page-plan prompt receives a target count, the age band's words per page, and whether this is a natural length, a spread, or a thin stretch. It may only spread moments the story already has. A thin stretch is told the pages will be sparse and must not add events. There is no separate guide prompt unless that plan should differ from the wizard's. The Draw-the-book quote includes required internal references, the cover, and page illustrations as one user-authorized batch while preserving per-unit settlement.

**Wording.** The opening information row, the two choice labels, "I'll draw them in this look," "Found Maya and Leo," "Draw the book," and "Based on token use. It can come out a little lower, and it won't be higher." These are the meaning. Guide speech is generated in the chat language. Controls are fixed trusted UI and use the application's normal localization catalog; the model does not translate or rewrite them.
