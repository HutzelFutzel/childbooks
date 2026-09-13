# Childbook Studio — Research-Backed Age Band Calibration

This document consolidates the final research-backed calibration for Childbook Studio's audience profiles using the updated **Children's Book Age Band & Audience Profile Authoring Framework**.

The main correction from earlier drafts is:

> **Age should primarily constrain cognitive, narrative, emotional, and inferential complexity — not artificially cap how much language a child may hear.**

Listening comprehension, decoding ability, chronological age, and product format are separate axes. A young child can enjoy a substantial read-aloud story even when they could not independently decode or produce the same language.

The publishing market strongly supports this. Books such as *The Gruffalo*, *Room on the Broom / Für Hund und Katz ist auch noch Platz*, *The Very Hungry Caterpillar*, *Brown Bear, Brown Bear*, and *Dear Zoo* show that toddlers and preschoolers can enjoy substantial picture-book experiences when the language is scaffolded through repetition, rhythm, illustration, predictable encounters, and clear causality.

---

# 1. Core Product Model

The hierarchy should be:

**Age → cognitive/emotional/story contract**  
**Reading mode → decoding/language-access contract**  
**Format → length/density/illustration contract**  
**Story Craft → creative choices inside those boundaries**

That means:

| Age | Primary determinant | Secondary determinant |
|---|---|---|
| 0–11m | sensory/shared interaction | format |
| 12–23m | naming + participation + prediction | format |
| 2y | shared read-aloud comprehension | story form / format |
| 3y | first sustained narrative | story form / format |
| 4–5 | age + reading mode | picture-book / reader format |
| 6–7 | age + reading mode + format | genre |
| 8–9 | age + reading mode + format | genre |
| 10–12 | age + reading mode + format | genre |

A **2-year-old picture-book read-aloud** should therefore be allowed to be much richer than a **2-year-old first board book**.

Likewise, an **8-year-old graphic story** and an **8-year-old prose chapter book** should share emotional/cognitive calibration while having radically different density and illustration settings.

---

# 2. Lessons from Successful Children's Books

| Reference class | What Childbook Studio should learn from it |
|---|---|
| *Dear Zoo*, *Brown Bear* | Predictable pattern + one changing variable; participation; instantly readable art. |
| *The Very Hungry Caterpillar* | Repetition can coexist with progression and transformation; simple language does not mean no story. |
| *The Gruffalo*, *Room on the Broom* | Toddlers/preschoolers can follow substantial read-aloud narratives when rhyme, recurring encounters, strong causality and pictures scaffold them. |
| *Don't Let the Pigeon Drive the Bus!* | A 3–5 picture book can make the listener an active participant in the plot. |
| *Elephant & Piggie* | Beginning readers thrive on dialogue, strong character voices, humor and generous visual support. |
| Scholastic Acorn | Ages 4–7 can independently read short, humorous stories when text is deliberately accessible and every page has visual support. |
| Scholastic Branches | Ages 5–8 can sustain 80+ page early chapter books when plots are fast, text accessible, chapters short and illustrations frequent. |
| *Magic Tree House* | A beginning chapter book can already be around 80 pages at ages 6–9. |
| *Dog Man*, *Diary of a Wimpy Kid* | Visual formats remain highly successful well beyond beginning-reader age; pictures are not merely remediation. |
| *Wonder* | Ages 8–12 can handle multiple viewpoints, social ambiguity and substantial emotional complexity. |
| *Percy Jackson* | By roughly 9–12, quests, betrayal, family issues, danger, subplots and long-form causality are normal middle-grade territory. |

Publishing guidance also supports a broad range rather than a narrow scientific threshold. Story picture books are commonly around **32 pages and several hundred words**, with different publishers/editors often targeting roughly **500–1,000 words** or recommending a tighter **≤600–700-word** manuscript.

The practical conclusion is:

> **Format and individual story design determine the length envelope; age determines what kinds of complexity the child should be expected to follow.**

---

# 3. Final Age-Band Architecture

| ID | Label | Caption | Months | Reading-mode default |
|---|---|---|---:|---|
| `0-11m` | 0–11 months | Baby books | 0–11 | shared/default |
| `12-23m` | 12–23 months | Toddler board books | 12–23 | shared/default |
| `2y` | 2 years | Toddler picture books | 24–35 | read-aloud/default |
| `3y` | 3 years | Preschool picture books | 36–47 | read-aloud/default |
| `4-5` | 4–5 years | Picture books | 48–71 | read-aloud |
| `6-7` | 6–7 years | Early stories | 72–95 | with-help |
| `8-9` | 8–9 years | Fluent readers | 96–119 | independent |
| `10-12` | 10–12 years | Middle-grade stories | 120–155 | independent |

These ranges are contiguous and avoid inclusive-boundary overlap.

---

# 4. Recommended Structural Calibration

These values are **Childbook Studio product envelopes**, not claims that every child of the same age scientifically needs the same word count.

`maxWords` means:

> This amount may still be age-appropriate when the story craft supports it.

It does **not** mean:

> Always aim for this many words.

| Field | 0–11m | 12–23m | 2y | 3y | 4–5 | 6–7 | 8–9 | 10–12 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `minWords` | 15 | 35 | **90** | **180** | **250** | 450 | 700 | 1,000 |
| `maxWords` | 90 | 180 | **750** | **850** | **1,000** | 1,500 | 2,200 | 3,000 |
| `beats` | 2 | 3 | 5 | 6 | 7 | 8 | 9 | 10 |
| `maxSentenceWords` | 8 | 12 | **22** | 24 | 28 | 30 | 34 | 40 |
| `plotRequired` | false | false | false | true | true | true | true | true |
| `targetWordsPerPage` | 5 | 9 | **22** | 28 | 32 | 55 | 75 | 100 |
| `maxWordsPerPage` | 12 | 22 | **50** | 60 | 70 | 105 | 145 | 190 |
| `targetSentencesPerPage` | 1 | 1 | 2 | 2 | 3 | 4 | 5 | 6 |
| `maxFocalCharactersPerScene` | 1 | 2 | 3 | 3 | 4 | 4 | 5 | 6 |
| `minPages` | 8 | 8 | **12** | 16 | 16 | 12 | 16 | 16 |
| `maxPages` | 20 | 24 | **32** | 32 | 40 | 32 | 36 | 40 |

## Important `2y` interpretation

For `2y`:

- **90–200 words** may be ideal for a routine, naming, highly interactive, or board-book-like story.
- **180–500 words** is a strong conventional toddler picture-book range.
- **500–750 words** can still work when repetition, rhythm, cumulative structure, recurring encounters, clear illustration support, or unusually transparent causality make the manuscript easy to follow.

A long sentence is not necessarily a difficult sentence.

A linear rhythmic sentence may be easier to process than a shorter sentence containing:

- pronoun ambiguity,
- nested clauses,
- abstract concepts,
- unclear causality,
- several motives at once.

---

# 5. Final 14-Dimension Matrix

These values use the framework's zero-based discrete levels.

| Dimension | 0–11m | 12–23m | 2y | 3y | 4–5 | 6–7 | 8–9 | 10–12 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `textDensity` | 0 | 1 | **2** | 2 | 3 | 4 | 5 | 5 |
| `sentenceComplexity` | 0 | 1 | **1** | 2 | 2 | 2 | 3 | 3 |
| `illustrationDependency` | 4 | 4 | **3** | 3 | 3 | 2 | 2 | 1 |
| `repetition` | 4 | 4 | **3** | 3 | 2 | 1 | 1 | 0 |
| `plotComplexity` | 0 | 1 | **2** | 3 | 3 | 4 | 4 | 4 |
| `castSize` | 0 | 1 | **2** | 2 | 3 | 3 | 4 | 4 |
| `dialogue` | 0 | 1 | **1** | 2 | 3 | 3 | 3 | 4 |
| `conflict` | 0 | 1 | **2** | 2 | 2 | 3 | 3 | 3 |
| `emotionalComplexity` | 0 | 0 | **1** | 1 | 2 | 2 | 2 | 3 |
| `readerInference` | 0 | 1 | **1** | 2 | 3 | 3 | 4 | 4 |
| `figurativeLanguage` | 0 | 0 | **1** | 2 | 2 | 2 | 3 | 3 |
| `subplots` | 0 | 0 | **0** | 1 | 1 | 2 | 2 | 2 |
| `interaction` | 5 | 5 | **4** | 4 | 3 | 1 | 1 | 0 |
| `sensoryLanguage` | 2 | 2 | **2** | 2 | 1 | 1 | 1 | 1 |

Three important progressions:

1. **Repetition decreases while inference increases.**
2. **Illustration dependency decreases with age in prose formats, but rises again for graphic formats.**
3. **Sentence complexity should grow more slowly than story complexity.**

---

# 6. Full Guardrail Guidance

## `0-11m`

### `language`
Use names, sounds, single concrete words and very short phrases. Prioritize words that can be seen, touched, heard or acted. Do not require pronoun tracking, abstraction or syntactic memory.

### `readAloud`
Optimize for voice before prose sophistication: elongated sounds, rhythm, alliteration, rhyme fragments, pauses and musical repetition. The adult's performance is part of the book.

### `repetition`
Make predictable repetition the primary structural mechanism. Prefer identical frame + one obvious changing element.

### `pageStructure`
Give each page one dominant perceptual target: a face, object, movement, contrast or sound.

### `storyStructure`
Plot is unnecessary. Naming sequences, greetings, body parts, sensory cycles, animals, routines, opposites and hello/goodbye structures are complete books at this age.

### `interaction`
Invite the adult to point, touch, bounce, mimic, vocalize or respond to the baby's attention. Never require a correct verbal answer from the infant.

### `visualStorytelling`
Pictures carry most meaning. One dominant subject, clear figure-ground separation, readable face/body pose and low irrelevant clutter.

### `recognition`
Faces, bodies, caregivers, animals, food, bath, sleep, clothing, toys and ordinary objects.

### `sensory`
Make sound, touch and movement central.

### `emotion`
Warmth, security, curiosity, delight, calm and tiny surprise. Recovery from uncertainty should be immediate.

### `humor`
Peekaboo, silly expressions, funny sounds and visually obvious incongruity.

### `characterArt`
Immediately readable faces and silhouettes; large expressions; minimal visually competing detail. Do not mandate one cute/cartoon style.

### `calibration`
Unlike 12–23m, comprehension must not depend on remembering a pattern across several pages or supplying a name/answer.

### `qualityTest`
Does each page work through shared attention even if the infant understands none of the printed words? Is the adult given something pleasurable to say or do?

---

## `12-23m`

### `language`
Use short concrete sentences and phrases. Explicitly name the important noun rather than overusing pronouns. Location, possession and simple actions are useful.

### `readAloud`
Write lines the child can begin anticipating. Sound effects and strongly patterned phrasing are especially effective.

### `repetition`
Still foundational. Stable phrase + changing animal/object/action is excellent.

### `pageStructure`
One action, search or reveal. Page-turn questions can now work when the answer comes quickly.

### `storyStructure`
Use routines, search/find, getting ready, movement, animal sequences, simple accumulation or very short physical cause-and-effect chains.

### `interaction`
Pointing, naming, animal sounds, body movements, finding and simple imitation. Treat prompts as invitations rather than tests.

### `visualStorytelling`
The picture should make the referent unmistakable and reward searching without requiring subtle visual deduction.

### `recognition`
Body parts, foods, animals, vehicles, clothes, bed/bath routines, in/out, up/down, open/closed and familiar places.

### `sensory`
Maintain high physicality and onomatopoeia.

### `emotion`
Wanting, waiting, delight, frustration, affection and surprise. Keep emotional transitions immediate and visible.

### `humor`
Wrong-object reveals, noises, physical incongruity and predictable pattern breaks.

### `characterArt`
Clear action silhouettes and strong expressions; more environmental context than the infant profile but still little clutter.

### `calibration`
Unlike 0–11m, toddlers can participate in a repeated pattern and anticipate familiar responses. Unlike 2y, sustained narrative goals should remain optional and very short.

### `qualityTest`
Can the child participate with a point, gesture, sound or single word? Is the pattern obvious after one or two iterations?

---

## `2y`

### `language`
Write concrete, highly comprehensible read-aloud language but **do not restrict vocabulary to words a two-year-old can produce**. Stretch vocabulary is welcome when meaning is made apparent through action, illustration, sound, repetition or immediate context. Prefer linear syntax, explicit referents and concrete verbs. Longer rhythmic sentences are allowed when syntactically easy.

### `readAloud`
Treat oral performance as fundamental. Cadence, recurring lines, sound play, character voices and well-shaped breath units may carry a substantially longer text than raw sentence length would suggest. Rhyme is optional; if selected, metre and meaning must remain natural.

### `repetition`
Use strong predictability without requiring every book to be formulaic. Repeated encounters, refrains, cumulative structures and "same pattern, new variable" sequences are particularly effective.

### `pageStructure`
One dominant event or exchange per page/spread. Maintain strong visual continuity. Page turns may create anticipation, but the child should quickly understand the payoff.

### `storyStructure`
A plot is optional. Good nonplot forms include routines, cumulative sequences and sensory journeys. When using a plot, keep one clearly trackable goal/thread and favor recurring encounters or 2–3 progressive attempts. The child should never have to remember several hidden motives simultaneously.

### `interaction`
Invite naming, sound-making, joining a refrain, prediction, very small counting tasks, movement and spotting. Do not interrupt a flowing read-aloud every page with questions.

### `visualStorytelling`
Art carries setting, expression, humor and much of the comprehension scaffolding. The text may carry a surprisingly substantial narrative as long as the image keeps the current situation clear.

### `recognition`
Independence, food, dressing, sleep, pets, siblings, playgrounds, vehicles, nature, routines, helping, familiar outings and imaginative animal adventures.

### `sensory`
Keep kinetic and sensory language prominent: splash, crunch, squish, cold, fuzzy, windy, tiptoe, boom.

### `emotion`
One clear emotional state or transition at a time—frustrated → helped, worried → secure, shy → comfortable, proud → delighted. Feelings need not be constantly named if the picture makes them obvious.

### `humor`
Repetition with a twist, physical comedy, silly substitutions, sounds, exaggerated reactions and familiar expectations being gently violated.

### `characterArt`
Expressions and body language must read instantly. Scenes can be richer than toddler board-book art but should preserve one obvious focal action.

### `calibration`
Compared with 12–23m, a two-year-old can follow a repeated goal and several connected events. Compared with 3y, motives, inference and complex social conflict should remain limited. **Longer read-aloud language is allowed; greater conceptual complexity is not automatically allowed.**

### `qualityTest`
Can the listener tell what is happening from text + illustration at every spread? Is there one main narrative thread? Does repetition or causality help memory? Does every difficult word have usable context? Would an adult enjoy rereading it?

---

## `3y`

### `language`
Use short and medium read-aloud sentences, including easy compounds and occasional transparent subordinate clauses. Introduce interesting concrete vocabulary rather than flattening prose to toddler speech.

### `readAloud`
Cadence remains extremely important. Dialogue, refrains, repeated encounters and controlled rhyme all work well.

### `repetition`
Strong but no longer required to carry the entire book. Repetition should increasingly produce escalation, prediction or comedy.

### `pageStructure`
One major beat per spread, usually with a reason to turn: response, discovery, new attempt, reveal or comic payoff.

### `storyStructure`
A recognizable plot becomes the default: protagonist want/problem → several attempts or encounters → climax/choice → satisfying consequence. Keep causal links visible.

### `interaction`
Prediction, joining refrains, spotting, answering simple questions and anticipating repeated encounters.

### `visualStorytelling`
Pictures carry setting, body language, secondary humor and easy visual clues while text carries the core causal sequence.

### `recognition`
Preschool, friendship, family routines, animals, imaginative play, fears, competence, curiosity, new experiences and helping.

### `sensory`
Still prominent but subordinate to the narrative when necessary.

### `emotion`
Anger, fear, jealousy, pride, disappointment and excitement are appropriate when easy to track.

### `humor`
Absurdity, failed attempts, exaggerated emotion, visual jokes and pattern violation.

### `characterArt`
High expressive range; clear poses; environments may now hold secondary visual information.

### `calibration`
Unlike 2y, most stories should have an actual narrative problem or desire. Unlike 4–5, avoid depending heavily on implicit motivation, sustained ambiguity or secondary plot lines.

### `qualityTest`
Can the child identify the protagonist's want? Do attempts escalate? Does the protagonist meaningfully affect the outcome? Could the story support enjoyable repeated reading?

---

## `4-5`

### `language`
Use natural picture-book prose: simple, compound and occasional subordinate sentences; meaningful stretch vocabulary; accessible metaphor and wordplay. Listening language may significantly exceed independent decoding vocabulary.

### `readAloud`
Optimize the read-aloud version for performance and rereading: rhythm, voices, breath, dramatic pauses, memorable lines and verbal surprises.

### `repetition`
Use refrains, rule-of-three structures, callbacks and running patterns when they strengthen plot or humor rather than automatically repeating every page.

### `pageStructure`
One dominant beat per page/spread; use the page turn deliberately for anticipation, revelation, reversal or visual comedy.

### `storyStructure`
Full but focused picture-book arc: setup → desire/problem → escalating attempts/obstacles → meaningful climax/choice → earned resolution. Let the child protagonist's decision matter.

### `interaction`
Prediction and discussion replace constant pointing. Direct address can still be highly successful when built into the concept.

### `visualStorytelling`
Text and illustration should each add information. Do not narrate clothing, scenery, facial expressions or jokes already obvious in the picture.

### `recognition`
Friendship, kindergarten/preschool, imagination, fairness, independence, rules, competence, family experiences, animals and discovery.

### `sensory`
Selective rather than constant.

### `emotion`
Mixed states become useful: excited but nervous, jealous yet affectionate, frightened but curious.

### `humor`
Reversal, escalating absurdity, early wordplay, dramatic irony, character behavior and comic timing.

### `characterArt`
Still highly expressive, but increase costume, prop and environmental identity. Avoid generic "cute children's illustration" constraints.

### `calibration`
Near four, retain visible causality and repetition. Near six, tolerate stronger inference, richer dialogue, longer causal chains and fair twists.

### `qualityTest`
Does every spread advance plot, character, anticipation or comedy? Does the art do meaningful narrative work? Is the resolution caused by the protagonist? Would both child and adult enjoy a twentieth reread?

---

## `6-7`

### `language`
Base cognitive language can use mixed sentence lengths, subordinate clauses, richer vocabulary and real dialogue. The active reading mode then determines how much of that vocabulary the child must personally decode.

### `readAloud`
Read-aloud mode may comfortably exceed solo decoding level. Independent mode must remain fluent and confidence-building without infantilizing story content.

### `repetition`
Use callbacks, running gags and recurring phrases as literary texture rather than structural necessity.

### `pageStructure`
One meaningful scene beat or short sequence per page/spread. Use discoveries, decisions and unanswered questions as propulsion.

### `storyStructure`
Strong goal, multiple obstacles, meaningful attempts, consequence and protagonist-driven resolution. Mysteries, quests and friendship problems work particularly well.

### `interaction`
Primarily suspense, clues, prediction and empathy rather than explicit "Can you count?" prompts.

### `visualStorytelling`
Pictures aid comprehension, mood, humor and clues but no longer need to carry every essential action unless format = graphic story.

### `recognition`
School, peer friendship, fairness, competence, hobbies, rules, embarrassment, mistakes, responsibility, animals and adventure.

### `sensory`
Ground scenes in physical detail without decorating every sentence.

### `emotion`
Embarrassment, disappointment, unfairness, jealousy, pride, worry and failure can carry genuine story stakes.

### `humor`
Wordplay, banter, misunderstandings, running jokes, exaggeration.

### `characterArt`
Distinct identities, readable expressions, somewhat busier scenes and more character interaction.

### `calibration`
Near six, goals and motives should remain obvious. Near eight, allow stronger clues, twists and one light secondary thread.

### `qualityTest`
Does the protagonist make decisions? Does each obstacle alter what happens next? Can the reader infer something meaningful? Is decoding difficulty appropriate to the selected mode rather than merely the age?

---

## `8-9`

### `language`
Varied syntax, real vocabulary, idioms and increasingly distinctive narrative voice. Context should support unfamiliar words rather than eliminating them.

### `readAloud`
Preserve strong prose rhythm even when independent reading is primary.

### `repetition`
Literary callbacks, motifs or running jokes rather than scaffolding.

### `pageStructure`
A page may carry a scene rather than one atomic action. Use scene endings to create forward momentum.

### `storyStructure`
Multi-stage adventure, mystery, competition or social problem with reversals and one meaningful secondary thread.

### `interaction`
Cognitive participation: interpret clues, anticipate consequences, judge choices and understand unstated feelings.

### `visualStorytelling`
Highly format-dependent. Illustrations may simply enrich prose or may carry the entire narrative grammar of a graphic story.

### `recognition`
Peer groups, loyalty, autonomy, school dynamics, competence, hobbies, teams, rules, belonging and early identity concerns.

### `sensory`
Specific, purposeful details that establish place or action.

### `emotion`
Guilt, resentment, loyalty, self-doubt, disappointment and conflicting feelings.

### `humor`
Banter, irony, embarrassment, callbacks, exaggeration and distinctive narrator voice.

### `characterArt`
Age-respectful proportions and expressions; visual design can become significantly more sophisticated.

### `calibration`
Near eight, reveal most important causal information clearly. Near ten, allow stronger subtext, delayed revelation and ambiguity.

### `qualityTest`
Do decisions have consequences? Are clues fair? Does the secondary thread contribute to the main arc? Is some information intentionally left for the reader to infer?

---

## `10-12`

### `language`
Use full middle-grade language: varied sentence architecture, precise vocabulary, idioms, metaphor and distinctive voices. Complexity should serve voice or meaning rather than showing off vocabulary.

### `readAloud`
Still optimize for cadence, but no nursery-like linguistic requirement.

### `repetition`
Optional thematic motifs and deliberate callbacks only.

### `pageStructure`
In long-form formats, think in scenes and chapters rather than page beats.

### `storyStructure`
Multi-stage goals, reversals, real consequences, changing relationships and secondary threads. Internal character change may matter as much as external success.

### `interaction`
Entirely cognitive unless the format deliberately breaks the fourth wall: theories, motives, empathy, moral judgment, irony and anticipation.

### `visualStorytelling`
Fully format-dependent. Chapter fiction may need little visual narrative; graphic fiction may need almost all narrative action encoded visually.

### `recognition`
Identity, loyalty, independence, changing friendships, status, responsibility, family tension, injustice, belonging and competence.

### `sensory`
Precise physical detail serving scene, atmosphere or character.

### `emotion`
Nuanced and contradictory. Characters may remain angry, grieving, guilty, jealous or uncertain across substantial parts of a book.

### `humor`
Wit, irony, character banter, awkwardness, social observation and sophisticated running jokes.

### `characterArt`
Never infantilize. Match the selected visual style while preserving believable age, subtle expressions and visual identity.

### `calibration`
Near ten, major emotional and causal transitions may remain explicit. Near twelve, trust subtext, competing perspectives, thematic ambiguity and delayed explanations.

### `qualityTest`
Does the protagonist genuinely choose? Do choices carry consequences? Do subplots converge meaningfully? Does theme emerge through events rather than being announced as a moral? Does the book respect the reader's intelligence?

---

# 7. Reading Modes for Ages 4+

Reading mode should modify **decoding demand**, not emotional/cognitive dignity.

| Band | Mode | Core effect |
|---|---|---|
| 4–5 | **read-aloud** | Richest vocabulary and syntax; adult does decoding. Preserve picture-book literary quality. |
| 4–5 | **with-help** | Familiar vocabulary, repeated patterns and picture support; occasional stretch word with adult assistance. |
| 4–5 | **independent** | Emergent reading: explicit syntax, high-frequency/decodable vocabulary, short lines and strong picture context. |
| 6–7 | **read-aloud** | Cognitive level remains 6–7, but vocabulary/sentence complexity can run ahead of independent reading. |
| 6–7 | **with-help** | Child reads most; adult bridges occasional difficult words/sentences. |
| 6–7 | **independent** | Short/medium sentences, explicit referents, controlled vocabulary and short paragraphs. |
| 8–9 | **read-aloud** | Rich language, description and syntax; do not restrict to decoding level. |
| 8–9 | **with-help** | Reduce linguistic load while preserving the same plot, humor and emotional complexity. |
| 8–9 | **independent** | Real prose with varied syntax and context-supported unfamiliar vocabulary. |
| 10–12 | **read-aloud** | Full age-level literary complexity. |
| 10–12 | **with-help** | Accessible language without age regression; useful for dyslexic, multilingual and developing readers. |
| 10–12 | **independent** | Full middle-grade syntax, figurative language, inference and voice. |

Core principle:

> **Simplify decoding, not dignity.**

---

# 8. Format Presets for Ages 6+

Page count and textual density should not be treated as pure age properties.

## Recommended structure presets

| Age | Format | Words | Pages | Target / max words-page | Max sentence | Beats |
|---|---|---:|---:|---:|---:|---:|
| 6–7 | Illustrated short | 450–1,500 | 12–32 | 55 / 105 | 30 | 8 |
| 6–7 | Early reader | 700–2,800 | 24–72 | 45 / 80 | 20 | 10 |
| 6–7 | Graphic story | 600–2,400 | 24–80 | 32 / 65 | 18 | 10 |
| 6–7 | Chapter fiction | 2,500–7,000 | 32–96 | 95 / 170 | 30 | 12 |
| 8–9 | Illustrated short | 700–2,200 | 16–36 | 75 / 145 | 34 | 9 |
| 8–9 | Accessible/early reader | 1,400–4,500 | 32–80 | 60 / 105 | 24 | 12 |
| 8–9 | Graphic story | 1,200–5,000 | 32–120 | 45 / 90 | 22 | 12 |
| 8–9 | Chapter fiction | 5,500–15,000 | 48–160 | 115 / 210 | 38 | 16 |
| 10–12 | Illustrated short | 1,000–3,000 | 16–40 | 100 / 190 | 40 | 10 |
| 10–12 | Accessible reader | 2,200–7,000 | 40–100 | 75 / 130 | 28 | 14 |
| 10–12 | Graphic story | 1,800–7,000 | 40–160 | 50 / 100 | 26 | 14 |
| 10–12 | Short chapter fiction | 12,000–20,000 | 96–200 | 130 / 240 | 45 | 22 |

## Dimension changes by format

| Dimension | Illustrated short | Early/access reader | Graphic story | Chapter fiction |
|---|---|---|---|---|
| `textDensity` | age baseline | usually −1 | usually −1/−2 | **6** |
| `sentenceComplexity` | baseline | −1 | −1 | baseline/+1 |
| `illustrationDependency` | baseline | +1 | **4** | **0–1** |
| `repetition` | baseline | +0/+1 | baseline | baseline |
| `plotComplexity` | baseline | baseline | baseline | +0/+1 |
| `dialogue` | baseline | baseline | usually +1 | baseline/+1 |
| `readerInference` | baseline | −1 for decoding-critical info | same or +1 visually | +0/+1 |
| `subplots` | baseline | same/−1 | baseline | +1 where room permits |

Graphic fiction should **not** be treated as a lower-literacy version of prose.

---

# 9. Story Craft Configuration

Story Craft should offer curated choices that materially alter the generated story.

| Band | Themes | Strong devices | Settings |
|---|---|---|---|
| **0–11m** | closeness, faces, body, animals, bedtime, sensory discovery | naming cycle, repeated frame, sound play, contrast pairs, peekaboo reveal, lullaby rhythm | home, lap/bedtime, bath, garden, gentle outdoors |
| **12–23m** | routines, animals, movement, autonomy, finding things, helping, everyday discovery | refrain, search/reveal, call-and-response, sound words, cumulative sequence, page-turn reveal, tiny counting | home, park, farm, zoo, street, bath, bedroom |
| **2y** | independence, routines, friendship, helping, lost-and-found, animal adventure, small fears, new experiences, bedtime | refrain, cumulative encounters, rule of three, rhythmic rhyme, sound play, circular return, page-turn reveal | home, garden, woods, farm, seaside, neighborhood, one-rule magical place |
| **3y** | friendship, courage, curiosity, feelings, first experiences, fairness, persistence, mistakes, imagination | rule of three, refrain, rhyme, cumulative structure, direct address, surprise ending, running visual gag | preschool, home, playground, woods, farm, seaside, town, magical place |
| **4–5** | friendship, belonging, courage, fairness, mistakes/repair, persistence, jealousy, family change, invention, mystery-lite | rule of three, running gag, refrain, dialogue-led story, first person, direct address, fair twist, visual irony, controlled rhyme | kindergarten, neighborhood, museum, woods, transport, space, fantasy world with simple rules |
| **6–7** | friendship, school, fairness, competence, honesty, responsibility, invention, teamwork, mystery, quest, animals | dialogue-led, clues, running gag, first person, simple diary/messages, fair twist, light foreshadowing, chapter hooks | school, neighborhood, library, camp, forest, castle, space station, simple fantasy |
| **8–9** | belonging, loyalty, rivalry, confidence, responsibility, mystery, adventure, justice, discovery, family change, survival-lite | suspense, fair twist, foreshadowing, chapter hooks, first person, diary/messages, dramatic irony, light dual POV | school, town, wilderness, expedition, historical setting, fantasy world, space |
| **10–12** | identity, loyalty, moral choice, injustice, grief/change, ambition, rivalry, responsibility, family tension, mystery, survival, legacy | foreshadowing, multiple POV, epistolary form, dramatic irony, chapter hooks, fair twist, parallel threads, light dual timeline, limited unreliable narration | school/community, small town, wilderness, historical period, detailed fantasy, near future, space |

`rhyme` should remain a **device**, not an age requirement.

---

# 10. Protagonist Calibration

| Band | `minAge` | `maxAge` | Default |
|---|---:|---:|---:|
| 0–11m | 0 | 2 | 1 |
| 12–23m | 1 | 3 | 2 |
| 2y | 2 | 4 | 3 |
| 3y | 3 | 5 | 4 |
| 4–5 | 4 | 7 | 5 |
| 6–7 | 6 | 9 | 7 |
| 8–9 | 8 | 11 | 9 |
| 10–12 | 10 | 13 | 11 |

Recommended guidance:

> When inventing a child protagonist, prefer roughly {{min}}–{{max}} years. When the customer supplies the real child's age or identity, preserve it; calibrate agency and situations around that child instead of silently aging them up. Animal, fantasy, adult or object protagonists are allowed when the story concept calls for them.

---

# 11. Safety Progression

## 0–11m
Security dominates. Avoid sustained threat or unresolved separation.

## 12–23m
Brief lost/search moments and frustration are fine, but reassurance follows rapidly.

## 2y
Mild fear, hungry predators, storms, things breaking, getting lost briefly and similar classic picture-book tension can work when strongly stylized and securely resolved.

Two-year-old accessible does **not** mean nothing scary can happen.

## 3y
Several beats of danger or social/emotional tension are acceptable with visible recovery.

## 4–5
Genuine conflict, jealousy, anger, fear and failure are healthy story material. Avoid sustained terror or cruelty, not uncomfortable emotions.

## 6–7
Real failure, embarrassment, injustice and suspense are fine. Resolution should restore hope rather than erase every consequence.

## 8–9
Grief, exclusion, family change, serious mistakes and meaningful consequences can appear. The ending may leave some issues open.

## 10–12
Allow difficult emotions, grief, moral ambiguity, injustice and bittersweet outcomes. Do not force an artificially happy ending beyond the platform-wide mandatory safety floor.

Core principle:

> **Conflict is not a defect. It is often the mechanism through which agency, emotion and growth become meaningful.**

---

# 12. Recommended Evaluation Dimensions

| Band | Most diagnostic `evaluatedDimensionIds` |
|---|---|
| 0–11m | `textDensity`, `illustrationDependency`, `repetition`, `interaction`, `sensoryLanguage`, `conflict` |
| 12–23m | `textDensity`, `sentenceComplexity`, `illustrationDependency`, `repetition`, `interaction`, `readerInference` |
| 2y | `textDensity`, `sentenceComplexity`, `repetition`, `plotComplexity`, `readerInference`, `conflict`, `illustrationDependency` |
| 3y | `textDensity`, `sentenceComplexity`, `plotComplexity`, `repetition`, `conflict`, `readerInference`, `interaction` |
| 4–5 | `textDensity`, `sentenceComplexity`, `plotComplexity`, `conflict`, `emotionalComplexity`, `readerInference`, `illustrationDependency` |
| 6–7 | `textDensity`, `sentenceComplexity`, `plotComplexity`, `dialogue`, `conflict`, `readerInference`, `illustrationDependency` |
| 8–9 | `textDensity`, `sentenceComplexity`, `plotComplexity`, `dialogue`, `emotionalComplexity`, `readerInference`, `subplots` |
| 10–12 | `sentenceComplexity`, `plotComplexity`, `dialogue`, `conflict`, `emotionalComplexity`, `readerInference`, `figurativeLanguage`, `subplots` |

One implementation caveat:

`textDensity` and `sentenceComplexity` are profile-wide dimensions while reading-mode guidance is mode-specific.

An independent 4–5 book may intentionally be substantially simpler than its read-aloud sibling. The evaluator should therefore understand that a reading mode can legitimately **lower decoding complexity below the base age ceiling** rather than automatically flagging it as under-complex.

---

# 13. What Is Actually Going On at Each Age?

| Age | The essence |
|---|---|
| **0–11m** | **The book is an interaction object.** Voice, face, touch, rhythm, image and attachment matter more than plot. |
| **12–23m** | **Recognition becomes participation.** Pointing, naming, noises, predictable patterns and simple reveals dominate. |
| **2y** | **Narrative memory starts becoming useful—but read-aloud capacity is much larger than simplistic toddler-language rules suggest.** A toddler can enjoy a substantial picture-book story if causality, visuals and verbal pattern keep it legible. |
| **3y** | **Story becomes a real structure.** Wants, problems, attempts, anticipation and resolution become central while repetition remains powerful. |
| **4–5** | **This is full picture-book territory.** Children can handle clever plots, mixed feelings, rich listening vocabulary, visual inference and active protagonists. Reading ability now begins diverging sharply from listening ability. |
| **6–7** | **Decoding is often the bottleneck, not comprehension.** The same child may enjoy a sophisticated read-aloud while needing heavily scaffolded solo prose. Reading mode and format become essential. |
| **8–9** | **Fluency releases cognitive bandwidth.** Motive, clues, inference, twists, voice and secondary threads become more important. Graphic and prose formats diverge strongly. |
| **10–12** | **The child becomes an interpretive reader.** Identity, perspective, moral ambiguity, relationships, consequence and subtext can carry the story. Birthday alone now tells comparatively little without reading ability and format. |

---

# 14. Recommended Childbook Studio Architecture in One View

Avoid thinking in the old model:

**0–2 = board book → 3–5 = picture book → 6–8 = longer picture book → 9–12 = even more words**

Use instead:

### 0–23 months
**Shared sensory / interactive reading**

### 2–3 years
**Increasingly sophisticated read-aloud picture books**

### 4–5 years
**Full picture books + emergent-reader modes**

### 6+ years
**Age × decoding mode × format**

This solves the *Gruffalo* problem cleanly.

Shared reading gives young children access to language substantially above their independent production/decoding level. Successful children's publishing increasingly separates:

- what a child can understand,
- what a child can decode,
- what kind of story they can cognitively follow,
- and what physical/narrative form the book takes.

That should be the foundation for Childbook Studio's audience system.

---

# Research and Market References

These sources informed the calibration and should be treated as evidence for market practice, developmental/literacy principles, or publishing guidance—not as proof of hard universal age thresholds.

- American Academy of Pediatrics — Literacy Promotion / Shared Reading  
  https://publications.aap.org/pediatrics/article/154/6/e2024069091/199468/Literacy-Promotion-An-Essential-Component-of

- Reading Rockets — Repeated Interactive Read-Alouds  
  https://www.readingrockets.org/topics/comprehension/articles/repeated-interactive-read-alouds-preschool-and-kindergarten

- Penguin UK — How to Write a Children's Picture Book  
  https://www.penguin.co.uk/discover/articles/how-to-write-childrens-picture-book

- Penguin UK — How to Write a Children's Middle Grade Book  
  https://www.penguin.co.uk/about/company-articles/how-to-write-a-children-s-middle-grade-book

- Macmillan — The Gruffalo  
  https://www.panmacmillan.com/authors/julia-donaldson/the-gruffalo/9781509830398

- Simon & Schuster — Dear Zoo  
  https://www.simonandschuster.com/books/Dear-Zoo/Rod-Campbell/Dear-Zoo-Friends/9780027164404

- Penguin Random House — The Very Hungry Caterpillar  
  https://www.penguinrandomhouse.com/books/301943/the-very-hungry-caterpillar-by-eric-carle/

- Disney Books — Don't Let the Pigeon Drive the Bus!  
  https://books.disney.com/book/dont-let-the-pigeon-drive-the-bus/

- Disney Books — Elephant & Piggie  
  https://books.disney.com/book/elephant-piggie-the-complete-collection/

- Scholastic — Acorn  
  https://www.scholastic.com/parents/books-and-reading/book-lists-and-recommendations/scholastic-branches-acorn-books.html

- Scholastic — Branches  
  https://www.scholastic.com/site/branches.html

- Penguin Random House — Magic Tree House: Dinosaurs Before Dark  
  https://www.penguinrandomhouse.com/books/125113/dinosaurs-before-dark-by-mary-pope-osborne-illustrated-by-sal-murdocca/

- Scholastic — Dav Pilkey / Dog Man  
  https://www.scholastic.com/site/dav-pilkey-books/about-dav-pilkey.html

- Penguin Random House — Wonder  
  https://www.penguinrandomhouse.com/books/208913/wonder-by-r-j-palacio/

- Disney Books — Percy Jackson and the Lightning Thief  
  https://books.disney.com/book/percy-jackson-and-the-olympians-book-one-the-lightning-thief/
