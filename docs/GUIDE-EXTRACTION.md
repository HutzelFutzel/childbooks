# The guide's extraction layer

Everything a reader tells the chat has to end up somewhere. This document is the
design for making that true — not "usually true for the sentences we thought of",
which is what it is today.

**The rule:** every piece of a reader's message ends in exactly one of three
states — *applied* to the book, *rejected* with a reason we can show them, or
*unhandled* because no slot exists to hold it. Silence is a bug. If a message
produces no visible outcome, that is a defect regardless of what the model did.

---

## Why this is being rewritten

The reported symptom: a reader typed "Micah and Neil, both 5 years old" twice and
was told "I didn't quite catch that" both times. The names were never stored.

The cause is not the model. It is that `applyGuidePatch` reports only two
outcomes — a slot changed, or it didn't — and `composeGuideReply` reads the
second as a failure of comprehension. `landed: false` currently means five
unrelated things: the model returned nothing, it returned a shape the validator
refused, the value was outside the allowed world, the value was *already
correct*, or the reader stated a fact with no writer. Only the first is
"I didn't catch that".

| Symptom | Where | Actually means |
| --- | --- | --- |
| "I didn't quite catch that" on a correct restatement | `core/guide/voice.ts` | The value was already right |
| An age band that silently vanishes | `core/guide/patch.ts` | Unknown id — the writer returns `null` |
| Names dropped when only ages are sent | `core/guide/patch.ts` | `heroAges` cannot introduce a person |
| A theme confirmed, then absent from the prompt | `core/guide/patch.ts` | Unvalidated id, nulled later by `normalizeStoryBriefForCraft` |
| Facts lost from a sentence that also asks a question | `core/pipeline/guideInterpret.ts` | The intent label gates the whole patch |
| A cast member deleted by an unrelated turn | `core/guide/patch.ts` | `heroes` replaces the complete list from a stale snapshot |

Six defects, one shape: information that had somewhere to go and did not get
there, with nothing logged and nothing shown. The fix is structural, not a better
prompt.

The last row is reasoned from the code rather than observed in the wild — the
`heroes` writer takes a complete list, and the patch is computed against the
snapshot sent to the server but applied against the live project inside
`patchCurrent`. A cast edit made in the artifact pane mid-turn is therefore
deletable by a model that never saw it. It should be reproduced before it is
cited as an incident, but the race is real by construction.

### Two things that are staying

The closed world in `core/guide/patch.ts` is correct and is not being relaxed. A
model proposes; only a writer writes; artifact slots have no writer at all.
Everything below assumes that boundary and tightens what happens *at* it.

The split between the catalog (in code, owns meaning) and the playlist (in
`appConfig/guide`, owns order and wording) is also correct. New facts must not
require an admin migration, and `normalizeGuidePlaylist` already appends new
catalog entries as enabled.

---

## The contract

Seven stages. Each is total: it accounts for every input it is handed.

```
message
  1. Extract    LLM, always, one call    → Claims[] + Unhandled[] + Question?
  2. Verify     cheap, no model          → evidence spans occur in the message
  3. Validate   per claim, independent   → accepted | repairable | rejected
  4. Repair     LLM, at most one retry   → only rejected claims, with the error
  5. Apply      three-valued per slot    → applied | unchanged | rejected
  6. Respond    engine composes          → from outcomes, never from model prose
  7. Log        outcomes, not proposals  → feeds the eval corpus
```

Stage 6 already works this way and must not change: the model may confirm what it
understood, but `voice.ts` owns the next question, because a model that asks
about a theme while the cast is empty is how a transcript loops.

### Extraction produces claims, not a patch

```ts
interface Claim {
  slot: SlotId;
  op: "set" | "add" | "update" | "remove" | "clear";
  value: unknown;      // validated by that slot's schema alone
  evidence: string;    // verbatim span from the message
  confidence: number;
}

interface Extraction {
  claims: Claim[];
  /** Real requests with no slot to hold them. Never silently absorbed. */
  unhandled: { text: string; want: string }[];
  /** They asked us something. Independent of whether they also stated facts. */
  question: string | null;
}
```

Claims fail individually, so one unparseable age cannot cost two good names.
`question` is no longer mutually exclusive with stating facts — "can you make it
about Micah and Neil, both 5?" is a question *and* two facts, and today the
intent label throws the facts away.

### Evidence spans

Each claim carries the span of the message that justifies it, checked with
`normalize(message).includes(normalize(evidence))`.

This is a verification, not a parser. It understands no grammar and enumerates no
sentence shapes, so it does not reintroduce what we are deleting. What it catches
is fabrication: an age nobody typed has no span. A claim whose evidence does not
appear is demoted to low confidence rather than dropped, so a model that
paraphrases degrades instead of failing. It doubles as the receipt shown under
the reader's message.

### Three-valued writes

The single highest-value change, and it needs no model work:

```ts
type WriteOutcome =
  | { status: "applied"; project: Project }
  | { status: "unchanged"; note: string }
  | { status: "rejected"; reason: string; allowed?: readonly string[] };
```

`unchanged` is a confirmation ("Micah's already down as 5"), not a denial.
`rejected` carries `allowed`, which feeds the repair loop and makes the failure
visible in the log — today an out-of-world id is invisible in both places.

### The repair loop

A rejected claim is re-prompted once, alone, with the specific error: *"`age-5`
is not a valid band. Valid: `age-3-5`, `age-6-8`, … Re-answer this claim only."*

Bounded to one retry over the failed subset. Most near-misses become successes
without touching the prompt, and the cost is one small call on the minority of
turns that need it.

---

## The extension point

Adding one fact today means editing `slots.ts`, `patch.ts`, `components.ts` and
`widgets.ts`, plus the invariant scripts that assert coverage. That is the thing
to fix: a new question should be one object, not a refactor.

```ts
export const heroesSlot = defineSlot({
  id: "heroes",
  label: "Who it's for",
  kind: "fact",
  ops: ["add", "update", "remove"],

  schema: z.array(z.object({
    name: z.string().trim().min(1).max(80),
    age: z.number().int().min(0).max(120).optional(),
    ageMonths: z.number().int().min(0).max(1200).optional(),
  })).max(12),

  // Prompt material lives WITH the schema, so the model is never told about a
  // shape the validator will refuse.
  prompt: {
    shape: '[{"name": "Maya", "age": 5}] — a child the book is about',
    examples: [
      { said: "Micah and Neil, both 5 years old",
        claims: [{ op: "add", value: [{ name: "Micah", age: 5 },
                                      { name: "Neil",  age: 5 }] }] },
      { said: "my daughter, she turns 6 next week",
        claims: [], ask: "I need her name." },
    ],
  },

  read:     (project) => /* current value, in claim shape */,
  write:    (project, op, value, world) => WriteOutcome,
  describe: (project) => /* the applied-value receipt / owning-surface label */,
  options:  (world) => /* closed list ⇒ tap-to-answer chips, for free */,
});
```

Registering it derives the id union, the prompt's field list, the few-shot block,
the validator, applied-value receipts, widget chips, checkpoint capture and restore,
and the invariant coverage checks. A new question is then a component naming its
slots; the playlist picks it up with no migration.

**On examples over instructions.** Extraction knowledge currently lives in one
hand-written paragraph in `core/prompts/registry.ts` that enumerates specific
cases ("aren 2 miles 1 and mika 3"). That has the same brittleness as a regex,
written in English — it grows with every slot and nobody can tell which sentence
carries which behaviour. Per-slot examples scale; one paragraph does not.

**Cast semantics change with it.** `add` / `update` / `remove` keyed by name
replaces complete-list replacement. A stale snapshot can then no longer delete a
person, ages introduce people naturally, and `coerceGuidePatch` is deleted.

### Two tiers of extension

Adding a question should not require a refactor. It does not follow that it
should never require code, and conflating the two is how this goes wrong.

**Tier 1 — no code.** Catalog-backed enums (themes, settings, devices, art
styles, age bands, languages) generate their whole descriptor from the admin
catalog, so adding a theme is already zero-code. Extend that with a generic
*extras* slot: an admin defines "Favourite animal" as a free-text fact with a
question and a label, it stores into an `extras: Record<string, string>` on the
brief, and the prompt renders it as a labelled line.

The cost is real and should be stated: nothing downstream can *reason* about an
extra. It is extracted, stored, shown on its owning surface or receipt and injected into a
prompt, but no satisfaction predicate, staleness rule or pipeline step can branch
on it. For most new questions that is fine.

**Tier 2 — one descriptor file.** A typed fact the pipeline reasons about needs
the schema, writer and read function above. That is one new file and one
registration, not a refactor — but it is code, and it should be, because it is a
contract the generator depends on.

**Tier 0 — a field on a slot that already exists.** Cheapest of the three, and
the one to look for first. How the children are related went in this way: `role`
was already on `StoryCastMember` and already rendered into the story prompt by
`castPromptLines`, so the chat only had to stop discarding it. Widen the `heroes`
schema, keep the field on a re-statement that omits it the way ages are kept, add
a worked example, and compare it in `sameCast` so a turn whose only news is "Leo
is her little brother" counts as a write rather than reporting that the book knew
already.

Two properties make it safe to collect something like this:

- **Never blocking.** Nothing in `briefBlockers` or `isSatisfied` reads it, so a
  relationship the reader mentions in passing cannot become a fifth thing the
  book is waiting for. Checked, in both directions, in
  `scripts/guide-engine-invariants.ts`.
- **Never silently stripped.** `role` is accepted on `heroAges` as well, because
  "Leo, Maya's little brother, is 3" is one sentence and a model that answers it
  with an age claim would otherwise have the relationship removed by Zod's
  unknown-key stripping, with nobody told.

---

## Confidence, weighted by blast radius

The number is already collected and already ignored.

| Confidence | Behaviour |
| --- | --- |
| High | Apply, show the receipt chip |
| Medium | Apply, then read back explicitly for a yes/no |
| Low | Do not write; ask a targeted question, with chips where the list is closed |

Independent of confidence: anything Undo cannot bring back — overwriting
`storyText`, deleting a photo — always confirms first. Removing a cast member is
restored whole by Undo, so it runs at once and Undo is the safety; it only asks
(rewrite the story or keep it) when the story mentions the person. Being confident
and wrong about a deletion is the expensive case.

---

## What has no home

`unhandled` is how "the information goes where it belongs" stays honest when
there is no *belongs*. A reader asking for something we cannot store is told so
plainly, in the guide's voice, and the request is logged.

That log is the backlog. The slots worth building next are the ones readers keep
asking for, and this is the only way to find out which those are.

---

## What the chatty flow adds

`STUDIO-GUIDE-FLOW-DESIGN.md` depends on four extraction behaviours that do not
exist yet. They are listed here because each one is a claim-layer change, not a
widget.

**An appearance slot.** “Make Maya’s hair curly” is a sentence readers say
constantly, and today it has nowhere to land: the cast holds names, ages and
relationships, while appearance lives inside generated anchors. Without a slot it
becomes `unhandled` — the reader is told their most natural art-direction request
cannot be stored. Add a per-subject appearance field that both the first-look
generation and the anchor reconciliation read from.

**Exclusions.** “Nothing scary” and “please don’t mention the hospital” are brief
facts with no slot either. They need one before the story is drafted, not after a
reader sees the thing they asked to avoid.

**Compound cross-artifact turns.** “Move it to a lighthouse and make Maya’s hair
curly” is two claims against two artifacts in one message. The claim list already
supports this shape; what must follow is one grouped receipt naming both changes
and one grouped staleness explanation, rather than two independent cascades firing
as if the reader had said two things.

**A settled transition, separate from readiness.** `isBriefReady` goes true on names
and ages, which is the earliest possible moment and the wrong one: the reader may
still be supplying the occasion. An explicit instruction such as “write it now”
starts immediately. Otherwise drafting starts from the patch that resolves every
required fact and every optional fact the guide actually asked, provided no
clarification or identity assignment remains open. The job queues before the guide
says it is drafting, and the composer remains available. Inactivity, silence and a
timeout never trigger it.

**Interrogative turns are not always claims.** “What do you think would work
better?” must be answered, not extracted from. A turn whose claims are all
low-confidence and whose text is a question should route to an answer, with the
speech queue giving that answer priority over the next scripted question.

---

## Configuration

The guide should be tunable from the dashboard without a deploy — including the
parts that decide whether it understands someone. Everything below extends the
existing ownership split rather than loosening it.

### Already configurable

Model slots and per-action bindings (`guideInterpret` is one row), every prompt
block's text and enabled flag with variable linting, the rollout mode, and the
playlist's order, enable, retitle, skippable and opening-question overrides. Plus
the catalogs the guide draws its closed lists from: audience bands, story craft,
art styles, book languages, layouts.

#### The opening question

`GuidePlaylistEntry.ask` is the wording an admin puts to the reader the first
time a component comes up. It exists because the catalog's questions are one
fact wide and the best first question is not: *"who's in the book, how they know
each other, and their ages"* collects in one turn what the catalog would collect
in three.

It is spoken only while the component is empty. Once any of its slots is settled,
the blocker wins — `guideAsk` measures this with `captureGuideFacts`, so the
answer is the same one a checkpoint would see. That split is the whole design: an
override that kept speaking would re-ask a question the reader had half answered,
which reads exactly like not having been read. The broad ask is editorial; the
chasing stays with the code that knows which age is missing.

Offered only on components that answer a fact slot (`componentTakesAnswers`).
`page-art` and `story-approve` are narrated by their effects and then ask for a
yes, so an override there would sit in the editor looking live and never be said
— normalization drops it rather than store it.

### To make configurable

**Model call parameters.** Which model is configurable; how it is called is not —
`temperature: 0` and `retries: 1` are literals in `guideInterpret.ts`. Add an
optional `textParams` map to `appConfig/models`, merged over shipped defaults the
way `capabilities` already is: temperature, max output tokens, timeout, retries.

Two new action ids come with the architecture — `guideExtract` and `guideRepair`
— so the repair pass can bind to a different model than the first pass.
Registering an action is a small, well-trodden code change, and the admin model
row, pricing and cost attribution all follow automatically.

**Understanding thresholds.** The primary reliability dial, and a deploy today:

| Setting | Effect |
| --- | --- |
| `autoApplyAbove` | Apply silently with a receipt |
| `readBackAbove` | Apply, then confirm explicitly |
| `repair.enabled`, `repair.maxAttempts` | Whether a rejected claim gets a second pass |
| `repair.escalateToSlow` | Retry on the quality slot instead of fast |
| `evidence.required` | Enforce spans; whether a missing span demotes or rejects |

**Per-slot policy.** One row per fact:

```ts
interface SlotPolicy {
  writable: boolean;          // kill switch — the chat may not touch this slot
  minConfidence?: number;     // override the global band
  alwaysConfirm?: boolean;    // regardless of confidence
  widget: "chips" | "text" | "auto";
}
```

`writable: false` is the per-slot equivalent of the rollout kill switch. If the
model starts mangling ages in production, that one slot goes off and the guide
asks with chips instead — a thirty-second mitigation rather than a hotfix.

**Few-shot examples.** The biggest operational win. An admin sees a phrasing fail
in the log, adds it as an example with the right claims, saves, and the phrasing
works for everyone. Extraction reliability becomes an operations task instead of
an engineering one.

The guard is the one already used for prompts: validate on save. Where
`lintPromptsConfig` throws on an unknown variable, this parses each example's
`value` against that slot's schema and refuses the save if it does not fit. An
example that could not be applied cannot be stored.

**Copy.** `voice.ts` is hardcoded English — "I didn't quite catch that.", "I'll
write the story now, from everything you've told me." The playlist can retitle a
component but cannot change the question it asks or the narration during
generation. Move those into the same document that owns titles. This is also the
i18n seam, so it is worth doing before the guide ships broadly.

**Limits and observability.** `MAX_GUIDE_MESSAGE` is 2000 in two places while the
`storyText` slot accepts 40,000, so a reader pasting their own story gets a 400 —
config, with a separate ceiling for the paste path. The transcript window is
defined three times with two values (`TRANSCRIPT_WINDOW = 8` in `guideStore.ts`
and `guideInterpret.ts`, `MAX_GUIDE_TRANSCRIPT = 12` in `functions/src/ai.ts`);
one concept, one home. Then log sampling, the 90-day retention constant in
`guideTurns.ts`, the self-repeat detection window, and the `guideTurnsPerBook`
quota value.

### Where it lives

**Configuration → Models** gains parameter columns per action and the two new
guide rows. **Prompts** already works; per-slot examples become a new section.

**Configuration → Creative defaults → Guided studio** gains an "Understanding"
section: confidence thresholds, repair settings, evidence policy, and the
per-slot policy table. That tab currently says the model and its wording live
elsewhere on purpose; that stays true, because thresholds are behaviour rather
than wording.

**Analysis → Guide turns** is new, and is the piece to build first. A log viewer
over `guideTurns` filtered to the three populations worth reading — low
confidence, rejected claims, and readers who repeated themselves within two turns
— with an **"Add as example"** action on each row that writes the corrected
extraction straight into the prompt config. Failure appears, someone clicks, the
sentence works from then on.

Two supporting pieces make that safe to use. A **dry-run bench**: paste a
sentence, see the claims, confidences and write outcomes against a scratch book,
nothing persisted — so thresholds are tuned against real phrasings rather than
guessed. And **lint-on-save** for each new document, following
`lintPromptsConfig`: examples must parse against their slot schema, thresholds
must be ordered and in range, and a slot cannot be both `writable: false` and
required by an enabled component.

### Where the line sits

Four things stay in code: the zod schemas, the `write` functions, the
satisfaction and blocker predicates, and the closed-world enforcement itself.

`story-cast` delegates to `isBriefReady` precisely so the guide cannot promise a
story the generator refuses to write. A schema editable from a dashboard is a
schema that can accept a value the pipeline rejects, and that failure does not
surface in the dashboard — it surfaces in support mail, days later, with no way
to tell which save caused it.

**Config decides what the guide asks, how it words it, how confident it must be,
and which model reads the answer. Code decides what a valid answer is.**

---

## Proving it

The eight offline scripts behind `yarn check:guide` verify the plumbing and can
say nothing about whether the model understands people. They stay as they are,
and gain coverage for the new documents: every slot has a policy row, every
stored example parses against its schema, thresholds are ordered.

What is missing is one online check: a corpus of real messages mapped to expected
claims, run against the live model binding on a schedule rather than per commit.

Fixtures are mined from `users/{uid}/guideTurns`, which must first start
recording outcomes rather than proposals — today it logs what the model suggested
and never learns what landed. Three populations are worth harvesting:

- low-confidence turns;
- turns with rejections;
- **turns where the reader repeated themselves within two messages.**

The third is the best signal available. A reader restating themselves is a
near-perfect detector of misunderstanding, and it is exactly the reported bug.
That query alone would have surfaced this without a report.

---

## Migration

Independently shippable, cheap first, so the telemetry exists before the model
path changes.

| # | Step | Why here | State |
| --- | --- | --- | --- |
| 1 | Three-valued `WriteOutcome`, `unchanged` in `voice.ts` | No model changes; fixes the reported bug | Done |
| 2 | Log outcomes; add the self-repeat query | Measures everything after it | Outcomes logged; query not written |
| 3 | Claim extraction, evidence, repair loop | Behind the existing rollout flag | Done |
| 4 | Slot descriptors, one slot at a time | `heroes` first | Partly — see below |
| 5 | Delete `parsePeople.ts` and `coerceGuidePatch` | Nothing depends on them by now | Done |
| 6 | Config documents and the turn-log viewer | Needs the outcomes from step 2 | Config done; viewer not built |
| 7 | Eval corpus in CI | Needs the fixtures step 6 collects | Not started |

### What step 4 actually got

The descriptor rewrite was not done wholesale, because most of its value came
from one part of it. The `writer()` table in `patch.ts` now carries each slot's
worked examples beside its schema and its prompt shape, and
`guidePatchExampleLines()` generates the prompt's few-shot block from them — so
adding a fact means adding one table entry, and the model is taught by the code
that judges it. `guide-engine-invariants.ts` parses every example against its own
slot's schema, which is what stops an example drifting into something the
validator refuses.

What is still spread out is the reader-facing half: `describe` lives in
`slots.ts`, widget options in `widgets.ts`. Folding those in is a mechanical
change that touches the capture/restore round trip, and it was not worth bundling
with a behavioural rewrite. The extension point is real but the file count for a
new fact is three, not one.

### Three things the implementation changed its mind about

**`coerceGuidePatch` was not replaced by the repair loop — it was replaced by a
wider schema.** The objectionable part of the coercion was that it ran a regex
over prose (`"maya 3"`). But most of what it rescued was a model answering "who
is the book about?" with people rather than names, which is a reasonable answer
to that question. `heroes` now accepts `["Maya"]` or `[{name, age}]` directly.
Repairing that shape on a second round trip would have been slower and no safer.

**Validation is ordered after the no-op check, not before it.** Every closed-list
writer answers "is this a change?" before "is this allowed?". Without that,
restoring a checkpoint taken before an admin deleted an age band fails — the book
would be refused its own current value.

**The intent gate survived.** The audit called it an information-loss path, and it
is, but evidence verification does not subsume it: "what ages do you support?"
genuinely contains the word "ages", so a claim quoting it passes the evidence
check while being the opposite of what was meant. The gate stays; what changed is
that the claims it drops are now recorded as `not-a-statement` instead of
vanishing, so a misclassified intent is distinguishable in the log from a model
that extracted nothing.

## Known tradeoffs

**Latency.** Deleting `parsePeople.ts` means the commonest answer in the flow
costs a round trip. The binding is already `speed: "fast"` and the widget path
stays model-free, so the exposure is typed free text only. The mitigation is an
optimistic pending state, not a parser — if we reintroduce one, we reintroduce
this document's first six defects.

**Cost.** One extraction call per typed turn, plus a repair call on the minority
that need it. `guideInterpret` ships free by default and should stay that way;
metering conversation itself is the wrong lever.

**Configuration surface.** Every document added here is another thing that can be
set wrong, which is the argument for lint-on-save and for keeping schemas in
code. The documents are worth it because each one replaces a deploy in the middle
of an incident.

## Not in the legacy manifest

`parsePeople.ts` and `coerceGuidePatch` are deleted outright rather than
superseded by a parallel flow, so they get no `@legacy guide-v2` marker and no
row in `docs/LEGACY-GUIDE.md`. That manifest tracks code kept alive *for readers
still on the wizard*; nothing here serves the wizard. If step 5 ends up shipping
while both extraction paths run side by side, that judgement changes and a Retire
row is owed.
