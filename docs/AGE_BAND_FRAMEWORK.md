# Children's Book Age Band & Audience Profile Authoring Framework

This framework is the product-specific specification for configuring **Audience Profiles (Age Bands)** for AI-driven children's books.

It gives an LLM the schema, editorial rubric, prompt routing, resolution behavior, and validation checks needed to author, calibrate, or audit a profile. Treat the TypeScript implementation as the final authority if this document and code ever diverge:

- `books-frontend/src/core/config/audienceCatalog.ts` — fields, dimensions, sections, channels, shipped profiles.
- `books-frontend/src/core/config/audience.ts` — persisted override schema, normalization, merge, inheritance, lookup, diagnostics.
- `books-frontend/src/core/prompts/audience.ts` — exact compiled overlays.
- `books-frontend/src/core/pipeline/storyValidate.ts` and `screenplayFit.ts` — deterministic runtime checks.

The developmental guidance here is an editorial baseline, not a clinical assessment or universal claim about every child. Adapt guidance for language, culture, disability, neurodiversity, reading context, and the intended product format without lowering dignity or safety.

---

## 1. System Architecture & Editorial Philosophy

### 1.1 Separation of Structure and Content
The platform enforces a strict separation of concerns:
- **CODE Owns Structure:** The TypeScript codebase defines which dimensions exist, which guardrail sections exist, and which **compiler channels** consume them.
- **ADMINS & LLMs Own Content:** The age band definitions, month boundaries, quantitative boundaries, editorial prose, dimension level assignments, reading modes, and safety guidelines.

### 1.2 The 6 Prompt Overlay Channels
An audience profile is **not** injected as a single monolithic block of text into prompts. Sending prose rules to image models wastes tokens and degrades visual quality; sending page-turn instructions to story drafting confuses the narrative arc. 

The profile compiler extracts specific sections and dimensions into **6 isolated channels**:

| Channel | Target Consumer / Pipeline Step | What It Receives | What It Strictly Excludes |
| :--- | :--- | :--- | :--- |
| `human` | Wizard/customer-facing guidance | Only the resolved mode's `humanGuidance`. `caption` and `description` are separate profile metadata used by UI. | Prompt directives and rubric rows. |
| `story` | Manuscript drafting, translation, and revision | Mode `storyGuidance`; Language, Read-Aloud, Repetition, Story Structure, Interaction, Recognition, Sensory, Emotion, Humour, Calibration, Quality Test; 13 routed dimensions. | Page Structure, Visual Storytelling, Character Art, and `illustrationDependency`. |
| `screenplay` | Pagination, scene breakdown, illustrator briefs | Repetition, Page Structure, Interaction, Visual Storytelling, Emotion, Humour, Calibration, Quality Test; 6 routed dimensions. The separate `density` string is also used by screenplay prompts. | Language, Read-Aloud, Story Structure, Recognition, Sensory, Character Art. |
| `illustration` | Page and cover image generation | Visual Storytelling, Recognition, Sensory, Emotion, Humour; 5 routed dimensions. | Character Art, prose mechanics, sentence limits, and read-aloud notes. |
| `characterArt` | Character reference-sheet generation | The age label and `characterArt` section only. | Protagonist guidance, manuscript text, scene layout, and pacing. |
| `evaluation` | Automated reading-level/editorial evaluator | The 10 evaluation-routed sections and all configured evaluation-routed dimensions. | Recognition, Sensory, Humour, and Character Art sections. |

The compiler also returns four independent values that are **not overlay channels**: `density`, `safetyList`, `safetyNote`, and `protagonist`. Their downstream prompt templates decide where to insert them. Do not assume that putting content in one of the six channels also supplies these values.

`evaluatedDimensionIds` does not filter the compiled `evaluation` overlay. That overlay contains every configured dimension whose channel includes `evaluation` (currently all 14). The separate `evaluationRubric()` uses `evaluatedDimensionIds` to choose which rows the evaluator must score and return by ID; when the list is empty it uses every configured dimension.

### 1.3 What an Age Band Represents

Do not treat chronological age as a complete reading model. A profile combines at least four axes:

1. **Chronological/developmental audience:** likely interests, emotional regulation, attention, memory, and visual processing—always with individual variation.
2. **Decoding demand:** what a child can read independently.
3. **Listening comprehension:** language a child can understand when another person reads.
4. **Product format:** board book, picture book, illustrated early reader, short personalized story, or conventional chapter book.

`readingModes` separates decoding from listening within one age range. The guardrail sections and numeric fields encode product format. If two groups need materially different plot shape, density, interaction, or visual dependency, create separate profiles or an inherited sub-band; if only decoding support differs, prefer reading modes.

Choose boundaries where the editorial contract changes, not merely at round birthdays. For a broad band, use `calibration` to describe both endpoints. Do not claim that an age alone establishes reading level, attention span, vocabulary, or emotional readiness.

---

## 2. Complete Data Contract & Type Specification

Every audience profile must conform to the following TypeScript interfaces and Zod schemas:

### 2.1 TypeScript Interfaces

```typescript
export type OverlayChannel = 
  | "human"
  | "story"
  | "screenplay"
  | "illustration"
  | "characterArt"
  | "evaluation";

export type ReadingModeId = "read-aloud" | "with-help" | "independent";
export type ModeKey = "default" | ReadingModeId;

export interface ModeGuidance {
  /** Customer-facing description in setup wizard (max 4,000 chars) */
  humanGuidance: string;
  /** Appended directly to the story overlay prompt for this reading mode (max 8,000 chars) */
  storyGuidance: string;
}

export interface AudienceDimension {
  /** 0-indexed integer corresponding to the dimension's defined discrete levels */
  level: number;
  /** Specific prompt instruction elaborating on this level (max 2,000 chars) */
  guidance: string;
}

export interface AudienceStructure {
  /** Total book minimum word count (1 - 20,000) */
  minWords: number;
  /** Total book maximum word count (1 - 20,000) */
  maxWords: number;
  /** Approximate number of narrative story beats or repetition cycles (1 - 40) */
  beats: number;
  /** Hard upper limit on words in a single sentence (0 disables the check) (0 - 200) */
  maxSentenceWords: number;
  /** Whether a conventional beginning-middle-end plot is required (false for infant/toddler books) */
  plotRequired: boolean;
}

export interface AudienceDensity {
  /** Average words targeted for a single typical page (0 - 2,000) */
  targetWordsPerPage: number;
  /** Absolute maximum ceiling for words on any single page (0 - 4,000) */
  maxWordsPerPage: number;
  /** Average target sentences per page (0 - 50) */
  targetSentencesPerPage: number;
  /** Maximum distinct characters sharing one illustration before cluttering (1 - 20) */
  maxFocalCharactersPerScene: number;
  /** Minimum page budget for pacing calculation (1 - 400) */
  minPages: number;
  /** Maximum page budget for pacing calculation (1 - 400) */
  maxPages: number;
}

export interface AudienceProtagonist {
  /** Minimum recommended protagonist age in years (0 - 120) */
  minAge: number;
  /** Maximum recommended protagonist age in years (0 - 120) */
  maxAge: number;
  /** Prompt template with {{min}} and {{max}} placeholders (max 1,000 chars) */
  guidance: string;
}

export interface AudienceSafety {
  /** Specific topics, themes, or triggers forbidden for this age band (max 60 items, 300 chars each) */
  avoid: string[];
  /** Editorial note guiding safe emotional resolution (max 1,000 chars) */
  note: string;
}

export interface AudienceProfile {
  /** Unique kebab-case identifier: /^[a-z0-9][a-z0-9-]*$/ (e.g. "0-2", "3-5", "6-8", "0-12m") */
  id: string;
  /** Display label shown across UI and prompts (e.g. "3–5 years") (max 80 chars) */
  label: string;
  /** 2-4 words of publishing categorization (e.g. "Picture books", "Board books") (max 60 chars) */
  caption: string;
  /** Single-line summary for the age picker UI (max 400 chars) */
  description: string;
  /** Inclusive lower bound in months (0 - 1,200) */
  minMonths: number;
  /** Inclusive upper bound in months (0 - 1,200) */
  maxMonths: number;
  /** Display sort order in admin dashboard / picker (0 - 10,000) */
  order: number;
  /** Whether visible in customer-facing pickers (disabled profiles remain functional for existing books) */
  enabled: boolean;
  /** Alternative historical or alias IDs that resolve to this profile */
  aliases: string[];
  /** Optional ancestor profile ID for inheritance (e.g. "0-12m" extends "0-2") */
  extendsId?: string;
  /** Allowed reading modes (empty [] if band has no reading-mode split) */
  readingModes: ReadingModeId[];
  /** Map of reading mode guidance keyed by 'default' or ReadingModeId */
  modes: Partial<Record<ModeKey, ModeGuidance>>;
  /** Map of 14 guardrail section texts keyed by section ID */
  sections: Record<string, string>;
  /** Map of 14 dimension values keyed by dimension ID */
  dimensions: Record<string, AudienceDimension>;
  /** Whole-manuscript structural parameters */
  structure: AudienceStructure;
  /** Page-level density and pacing parameters */
  density: AudienceDensity;
  /** Protagonist age range and template guidance */
  protagonist: AudienceProtagonist;
  /** Explicit age in years for any character whose age the story does not state */
  defaultCharacterAgeYears: number;
  /** Age-specific safety rules (supplementing mandatory baseline) */
  safety: AudienceSafety;
  /** Dimension IDs actively evaluated during reading-level quality checks */
  evaluatedDimensionIds: string[];
}
```

### 2.2 Resolved Profiles vs Persisted Overrides

`AudienceProfile` above is the **fully resolved runtime shape**. The persisted admin document is:

```typescript
interface AudienceConfig {
  version: 1;
  profiles: AudienceProfileOverride[];
  /** Deleted IDs are hidden everywhere new books are configured, while their profile snapshots remain resolvable. */
  deletedProfileIds?: string[];
  updatedAt?: number;
  revision?: number;
}
```

An `AudienceProfileOverride` requires only `id`; every other top-level field is optional. However, when any nested object is supplied, that nested object must be complete:

- `structure` requires all five structure fields.
- `density` requires all six density fields.
- `protagonist` requires `minAge`, `maxAge`, and `guidance`.
- `safety` requires both `avoid` and `note`.
- Every supplied mode requires both guidance strings.
- Every supplied dimension requires both `level` and `guidance`.

Choose the output shape explicitly:

1. **New custom band:** output a fully populated `AudienceProfile` inside `{ "version": 1, "profiles": [...] }`. This avoids accidental dependence on fallback values.
2. **Override shipped band:** output the smallest intentional `AudienceProfileOverride` inside the same envelope, unless a caller explicitly requests a resolved full profile.
3. **Dashboard import/manual editing:** the current dashboard stores a fully resolved band after the first edit, even though the backend schema accepts sparse overrides.
4. **Analysis only:** return findings and proposed changes; do not imply they have been persisted.

Do not add comments to JSON, unknown section IDs, unknown dimension IDs, or invented reading-mode keys.

Exact persisted limits:

- Config: `version` must equal `1`; at most 40 profiles; `deletedProfileIds` contains at most
  40 valid profile IDs; `updatedAt` is optional number; `revision` is optional nonnegative integer.
- At least one current profile must remain after applying `deletedProfileIds`.
- `id`: 1–40 characters and `/^[a-z0-9][a-z0-9-]*$/`.
- `label`: at most 80 characters; `caption`: 60; `description`: 400.
- `minMonths`/`maxMonths`: integers 0–1200; `order`: integer 0–10000.
- `aliases`: at most 20 strings, each 1–40 characters. Alias uniqueness is a semantic responsibility.
- `extendsId`: at most 40 characters.
- `readingModes`: at most three values from the fixed enum.
- Section text: at most 20,000 characters per key.
- `evaluatedDimensionIds`: at most 30 nonempty strings, each at most 60 characters.
- Numeric and text limits inside nested objects are documented in the interfaces above.

### 2.3 Schema Limits vs Semantic Limits

The persisted schema accepts a dimension `level` from 0 through 20, then the compiler clamps it to the dimension's real level range. A production-quality author must use the actual range shown in Section 4; relying on clamping hides errors.

Normalization silently drops:

- malformed profiles;
- later profiles with duplicate IDs.
- malformed and duplicate deleted-profile IDs.

Merge silently ignores:

- unknown section IDs;
- unknown dimension IDs;
- mode keys other than `default`, `read-aloud`, `with-help`, and `independent`.

Passing schema validation therefore does **not** prove that a profile is meaningful. Apply the semantic checks in Sections 5, 8, and 9.

### 2.4 Mandatory Global Safety Floor
All profiles automatically inherit the platform-wide mandatory safety baseline. The `safety.avoid` array in a profile **adds** to this list; it can never remove or override it:
- `"graphic violence, gore, brutality, or severe injury"`
- `"sexual content of any kind"`
- `"slurs, bullying framed approvingly, or cruelty played for laughs"`
- `"unresolved fear at the end of the story"`

---

## 3. The 14 Guardrail Sections (Editorial Prose)

Each guardrail section is a named, structured editorial essay. When compiling prompts, the system extracts only the sections routed to that channel and prepends the official uppercase heading.

```
+---------------------------------------------------------------------------------------+
|                                14 GUARDRAIL SECTIONS                                  |
+----------------------+------------------------------------+---------------------------+
| SECTION ID           | COMPILED HEADING                   | TARGET CHANNELS           |
+----------------------+------------------------------------+---------------------------+
| language             | LANGUAGE                           | story, evaluation         |
| readAloud            | READ-ALOUD QUALITY                 | story, evaluation         |
| repetition           | REPETITION & PREDICTABILITY        | story, screenplay, eval   |
| pageStructure        | PAGE STRUCTURE                     | screenplay, evaluation    |
| storyStructure       | STORY STRUCTURE                    | story, evaluation         |
| interaction          | INTERACTION                        | story, screenplay, eval   |
| visualStorytelling   | VISUAL STORYTELLING                | screenplay, illus, eval   |
| recognition          | RECOGNITION & LEARNING             | story, illustration       |
| sensory              | SENSORY LANGUAGE                   | story, illustration       |
| emotion              | EMOTION & CONFLICT                 | story, screenplay, ill, ev|
| humor                | HUMOUR                             | story, screenplay, illus  |
| characterArt         | CHARACTER DESIGN FOR THIS AGE      | characterArt              |
| calibration          | AGE CALIBRATION                    | story, screenplay, eval   |
| qualityTest          | QUALITY TEST                       | story, screenplay, eval   |
+----------------------+------------------------------------+---------------------------+
```

### Detailed Editorial Directives per Section:

#### 1. `language` (`story`, `evaluation`)
- **Focus:** Vocabulary ceilings, sentence construction, phonetic clarity, grammatical syntax.
- **Rules:** Detail sentence-shape expectations (e.g. subject-verb-object vs compound vs complex). State what to prefer and what to discourage for this specific band rather than imposing universal bans. Specify how unfamiliar or stretch vocabulary gets enough context.

#### 2. `readAloud` (`story`, `evaluation`)
- **Focus:** Cadence, rhythm, performer experience, acoustic satisfaction.
- **Rules:** Determine the actual reading mode rather than assuming every child under eight is read to. For read-aloud use, guide phonetic bounce, alliteration, assonance, rhyme discipline (never sacrifice meaning for rhyme), dialogue pacing, and breath pauses. Independent prose should still sound natural aloud.

#### 3. `repetition` (`story`, `screenplay`, `evaluation`)
- **Focus:** Refrains, recurring linguistic structures, pattern variations.
- **Rules:** Define how repetition is used (e.g., as a foundational spine for toddlers vs running gags for 6–8 vs deliberate thematic motifs for 9–12). Specify the "pattern + one variable" rule where the sentence structure stays identical while one concrete noun/action changes.

#### 4. `pageStructure` (`screenplay`, `evaluation`)
- **Focus:** Single-page job, pacing, page-turn dynamics.
- **Rules:** Governs pagination and scene layout. For picture-book bands, usually enforce one dominant beat per page or spread and define useful page-turn hooks. Older/dense bands may carry a scene rather than a single beat, so calibrate this rule instead of applying it universally.

#### 5. `storyStructure` (`story`, `evaluation`)
- **Focus:** Narrative architecture, causality, protagonist agency.
- **Rules:** Define the whole-book shape (naming cycle, daily routine, 3-beat search, 5-beat problem/solution, 7-beat hero journey, or multi-chapter arc). Specify causality (physical cause-and-effect vs emotional vs systemic). Detail protagonist agency (the child must solve the problem; adults may comfort but not fix).

#### 6. `interaction` (`story`, `screenplay`, `evaluation`)
- **Focus:** Participatory mechanics, reader engagement.
- **Rules:** Specify how the child engages with the book. For 0–2: physical sounds, pointing, imitating. For 3–5: call-and-response, spotting items, answering direct questions. For 6–8+: cognitive involvement, solving clues, empathy, suspense.

#### 7. `visualStorytelling` (`screenplay`, `illustration`, `evaluation`)
- **Focus:** Text-to-image division of labor.
- **Rules:** Avoid unnecessary text-picture duplication, while allowing repetition when it supports comprehension, rhythm, accessibility, or deliberate irony. Define what text carries and what art carries. Guide composition complexity from one dominant subject for very young readers toward more detailed staging for older readers.

#### 8. `recognition` (`story`, `illustration`)
- **Focus:** Developmental concepts, world knowledge, relatable iconography.
- **Rules:** Detail what concepts this age loves recognizing (e.g., animals, body parts, routines for toddlers; friendship, school, fairness, independence for early readers; identity, loyalty, belonging for chapter books). Avoid preachy didacticism.

#### 9. `sensory` (`story`, `illustration`)
- **Focus:** Physicality, onomatopoeia, texture, sound, somatic grounding.
- **Rules:** Detail sound words (*splash, crunch, beep, whoosh*), tactile descriptions (*sticky, cold, fuzzy, prickle*), and physical embodiment.

#### 10. `emotion` (`story`, `screenplay`, `illustration`, `evaluation`)
- **Focus:** Emotional range, conflict scale, resolution timeline.
- **Rules:** Define acceptable stakes and recovery time. For toddlers, use brief and quickly resolved uncertainty. For preschoolers, use relatable social/emotional struggle with clear reassurance. For older readers, genuine dilemmas, self-doubt, loss, and consequential mistakes may be appropriate. The exact ending constraint belongs in the profile's `safety.note`; do not silently impose a happier rule than that profile specifies.

#### 11. `humor` (`story`, `screenplay`, `illustration`)
- **Focus:** Age-appropriate comedic mechanisms.
- **Rules:** Choose mechanisms that fit the reader and reading mode. Typical options progress from sound, repetition, visual surprise, and physical incongruity toward wordplay, running gags, character banter, irony, and subtext. Treat these as options, not rigid age gates.

#### 12. `characterArt` (`characterArt`)
- **Focus:** Image prompt directives for character reference sheets.
- **Rules:** Specify proportions, face readability, silhouette clarity, costume identity, detail budget, and expressive range. Derive visual choices from the book's art direction and the audience's scene-reading needs; do not hardcode one “child-friendly” style or infantilize older readers.

#### 13. `calibration` (`story`, `screenplay`, `evaluation`)
- **Focus:** Boundary demarcation between neighbouring age brackets.
- **Rules:** Explicitly state what differentiates this band from the one below it and the one above it. (e.g., "Compared to 0–2, 3–5 introduces true narrative conflict and compound sentences. Compared to 6–8, it avoids subplots, heavy text blocks, and independent reading vocabulary constraints.")

#### 14. `qualityTest` (`story`, `screenplay`, `evaluation`)
- **Focus:** Pre-flight evaluation questions.
- **Rules:** Use concise, observable questions covering per-page clarity, whole-story structure, reader agency, illustration opportunity, age fit, and re-readability as appropriate. This section guides models; it is not itself deterministic pass/fail code.

---

## 4. The 14 Editorial Dimensions (Quantitative Rubric)

Each dimension maps to a discrete scale of string values. The stored value is the **0-indexed integer** `level`, paired with a tailored `guidance` string.

```
+---------------------------+----+---------------------------------------------------------------+-----------------------------------+
| DIMENSION ID              | LEV| LEVEL VOCABULARY (Index 0 is least/lowest)                    | TARGET CHANNELS                   |
+---------------------------+----+---------------------------------------------------------------+-----------------------------------+
| textDensity               | 7  | Minimal, Very low, Low, Low–medium, Medium, Medium–high, High | story, screenplay, evaluation     |
| sentenceComplexity        | 5  | Tiny, Simple, Moderate, Varied, Varied and complex            | story, evaluation                 |
| illustrationDependency    | 5  | Low, Low–medium, Medium, High, Very high                      | screenplay, illustration, eval    |
| repetition                | 5  | Optional, Low, Medium, High, Very high                        | story, screenplay, evaluation     |
| plotComplexity            | 6  | None, Tiny, Simple, Full but simple, Moderate, Complex        | story, evaluation                 |
| castSize                  | 6  | 1–2, 1–3, 1–4, A small cast, Several, Flexible                | story, screenplay, illus, eval    |
| dialogue                  | 5  | Rare, Minimal, Simple, Common, Rich                           | story, evaluation                 |
| conflict                  | 5  | Almost none, Tiny, Mild, Moderate, Significant                | story, screenplay, illus, eval    |
| emotionalComplexity       | 4  | Basic, Simple, Moderate, Nuanced                              | story, illustration, evaluation   |
| readerInference           | 6  | None, Very low, Low, Medium, Medium–high, High                | story, evaluation                 |
| figurativeLanguage        | 5  | None, Rare, Light, Some, Freely                               | story, evaluation                 |
| subplots                  | 4  | None, Usually none, Light, Yes                                | story, evaluation                 |
| interaction               | 6  | Rare, Low, Medium, Medium–high, High, Very high                | story, screenplay, evaluation     |
| sensoryLanguage           | 3  | As appropriate, Medium, High                                  | story, illustration, evaluation   |
+---------------------------+----+---------------------------------------------------------------+-----------------------------------+
```

### Editorial Interpretation of the Dimension Levels

The IDs, labels, ordering, level names, and channel routing above are code-defined. The descriptions below operationalize those labels for authoring consistency; they are editorial guidance rather than additional runtime schema.

```
1. textDensity (7 levels)
   0: Minimal       -> A single word or sound effect per spread.
   1: Very low      -> A phrase or one very short sentence per page.
   2: Low           -> One or two short sentences per page.
   3: Low–medium    -> Two to three short sentences per page.
   4: Medium        -> Two to four mixed-length sentences per page.
   5: Medium–high   -> A rich paragraph (4-6 sentences) per page.
   6: High          -> Multiple dense paragraphs / full chapter-book density.

2. sentenceComplexity (5 levels)
   0: Tiny          -> Single words, sounds, two-word naming expressions ("Big dog.").
   1: Simple        -> Basic Subject-Verb-Object; occasional compound with 'and'/'but'.
   2: Moderate      -> Mixed sentence lengths, simple subordinate clauses ("When it rained...").
   3: Varied        -> Rich syntax, varied sentence openings, dialogue integration.
   4: Varied and complex -> Sophisticated multi-clause syntax, literary cadence, subtext.

3. illustrationDependency (5 levels)
   0: Low           -> Prose carries almost all narrative; art illustrates or punctuates.
   1: Low–medium    -> Prose tells the story; art enriches atmosphere and setting.
   2: Medium        -> Equal partnership: text carries action, art carries visual details.
   3: High          -> Art carries setting, emotion, and character subtext; text is lean.
   4: Very high     -> Picture carries majority of story; words are minimal anchors/prompts.

4. repetition (5 levels)
   0: Optional      -> Only used as a deliberate literary motif or poetic callback.
   1: Low           -> Texture only: occasional running gags or recurring phrases.
   2: Medium        -> Regular refrains or recognizable rhythmic patterns.
   3: High          -> Strong repeating structure or refrain the child joins in with.
   4: Very high     -> Strict repeating pattern is the primary structural spine of the book.

5. plotComplexity (6 levels)
   0: None          -> Pure naming, catalog, sensory celebration, or ritual (no plot).
   1: Tiny          -> Micro cause-and-effect (drop ball -> roll -> find).
   2: Simple        -> Single clear problem, one attempt, warm resolution.
   3: Full but simple -> Beginning, problem, 2-3 progressive obstacles, hero resolution.
   4: Moderate      -> Multi-beat quest or mystery with complications and character stakes.
   5: Complex       -> Multi-threaded narrative, character arcs, twists, and lasting consequences.

6. castSize (6 levels)
   0: 1–2           -> Main character plus parent/pet across entire book.
   1: 1–3           -> Main character and up to two secondary figures.
   2: 1–4           -> Core protagonist, companion, and 1-2 incidental characters.
   3: A small cast  -> 4-6 distinct recurring characters.
   4: Several       -> 6-10 characters with distinct roles and voice.
   5: Flexible      -> As many characters as the story requires.

7. dialogue (5 levels)
   0: Rare          -> Exclamations, animal sounds, or greetings only.
   1: Minimal       -> Short single-line spoken expressions in quotes.
   2: Simple        -> Short, clearly attributed dialogue exchanges.
   3: Common        -> Frequent dialogue driving scenes and revealing character relationships.
   4: Rich          -> Layered dialogue with distinct voices, banter, subtext, and dialect.

8. conflict (5 levels)
   0: Almost none   -> Pure security, discovery, or gentle routine.
   1: Tiny          -> Momentary wobble, lost toy, or mild obstacle resolved immediately.
   2: Mild          -> Relatable preschool frustration or misunderstanding resolved quickly.
   3: Moderate      -> Real stakes, interpersonal tension, or failure requiring real effort.
   4: Significant   -> High emotional or physical stakes with lasting personal cost.

9. emotionalComplexity (4 levels)
   0: Basic         -> One single plain feeling at a time (happy, sleepy, surprised).
   1: Simple        -> One named feeling honestly handled (scared then brave, sad then comforted).
   2: Moderate      -> Mixed or transitioning feelings (jealousy, proud but nervous).
   3: Nuanced       -> Conflicted, layered, or contradictory emotions with internal growth.

10. readerInference (6 levels)
    0: None         -> Everything is explicitly stated in words or plain visuals.
    1: Very low     -> Almost everything stated; tiny visual deduction (where is the dog?).
    2: Low          -> Basic visual clues complement text.
    3: Medium       -> Some character feelings or plot clues shown, not told.
    4: Medium–high  -> Reader connects dots between character actions, subtext, and pictures.
    5: High         -> Rich dramatic irony, unreliable narration, or complex subtext.

11. figurativeLanguage (5 levels)
    0: None         -> 100% literal concrete language.
    1: Rare         -> Occasional obvious comparison ("soft as a bunny").
    2: Light        -> Accessible similes and sensory metaphors.
    3: Some         -> Vivid figurative imagery and idioms explained by context.
    4: Freely       -> Poetic, inventive figurative language and extended metaphor.

12. subplots (4 levels)
    0: None         -> Single linear thread only.
    1: Usually none -> Purely linear; at most a tiny background visual subplot.
    2: Light        -> One light secondary character thread supporting the main goal.
    3: Yes          -> Braided subplots, secondary goals, or parallel character journeys.

13. interaction (6 levels)
    0: Rare         -> Pure reading/listening engagement (no direct address).
    1: Low          -> Subtle suspense or dramatic pauses.
    2: Medium       -> Occasional invitations to predict or find something.
    3: Medium–high  -> Regular direct address, questions, or refrains.
    4: High         -> Frequent pointing, naming, counting, and sound-making.
    5: Very high    -> Almost every page offers physical or verbal participation.

14. sensoryLanguage (3 levels)
    0: As appropriate -> Sensory details included naturally where scenes require.
    1: Medium       -> Rich physical grounding (textures, sounds, weather).
    2: High         -> Dominant focus on bodily sensations, onomatopoeia, and kinetic movement.
```

---

## 5. Structural Bounds & Density Arithmetic

The whole-story word range, typical page density, and page range are editorial targets that must be able to coexist. They are **not** three exact expressions of the same quantity because page density is a typical value, not a requirement for every page.

Calculate the page range implied by the story and typical density:

```text
impliedMinPages = ceil(minWords / targetWordsPerPage)
impliedMaxPages = ceil(maxWords / targetWordsPerPage)
```

The configured and implied intervals should overlap:

```text
impliedMaxPages >= minPages
impliedMinPages <= maxPages
```

This is the same compatibility model shown in the dashboard. Do not require `maxWords >= targetWordsPerPage * maxPages`; several valid shipped profiles intentionally allow sparse or variable-density pages and would fail that invented rule.

### 5.1 Validation Rules & Constraints

1. **Word Count Bounds:**
   - `minWords` must be $\le$ `maxWords`.
   - `minPages` must be $\le$ `maxPages`.
   - When `targetWordsPerPage > 0`, require the two page intervals above to overlap.
   - The dashboard warns only when `maxWords < targetWordsPerPage × minPages × 0.5`; that is a last-resort contradiction warning, not the preferred quality threshold.
2. **Page Ceilings:**
   - If `maxWordsPerPage > 0`, it must be $\ge$ `targetWordsPerPage`.
   - `0` disables the maximum. Do not invent a universal multiplier; choose headroom based on prose shape and page variation.
3. **Sentence Constraints:**
   - `maxSentenceWords = 0` disables the sentence-length instruction/check.
   - If both limits are enabled, `maxSentenceWords` should not exceed `maxWordsPerPage`; the dashboard warns when it does.
   - `targetSentencesPerPage` is a typical target. Runtime flags a page only when it exceeds **twice** that target.
4. **Protagonist Calibration:**
   - `minAge` and `maxAge` reflect the **character's** age, not the reader's age.
   - A protagonist near or slightly above the reader's age is a useful default, not a universal publishing law. Subject, species, point of view, and story purpose may justify another choice.
   - Include `{{min}}` and `{{max}}` in `guidance` when the sentence needs the configured values. The compiler substitutes all occurrences, but the schema does not require either placeholder.
   - `defaultCharacterAgeYears` applies to any character whose age is not explicit; choose it deliberately rather than deriving it from the reader-range midpoint.

### 5.2 What Is Actually Enforced

Keep prompt targets distinct from deterministic checks:

- Draft word count gets a 15% tolerance outside `minWords`/`maxWords` before one repair attempt is requested.
- A sentence counts as long only above 125% of `maxSentenceWords`; repair is requested when long sentences exceed `max(1, 20% of sentences)`.
- A screenplay page is reported over limit only above 115% of `maxWordsPerPage`.
- Page count outside `minPages`–`maxPages`, pages with no illustration brief, and pages over twice `targetSentencesPerPage` are advisory findings.
- `beats`, `plotRequired`, target page density, and focal-character count primarily guide prompt generation; do not describe them as hard validators.
- Story word limits may be adjusted by the selected content language's word-count factor at prompt time. Store the profile's baseline, not a pre-adjusted value for one locale.

---

## 6. Reading Modes Specification

When a band supports different reading environments (typically age 5+), configure `readingModes` with a subset of `["read-aloud", "with-help", "independent"]`.

For bands without reading modes (e.g., babies 0–2 or toddlers 3–5 where all books are read aloud by adults), `readingModes` is empty `[]`, and `modes` contains only the `"default"` key.

Resolution rules:

- A requested mode is used only if it appears in `readingModes`.
- Otherwise the resolver tries `modes.default`, then the first configured reading mode, then empty strings.
- The first item in `readingModes` is the UI default, so order is meaningful.
- Every enabled mode should have a corresponding `modes` entry. A stale/unrecognized requested mode safely falls back.
- In mode overrides, blank strings do not clear inherited guidance; trimmed blanks fall back to the prior value.

```
+------------------+----------------------------------+---------------------------------------------+
| READING MODE     | HUMAN GUIDANCE (UI)              | STORY GUIDANCE (Story Prompt Overlay)       |
+------------------+----------------------------------+---------------------------------------------+
| read-aloud       | Focus on listening pleasure,     | "Write for listening rather than solo       |
|                  | adult performance, rich imagery. | reading. The adult carries difficult words, |
|                  |                                  | so vocabulary can stretch and rhythm shines."|
+------------------+----------------------------------+---------------------------------------------+
| with-help        | Supported reading: child reads   | "The child reads with an adult nearby. Mix  |
|                  | most words, adult helps on hard. | short and medium sentences; contextualize   |
|                  |                                  | rare words; keep dialogue clearly attributed"|
+------------------+----------------------------------+---------------------------------------------+
| independent      | Solo reader: high-frequency      | "The child reads alone. Nothing may stall   |
|                  | words, clear syntax, rapid pace. | them. Strong verbs, short sentences, and    |
|                  |                                  | clear context clues for every new word."    |
+------------------+----------------------------------+---------------------------------------------+
```

---

## 7. Current Product Calibration Reference Matrix

When designing a new band or auditing an existing one, compare it with the current shipped product defaults below. These are broad editorial heuristics, not developmental milestones or external publishing benchmarks:

```
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| AGE BAND  | COGNITIVE & MOTOR  | EMOTIONAL FOCUS     | LITERARY FOCUS   | TARGET WORDS  | PAGE COUNT  |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 0–12m     | High contrast art, | Comfort, warmth,    | Naming, sounds,  | 20 – 70       | 8 – 22      |
|           | tracking movement  | immediate security  | rhymes, routine  | (3 w/page)    |             |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 13–24m    | Pointing, naming,  | Autonomy, minor     | Routines, searches| 45 – 110     | 8 – 20      |
|           | sound imitation    | wobbles, routines   | cause & effect   | (6 w/page)    |             |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 0–2y      | Board book stage:  | Reassurance, safe   | Repetition spine,| 60 – 140      | 10 – 24     |
| (General) | tactile, rhythmic  | caregiver proximity | call-and-response| (6 w/page)    |             |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 3–5y      | Narrative memory,  | Social emotions,    | 5-beat quest,    | 150 – 320     | 8 – 16      |
|           | humor, curiosity   | empathy, bravery    | refrains, jokes  | (22 w/page)   |             |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 6–8y      | Phonics mastery,   | Fairness, school,   | 7-beat plot,     | 300 – 600     | 8 – 16      |
|           | deductive reasoning| peer relationships  | real dialogue    | (48 w/page)   |             |
+-----------+--------------------+---------------------+------------------+---------------+-------------+
| 9–12y     | Abstract thought,  | Identity, loyalty,  | Chapter scenes,  | 450 – 900+    | 8 – 16+     |
|           | subtext, nuance    | moral ambiguity     | subplots, subtext| (80 w/page)   | (or chapters)|
+-----------+--------------------+---------------------+------------------+---------------+-------------+
```

These numbers describe this application's short illustrated-book products, not standard trade-publishing manuscript lengths. In particular, the shipped `9-12` profile is labeled “Chapter books” but targets 450–900 words and 8–16 illustrated pages; do not present that as a general chapter-book market norm. If the product format changes, recalibrate structure and density together.

Development is continuous and uneven. Bands are editorial interfaces, not diagnoses. Avoid deficit language, presumed family structures, gender stereotypes, culture-bound “normality,” and instructions that exclude disabled or neurodivergent children. Where accessibility changes the creative brief—plain language, predictable transitions, reduced sensory overload, image description, dyslexia-friendly layout—state the requested consequence in the relevant existing sections rather than inventing schema fields.

---

## 8. Inheritance (`extendsId`) Architecture

Use `extendsId` only with its actual narrow semantics:

- Inheritance fills missing `sections` and `dimensions` from the parent.
- A child's nonblank section replaces the same parent section.
- A child dimension replaces the same parent dimension as a complete `{ level, guidance }` value.
- `structure`, `density`, `protagonist`, `safety`, `modes`, metadata, reading modes, and evaluation IDs are **not inherited through `extendsId`**.
- Inheritance follows at most four levels. Missing parents, self-reference, and deeper/cyclic chains stop resolving rather than throwing.
- On an inherited profile, a blank section currently does not suppress the parent's section; the inheritance pass refills it. Write an explicit replacement or change the implementation if suppression is required.

This means a custom inherited band still needs deliberate values for every non-section/non-dimension field. New unknown IDs begin from an internal fallback-shaped blank profile, but relying on that implementation detail produces misleading configuration and must be avoided.

The ordinary override merge that occurs before inheritance has separate behavior:

- Top-level omitted fields retain the existing/shipped value.
- `structure`, `density`, and `protagonist` replace from complete nested objects; min/max pairs are reordered if reversed.
- Non-inherited existing profiles can clear a section with `""`; the compiler omits blank sections.
- A nonempty override `safety.avoid` replaces the band's previous age-specific list; an empty list retains it. The global mandatory list is always added later.
- Blank mode guidance and blank protagonist guidance retain previous text.

Use inheritance for closely related sub-bands such as `0-12m` extending `0-2`, but do not enable both a broad parent and overlapping child bands unless the age-shortcut precedence is intentional.

### 8.1 Identity, Lookup, Ordering, and Retirement

- IDs are stable join keys. Rename display labels freely; preserve old IDs in `aliases` when an ID must change.
- Direct lookup resolves exact ID first, then the first matching alias, then the shipped fallback ID `3-5`, then the first available profile.
- Direct ID lookup does **not** infer a band from month ranges.
- Month-based lookup is separate: it considers enabled profiles in resolved sort order and returns the first inclusive containing range. Overlaps therefore make `order` precedence significant.
- Below every enabled range, month lookup returns the youngest enabled profile.
- Above every enabled range, month lookup returns the oldest enabled profile only when the age still reads as a child (the oldest band, the highest enabled `protagonist.maxAge`, or 18 years — whichever is greater). Adult ages do not snap onto a children's band.
- A gap between enabled bands does not snap to the previous band; the shortcut returns no match and the author must pick.
- Disabled profiles remain resolvable for existing books but disappear from customer choice.
- Deleted profiles disappear from customer choice, the normal admin band list, month matching, and
  all “current profiles” APIs. Their fully resolved snapshot remains stored and exact-ID/alias
  lookup still resolves it for existing books.
- Deletion and hiding are different: hiding keeps the band editable and available for restoration
  by toggling `enabled`; deletion moves it to the dashboard's Deleted list and reserves its ID.
- Every band, including a shipped default, can be deleted. A shipped band does not reappear merely
  because it still exists in the code catalog; `deletedProfileIds` is applied after default
  resolution.
- Restoring a deleted band removes its tombstone and returns its frozen snapshot as hidden. Review
  it, then explicitly enable it if it should return to customer choice.
- Never recycle a deleted ID. Existing books and Story Craft records still use it as a join key.
- The dashboard prevents deletion of the final current band, and backend validation rejects a
  configuration in which every known band is deleted.
- If every profile is disabled, the picker still receives the first resolved profile as a fail-safe.
- Prefer contiguous, nonoverlapping enabled ranges. Remember that both month bounds are inclusive; `0–12` and `12–24` overlap at month 12, whereas `0–12` and `13–24` do not.

---

## 9. Story Craft Companion Configuration

An age band defines the editorial contract for the finished book. **Story Craft** defines the
curated creative choices an author may select while creating that book. A complete age-band
configuration task must address both documents, but must not collapse them into one schema:

- `AudienceProfile` owns constraints and evaluation: language, complexity, structure, density,
  protagonist calibration, safety, visual comprehension, reading modes, and prompt overlays.
- `StoryCraftConfig` owns choices: themes, storytelling devices, and settings offered for each
  configured age-band ID.
- `ArtStylesConfig` separately owns the visual-medium catalog. Art styles are global choices, not
  Story Craft options and not automatically age-gated.
- Prompt templates own the surrounding wording. A Story Craft option supplies only the specific
  guidance inserted when that option is selected.

The implementation authority for this companion contract is:

- `books-frontend/src/core/config/storyCraftCatalog.ts` — shipped catalogs and option types.
- `books-frontend/src/core/config/storyCraft.ts` — persisted schema, normalization, replacement
  semantics, resolution, labels, and prompt guidance.
- `books-frontend/src/core/story/brief.ts` — selected IDs, limits, and active-band normalization.
- `books-frontend/src/core/prompts/story.ts` — joins Story Craft choices with Audience rules.
- `books-frontend/src/ui/admin/tabs/StoryCraftTab.tsx` — per-band administration.

### 9.1 Exact Story Craft Data Contract

```typescript
interface StoryOption {
  /** Stable kebab-case ID, unique within this list. */
  id: string;
  /** Customer-facing chip label. */
  label: string;
  /** One-line customer explanation. */
  description: string;
  /** Imperative instruction inserted into the story prompt when selected. */
  llmGuidance: string;
}

interface StoryCraftBand {
  /** What the story is substantially about. */
  themes?: StoryOption[];
  /** How the story is narrated or structurally performed. */
  devices?: StoryOption[];
  /** Where or in what kind of world the story happens. */
  settings?: StoryOption[];
}

interface StoryCraftConfig {
  version: 1;
  /** Keys are exact AudienceProfile IDs. */
  bands: Record<string, StoryCraftBand>;
  updatedAt?: number;
}
```

Exact persisted limits:

- A band key uses the same stable-ID shape as an audience profile: 1–40 characters and
  `/^[a-z0-9][a-z0-9-]*$/`.
- Each list contains at most 40 options.
- An option ID is 1–60 characters and `/^[a-z0-9][a-z0-9-]*$/`.
- Option IDs must be unique within their list. The same conceptual ID may intentionally appear in
  several bands, and may have age-calibrated wording in each.
- `label`: 1–120 characters; `description`: at most 400; `llmGuidance`: at most 2,000.
- Empty arrays are meaningful: they explicitly offer no curated choices in that category.
- The stored schema still accepts legacy `structure`, `protagonist`, and `safety` objects so old
  deployments retain their tuning. Do not author new values there. Runtime story prompts take
  those rules from the resolved Audience Profile.

### 9.2 Resolution and Dynamic Age-Band Lifecycle

Story Craft joins to Audience by exact stable ID; month ranges and labels never perform the join.

1. The four broad shipped IDs with built-in Story Craft catalogs resolve to those exact defaults.
2. A stored list for the exact band ID replaces the corresponding shipped list wholesale.
3. An explicit empty stored list remains empty; the resolver must not restore defaults.
4. A custom or newly added audience band with no Story Craft record resolves to empty theme,
   device, and setting lists. It must never silently receive the `3-5` or another age band's
   creative catalog.
5. Hidden audience bands remain configurable and resolvable. `enabled` controls customer
   availability, not configuration existence.
6. “Copy all choices” in the dashboard takes a snapshot of another band's three resolved lists.
   It is not inheritance: later edits to the source do not alter the copy.
7. `AudienceProfile.extendsId` does not automatically inherit Story Craft. Editorial guidance and
   creative menus have different lifecycles; copy and then calibrate the lists deliberately.
8. Resetting a shipped band returns it to its shipped Story Craft defaults. Resetting a custom
   band returns it to the empty unconfigured baseline.

Save a new Audience band before configuring its Story Craft entry. When duplicating an Audience
band, deliberately choose whether to copy its Story Craft choices; matching editorial rules do not
prove that the same menu is desirable.

Deleting an Audience band removes it from current administration and new-book choices. The
dashboard stores a frozen Audience snapshot and leaves its separately stored Story Craft record as
compatibility data, so an existing book can still regenerate against the same ID. The Deleted list
can restore that snapshot. Never recycle its ID for a different audience.

### 9.2.1 Integrated Dashboard Workflow

Story Craft appears inside the selected Age Band as its own pane alongside Basics, Guidance,
Reading level, Length & pacing, Safety, and Preview. The standalone Story Craft route may remain
available for administrators whose permissions cover Story Craft but not Audience.

Audience and Story Craft retain independent permissions, dirty state, schemas, and save operations:

- Save a newly added Audience band before opening its embedded Story Craft editor.
- “Save changes” persists the Audience document.
- “Save Story Craft” persists theme, device, and setting lists for the selected stable ID.
- Deleting the Audience band immediately removes it from both current band selectors after the
  Audience save; its Story Craft data is retained only for compatibility.
- Restoring the Audience band makes its prior Story Craft lists editable again.

### 9.3 Selection Semantics in a Story Brief

The customer-facing contract is:

- **Theme:** zero or one catalog option, or one custom theme.
- **Storytelling devices:** zero to two distinct catalog options, or one custom device instruction.
- **Setting:** zero or one catalog option, or one custom setting.
- **Guided mode:** named hero/cast plus optional theme, devices, and setting.
- **Co-write mode:** cast and occasion, with optional when, where, must-include details, theme,
  devices, and setting.
- **Own-words mode:** no Story Craft generation choices are required; Audience checks still apply
  to the manuscript.

Custom text and catalog selection are alternatives in the current UI. Choosing “Something else”
clears selected IDs in that category. `where` is a concrete personalized location (“Grandad's
garden”); a setting option is broader creative guidance (“a friendly wood”). Both may appear in a
co-write brief and should complement rather than contradict each other.

Whenever the age band changes, an option is removed, or a request is forged, normalize the brief
against the resolved catalog for the **current** band:

- remove unknown theme and setting IDs;
- remove unknown and duplicate device IDs;
- retain at most two devices;
- keep valid custom text;
- never look up an unknown ID in another band's catalog.

This normalization runs in the story UI and again on the server before prompt construction. The
server-side check is authoritative.

### 9.4 Designing Themes

A theme is a durable subject, concern, experience, or plot territory—not a prose technique or
visual medium. Build a varied menu across these useful families:

- security, attachment, routines, sleep, and separation/reunion;
- naming, discovery, animals, nature, movement, and sensory play;
- friendship, sharing, fairness, belonging, family change, and first experiences;
- courage, honesty, mistakes, persistence, invention, and responsibility;
- mystery, quest, survival, rivalry, identity, legacy, and moral choice.

For every band:

- Offer recognizable entry points without assuming one family structure, culture, gender, ability,
  school experience, or economic setting.
- Calibrate stakes and resolution to `conflict`, `emotionalComplexity`, `emotion`, and
  `safety.note`.
- Do not encode a moral conclusion so tightly that every generated story becomes preachy.
- Prefer themes broad enough to support many books but specific enough that their LLM guidance
  materially changes the plot.
- Avoid duplicates that differ only in label. If two options produce the same prompt instruction,
  merge them.

### 9.5 Designing Storytelling Devices

A device changes how the story is told. Useful families include:

- refrain, repetition, cumulative structure, call-and-response, counting, and sound words;
- rhyme, metre, rule of three, direct address, page-turn reveal, and surprise ending;
- humour, suspense, dialogue-led narration, first person, letters/messages, and fair twists;
- foreshadowing, dual timelines, epistolary forms, unreliable narration, dramatic irony, and
  chapter hooks.

Calibrate each device against the Audience Profile:

- Repetition and participation must agree with the `repetition` and `interaction` dimensions.
- Rhyme guidance must require stable metre and forbid distorted meaning merely to reach a rhyme.
- Mystery, twists, foreshadowing, and unreliable narration must not demand more inference or memory
  than the profile permits.
- Direct address should match the intended reading mode; it is not automatically desirable for
  every young reader.
- Devices must fit the available word, beat, and page budget. A dual timeline cannot function in a
  three-beat naming book.
- Two simultaneously selected devices must be composable. Write guidance that allows the model to
  subordinate one device when both cannot dominate every page.

### 9.6 Designing Settings

A setting option describes a reusable story world and the affordances it gives the plot. Include a
balanced selection of:

- familiar private places: home, bedroom, garden;
- shared everyday places: preschool, school, neighbourhood, shops, transport;
- natural environments: farm, woods, seaside, countryside, wilderness;
- speculative environments: magical place, invented world, space, near future;
- socially or historically structured environments for older bands: small town, school with
  rules, specific historical period.

Setting guidance should name concrete sensory and narrative affordances, not prescribe an entire
plot. Match environmental complexity, navigation demands, peril, historical knowledge, and
world-rule count to the profile. A fantasy setting still obeys the band's language, conflict,
inference, and safety contract.

### 9.7 Story Craft vs Tone, Genre, and Visual Style

Tone and genre are currently expressed through the combination of theme, device, free-text details,
and Audience guidance; they are not separate persisted Story Craft lists. Do not invent `tones` or
`genres` fields in production JSON unless the code contract is intentionally extended.

Visual art style is separate:

- The global art catalog currently contains preset/admin-managed visual media and may also accept a
  custom description or derive a look from supplied character artwork.
- The Audience `characterArt` and `visualStorytelling` sections may state age-specific readability,
  composition, detail, expression, and silhouette requirements.
- Those requirements constrain any selected art style; they do not select watercolor, collage,
  crayon, 3D, vector, or classic storybook art on the reader's behalf.
- If product policy later recommends styles by age, add explicit compatibility metadata to the art
  catalog rather than hiding styles through prose in Story Craft.

Book size, page aspect ratio, layout, and text placement likewise remain Design configuration.

### 9.8 Story Craft Quality Gate

Do not finish a combined age-band configuration until:

- every enabled Audience ID has an intentional Story Craft state: configured lists or an explicit
  decision to offer custom text only;
- hidden bands intended for launch can be configured before they are enabled;
- every option passes ID, uniqueness, length, and list-size validation;
- labels are clear to customers, descriptions explain the choice, and `llmGuidance` causes an
  observable creative consequence;
- themes, devices, and settings are classified correctly;
- choices agree with Audience structure, dimensions, reading modes, safety, and page budget;
- selected IDs are normalized against the current band on both client and server;
- empty arrays, copying, reset, hiding, renaming, retirement, and deletion behavior are deliberate;
- Story Craft rule fields are not used to duplicate current Audience-owned constraints;
- visual style and physical design remain separate concerns.

### 9.9 Combined LLM Output

Audience and Story Craft are persisted as separate configuration documents. When an LLM is asked
to configure both, use this review/import envelope unless the caller requests the two documents
separately:

```json
{
  "audience": {
    "version": 1,
    "profiles": [],
    "deletedProfileIds": []
  },
  "storyCraft": {
    "version": 1,
    "bands": {}
  }
}
```

This combined envelope is an interchange artifact, not a third runtime config schema. Each nested
document must independently pass its own schema. Every `storyCraft.bands` key must intentionally
correspond to an Audience profile ID in the proposed or existing configuration.

---

## 10. Step-by-Step Profile Authoring Protocol for LLMs

When tasked with creating, editing, or validating an Audience Profile, execute these steps in sequence:

```
[Step 0: Establish the task and evidence]
  - Identify whether the output is a full resolved profile, sparse override, AudienceConfig envelope,
    audit, or recommendation.
  - Record target reader ages, product format, expected page count, reading context, language/locale,
    illustration role, genre/tone, accessibility needs, and neighbouring enabled bands.
  - If evidence is requested, distinguish sourced publishing/development evidence from product choices.
    Do not fabricate citations or describe product defaults as scientific thresholds.

[Step 1: Bracket, lifecycle, and metadata]
  - Define id, label, caption, description, minMonths, maxMonths, order, enabled, extendsId.
  - Check inclusive ranges for gaps/overlaps and document intentional overlap precedence.
  - Preserve compatibility with aliases and disabled/deleted IDs. Distinguish a hidden editable
    band from a deleted tombstone retained only for exact-ID resolution.
  - Determine if readingModes are needed (empty [] vs ["read-aloud", "with-help", "independent"]).

[Step 2: Structural & Density Mathematics]
  - Calculate minPages, maxPages, targetWordsPerPage, maxWordsPerPage.
  - Calculate minWords, maxWords, beats, maxSentenceWords, plotRequired.
  - Verify interval overlap and all runtime/editor diagnostics from Section 5.

[Step 3: Character & Safety Rules]
  - Set protagonist minAge/maxAge deliberately; use {{min}}/{{max}} in guidance when applicable.
  - Set defaultCharacterAgeYears.
  - Define specific, testable band-level additions in safety.avoid and a resolution rule in safety.note.
  - Do not duplicate or weaken the mandatory safety floor.

[Step 4: Editorial Dimensions Configuration]
  - Set a legal 0-indexed level and observable guidance for all 14 dimensions in a full profile.
  - Select the dimensions whose adherence is materially diagnostic for evaluatedDimensionIds.
  - Empty evaluatedDimensionIds means “score every configured dimension,” not “score none.”

[Step 5: Authoring the 14 Guardrail Sections]
  - Write concise, imperative, testable guidance for all 14 sections in a full profile.
  - For inherited profiles, supply intentional section/dimension deltas and verify the resolved result.
  - Keep guidance in the right concern: prose mechanics in language; page-turn mechanics in
    pageStructure; text-picture division and composition in visualStorytelling.
  - Include positive direction as well as prohibitions. Avoid vague words such as “appropriate,”
    “engaging,” and “simple” unless the sentence defines observable consequences.

[Step 6: Reading Mode Guidance]
  - Write humanGuidance and storyGuidance for default or every active reading mode.
  - Check that mode-specific syntax/vocabulary direction does not contradict the base profile.

[Step 7: Cross-field Coherence]
  - Compare each dimension with its prose section and numeric control.
  - Resolve contradictions such as “no plot” with plotRequired=true, “one character” with a large
    cast level, or “one short sentence” with incompatible page density.
  - Compare with immediate neighbouring bands; progression should be intentional, not automatically
    monotonic where a format or reading-mode change explains a difference.

[Step 8: Story Craft Companion]
  - Decide whether this task also creates or updates the StoryCraftConfig entry for the same ID.
  - Configure intentional theme, device and setting lists, including explicit empty lists where the
    product should offer custom text only.
  - Check stable option IDs, uniqueness, prompt guidance, selection counts, and coherence with the
    resolved Audience Profile.
  - Never rely on another band's implicit fallback. Copy another catalog only as a starting snapshot.

[Step 9: Schema, Resolution, and Compilation Check]
  - Verify the selected output shape and every schema limit.
  - Verify exact section/dimension IDs, legal level indexes, mode coverage, aliases, and parent.
  - Resolve inheritance and overrides mentally; audit the final profile, not only the stored delta.
  - Preview story, screenplay, illustration, characterArt, evaluation, density, safety, and
    protagonist outputs. Confirm no required channel is empty and no instruction lands in the wrong one.

[Step 10: Output]
  - Return strict JSON when JSON was requested: no comments, trailing commas, markdown fence, or prose.
  - Otherwise provide the requested artifact plus a short validation summary, assumptions, and any
    unresolved evidence gaps. Never claim persistence unless the config was actually saved.
```

### 10.1 Cross-Field Coherence Checklist

- `plotRequired=false` agrees with `plotComplexity` and `storyStructure`.
- `textDensity`, whole-story words, typical words/page, sentences/page, and page range agree.
- `sentenceComplexity`, `maxSentenceWords`, `language`, and every reading-mode override agree.
- `castSize` agrees with focal characters/scene and visual complexity.
- `illustrationDependency` agrees with `visualStorytelling` and page density.
- `repetition`, `interaction`, inference, and direct-address guidance describe the same reader behavior.
- Conflict and emotion levels agree with `emotion`, `safety.avoid`, and `safety.note`.
- `subplots`, plot level, beat count, and page budget can coexist.
- Protagonist guidance does not imply an age or agency rule outside configured bounds.
- Every evaluation ID is a real configured dimension; choose a focused subset when useful.
- The calibration section names concrete differences at the lower and upper boundary.
- Customer-facing wording is clear and nontechnical; prompt-facing wording is imperative and testable.
- Story Craft choices are valid for this exact stable band ID and agree with the profile.

---

## 11. Current Valid Reference Examples

These examples mirror current shipped product defaults. They demonstrate valid shapes and system behavior; they are not universal developmental or trade-publishing standards.

### Example 1: Full Standard Band (`3-5` Picture Books)

```json
{
  "id": "3-5",
  "label": "3–5 years",
  "caption": "Picture books",
  "description": "Picture-book read-aloud: short sentences, playful rhythm, lots of imagery.",
  "minMonths": 36,
  "maxMonths": 71,
  "order": 20,
  "enabled": true,
  "aliases": [],
  "readingModes": [],
  "modes": {
    "default": {
      "humanGuidance": "Picture-book read-aloud: short sentences, playful rhythm, lots of imagery.",
      "storyGuidance": ""
    }
  },
  "sections": {
    "language": "One or two short sentences per page. Simple sentences mostly; the occasional compound sentence joined with \"and\" or \"but\" is fine.\nEveryday vocabulary plus a few stretch words whose meaning is obvious from context. Playful sound words and dialogue in quotes are welcome.\nAvoid nested clauses, sarcasm, irony and abstract philosophy.",
    "readAloud": "This book will be read aloud by an adult, often at bedtime and often many times. Write for the mouth: a steady rhythm, satisfying sounds, and lines an adult enjoys performing.\nIf the story rhymes, keep the metre confident and never bend sense to reach a rhyme.",
    "repetition": "Use a refrain or a repeated structure the child can learn and chant along with. Repetition at this age is what turns a book into a favourite.",
    "pageStructure": "One story beat per page. Make it clear who is doing what.\nEnd most pages on a small hook — a question, a movement, or an unfinished action — so the page turn has a payoff.",
    "storyStructure": "A clear beginning, one problem or adventure in the middle, and a warm, satisfying ending. Keep the causal chain visible: this happened, so that happened.\nThe hero should solve or survive the problem themselves rather than being rescued and told what to think.",
    "interaction": "Direct questions to the reader, invitations to count, spot or shout along, and moments of anticipation all work well. Use them a few times, not on every page.",
    "visualStorytelling": "The picture should carry the setting, the expressions and the jokes; the words carry the action and the voice. Don't spend words describing what the reader can already see.\nGive each scene one clear focal moment an illustrator can actually stage.",
    "recognition": "Friendship, curiosity, bedtime, family, animals, weather, food and everyday adventures are the furniture of this age. Concrete and familiar beats novel and abstract.",
    "sensory": "Sound words, textures and physical comedy land well. Let the child feel the splash, the crunch and the cold.",
    "emotion": "Name big feelings plainly — cross, sad, jealous, proud — and move through them to calm. Mild tension is welcome but must resolve warmly within a page or two.\nThe ending is unambiguously happy. Avoid frightening adults, lasting peril and explicit morals.",
    "humor": "Silliness, gentle absurdity, repetition with a twist, and characters behaving unexpectedly. The joke should work in the picture as well as the words.",
    "characterArt": "Expressive, rounded, friendly designs with clear silhouettes and strong colour identity per character. Faces should read emotion instantly at picture-book size.",
    "calibration": "Nearer three, lean on rhythm, repetition and very concrete events. Nearer five, a real problem, a proper middle and a small twist all become enjoyable.",
    "qualityTest": "Per page: one clear beat, a reason to turn, something for the illustrator, and a line that is a pleasure to read aloud. Across the book: does the hero change something, and does the ending feel earned?"
  },
  "dimensions": {
    "textDensity": { "level": 2, "guidance": "One or two short sentences per page." },
    "sentenceComplexity": { "level": 1, "guidance": "Simple sentences; occasional 'and'/'but'." },
    "illustrationDependency": { "level": 3, "guidance": "The picture carries setting and emotion." },
    "repetition": { "level": 3, "guidance": "A refrain or repeated structure the child can join." },
    "plotComplexity": { "level": 2, "guidance": "A single clear problem and its resolution." },
    "castSize": { "level": 2, "guidance": "Up to about four characters." },
    "dialogue": { "level": 2, "guidance": "Short, clearly attributed lines." },
    "conflict": { "level": 2, "guidance": "Real but small, and resolved warmly." },
    "emotionalComplexity": { "level": 1, "guidance": "One named feeling, honestly handled." },
    "readerInference": { "level": 1, "guidance": "Almost everything is stated." },
    "figurativeLanguage": { "level": 1, "guidance": "The occasional obvious comparison." },
    "subplots": { "level": 0, "guidance": "One thread." },
    "interaction": { "level": 3, "guidance": "Regular invitations to join in." },
    "sensoryLanguage": { "level": 2, "guidance": "Rich and physical." }
  },
  "structure": {
    "minWords": 150,
    "maxWords": 320,
    "beats": 5,
    "maxSentenceWords": 16,
    "plotRequired": true
  },
  "density": {
    "targetWordsPerPage": 22,
    "maxWordsPerPage": 45,
    "targetSentencesPerPage": 2,
    "maxFocalCharactersPerScene": 3,
    "minPages": 8,
    "maxPages": 16
  },
  "protagonist": {
    "minAge": 4,
    "maxAge": 6,
    "guidance": "The hero should be about {{min}}–{{max}} years old — a touch older than the reader, which is who a preschooler wants to be."
  },
  "defaultCharacterAgeYears": 4,
  "safety": {
    "avoid": [
      "peril that lasts more than a page",
      "adults who are frightening rather than kind"
    ],
    "note": "Tension is welcome but must resolve warmly within a page or two, and the ending is unambiguously happy."
  },
  "evaluatedDimensionIds": [
    "textDensity",
    "sentenceComplexity",
    "plotComplexity",
    "conflict",
    "emotionalComplexity",
    "figurativeLanguage"
  ]
}
```

---

### Example 2: Multi-Mode Band (`6-8` Early Readers)

```json
{
  "id": "6-8",
  "label": "6–8 years",
  "caption": "Early readers",
  "description": "Early readers: richer plot, longer paragraphs, real feelings.",
  "minMonths": 72,
  "maxMonths": 107,
  "order": 30,
  "enabled": true,
  "aliases": [],
  "readingModes": ["read-aloud", "with-help", "independent"],
  "modes": {
    "read-aloud": {
      "humanGuidance": "Richer story for listening: an adult reads while the child follows the pictures. Longer sentences and more descriptive language are fine.",
      "storyGuidance": "Write for listening rather than solo reading. The adult carries the difficult words, so vocabulary can be richer and sentences a little longer. Include vivid description and natural dialogue, and polish the rhythm for reading aloud."
    },
    "with-help": {
      "humanGuidance": "Early reader with support: the child reads most words while an adult helps with harder vocabulary and longer sentences.",
      "storyGuidance": "The child reads most of this with an adult nearby. Keep sentences mostly short and medium; when a rare word is worth using, make its meaning clear from context. Keep dialogue simple and clearly attributed."
    },
    "independent": {
      "humanGuidance": "Confident early reader: the child reads on their own. Shorter sentences, familiar vocabulary, clear action on every page.",
      "storyGuidance": "The child reads this alone, so nothing may stall them. Favour high-frequency vocabulary, introduce at most one new word per page with a strong context clue, and keep syntax straightforward with strong verbs and clear subjects."
    }
  },
  "sections": {
    "language": "Two to four sentences per page. Mix sentence lengths so the prose has rhythm. Vocabulary can stretch, but a hard word should either be clear from context or worth the pause.",
    "readAloud": "Even when the child reads alone, the prose should sound good. Read every line in your head — if it stumbles, rewrite it.",
    "repetition": "Running gags, repeated phrases and recurring structures still work, but as texture rather than as the spine of the book.",
    "pageStructure": "One clear story beat per page, ending on a small hook or unanswered question wherever the plot allows.",
    "storyStructure": "A real plot with a goal, obstacles and a resolution the hero brings about themselves. Adults may help but must not solve it for them.\nSmall mysteries, quests, friendship trouble and honest mistakes all suit this age.",
    "interaction": "Direct address is largely gone. Involvement now comes from suspense, from clues the reader can piece together, and from wanting to know what happens.",
    "visualStorytelling": "Pictures illuminate the moment rather than carrying the plot. Choose the single most dramatic or funniest beat on the page to illustrate.",
    "recognition": "School, friendship, family change, animals, invention, fairness and owning up are the recognisable territory here.",
    "sensory": "Concrete sensory detail makes a scene believable. Use it to ground the action, not to decorate it.",
    "emotion": "Real stakes and real feelings are welcome. Embarrassment, unfairness, worry and pride all belong. The ending must leave the reader hopeful.\nAvoid genuine horror and humiliation played for laughs.",
    "humor": "Comic timing, running gags and a narrator who is in on the joke. Wordplay starts to land at this age.",
    "characterArt": "Distinct, readable character designs with clear costume identity and expressive faces. Scenes can hold more detail and more figures than at younger ages.",
    "calibration": "Nearer six, keep sentences short and the plot single-stranded. Nearer eight, longer paragraphs, a light subplot and a genuine twist all become enjoyable.",
    "qualityTest": "Per page: is it clear who wants what? Is there a reason to keep reading? Across the book: does the hero solve it, and did the reader have a fair chance to see it coming?"
  },
  "dimensions": {
    "textDensity": { "level": 4, "guidance": "Two to four sentences per page." },
    "sentenceComplexity": { "level": 2, "guidance": "Mixed lengths, some subordinate clauses." },
    "illustrationDependency": { "level": 2, "guidance": "Pictures support rather than carry." },
    "repetition": { "level": 1, "guidance": "Texture only — running gags and refrains." },
    "plotComplexity": { "level": 4, "guidance": "A goal, obstacles and an earned resolution." },
    "castSize": { "level": 4, "guidance": "Several characters, clearly differentiated." },
    "dialogue": { "level": 3, "guidance": "Frequent, with distinct voices." },
    "conflict": { "level": 3, "guidance": "Real stakes, honestly felt." },
    "emotionalComplexity": { "level": 2, "guidance": "Mixed feelings the reader can name." },
    "readerInference": { "level": 3, "guidance": "Some things are shown, not told." },
    "figurativeLanguage": { "level": 3, "guidance": "Comparisons and light imagery." },
    "subplots": { "level": 2, "guidance": "One light secondary thread at most." },
    "interaction": { "level": 1, "guidance": "Suspense rather than direct address." },
    "sensoryLanguage": { "level": 1, "guidance": "Used to ground scenes." }
  },
  "structure": {
    "minWords": 300,
    "maxWords": 600,
    "beats": 7,
    "maxSentenceWords": 22,
    "plotRequired": true
  },
  "density": {
    "targetWordsPerPage": 48,
    "maxWordsPerPage": 90,
    "targetSentencesPerPage": 3,
    "maxFocalCharactersPerScene": 4,
    "minPages": 8,
    "maxPages": 16
  },
  "protagonist": {
    "minAge": 7,
    "maxAge": 9,
    "guidance": "The hero should be about {{min}}–{{max}} years old and solve the final problem themselves; adults may help but must not fix it for them."
  },
  "defaultCharacterAgeYears": 7,
  "safety": {
    "avoid": [
      "genuine horror or body horror",
      "humiliation as a punchline"
    ],
    "note": "Real stakes and real feelings are welcome; the ending must leave the reader hopeful."
  },
  "evaluatedDimensionIds": [
    "textDensity",
    "sentenceComplexity",
    "plotComplexity",
    "dialogue",
    "conflict",
    "readerInference"
  ]
}
```

---

### Example 3: Inherited Sub-Band (`0-12m` Extending `0-2`)

```json
{
  "id": "0-12m",
  "label": "0–12 months",
  "caption": "Baby's first book",
  "description": "Sounds, faces and naming. Rhythm matters far more than plot.",
  "minMonths": 0,
  "maxMonths": 12,
  "order": 5,
  "enabled": false,
  "aliases": [],
  "extendsId": "0-2",
  "readingModes": [],
  "modes": {
    "default": {
      "humanGuidance": "Sounds, faces and naming — rhythm and recognition rather than story.",
      "storyGuidance": ""
    }
  },
  "sections": {
    "storyStructure": "There does not need to be a plot. The strongest shapes at this age are naming sequences, sound patterns, greetings and goodnights, simple contrasts (big/small, loud/quiet, awake/asleep), and short repeating cycles.\nIf something does happen, it must be a single physical cause and effect the baby can see in the picture.",
    "calibration": "This is the youngest band. Prioritise rhythm, sound, faces, naming, repetition, contrast and sensory language. Plot may be entirely absent, and that is a correct outcome rather than a shortfall.\nDo not include questions the baby is expected to answer, sequences that depend on memory across several pages, or any humour that relies on knowing what is normal.",
    "interaction": "Interaction at this age is the adult's: sounds to make, faces to pull, textures to mime, body parts to touch. Write lines the grown-up can perform, not instructions for the baby."
  },
  "dimensions": {
    "textDensity": { "level": 0, "guidance": "A few words per page. Often a single sound or name." },
    "plotComplexity": { "level": 0, "guidance": "No plot required at all." },
    "interaction": { "level": 5, "guidance": "Almost every page offers something to do or say." },
    "repetition": { "level": 4, "guidance": "Very high — the same shape, one element changing." },
    "castSize": { "level": 0, "guidance": "One or two subjects in the whole book." },
    "readerInference": { "level": 0, "guidance": "Nothing implied." },
    "dialogue": { "level": 0, "guidance": "Single words at most." },
    "conflict": { "level": 0, "guidance": "Essentially none." }
  },
  "structure": {
    "minWords": 20,
    "maxWords": 70,
    "beats": 2,
    "maxSentenceWords": 6,
    "plotRequired": false
  },
  "density": {
    "targetWordsPerPage": 3,
    "maxWordsPerPage": 7,
    "targetSentencesPerPage": 1,
    "maxFocalCharactersPerScene": 1,
    "minPages": 8,
    "maxPages": 22
  },
  "protagonist": {
    "minAge": 1,
    "maxAge": 3,
    "guidance": "The main subject should read as roughly {{min}}–{{max}} years old, or a friendly animal of that emotional age."
  },
  "defaultCharacterAgeYears": 2,
  "safety": {
    "avoid": [
      "separation from a caregiver that is not resolved immediately",
      "loud or frightening surprises",
      "sudden darkness or characters disappearing without returning"
    ],
    "note": "Every page ends safe. Nothing is left unresolved across a page turn except a friendly, immediately answered question."
  },
  "evaluatedDimensionIds": [
    "textDensity",
    "repetition",
    "interaction",
    "sensoryLanguage",
    "illustrationDependency",
    "emotionalComplexity"
  ]
}
```

---

## 12. LLM System Prompt Template

To task another LLM with creating or updating age bands using this framework, use this prompt wrapper:

```markdown
Act as a children's publishing editor and configuration engineer for this product.

Task: [CREATE | OVERRIDE | DELETE | RESTORE | AUDIT] the age band [ID AND RANGE].
Output shape: [FULL PROFILE | SPARSE OVERRIDE | AUDIENCECONFIG ENVELOPE |
STORYCRAFTCONFIG ENVELOPE | COMBINED AUDIENCE + STORY CRAFT | AUDIT].
Product format: [BOARD BOOK | PICTURE BOOK | ILLUSTRATED EARLY READER | OTHER].
Reading context: [READ ALOUD | WITH HELP | INDEPENDENT | MIXED].
Content locale/language: [VALUE].
Neighbouring enabled bands: [VALUES].
Story Craft requirement: [NONE | CONFIGURE THEMES, DEVICES, AND SETTINGS | AUDIT EXISTING].
Lifecycle requirement: [OFFERED | HIDDEN BUT EDITABLE | DELETED TOMBSTONE | RESTORED HIDDEN].
Additional requirements and evidence sources: [VALUES].

Use the supplied Audience Profile Authoring Framework as the product contract.

Before answering:
1. Apply the exact schema and legal IDs/levels.
2. Distinguish the stored override from the resolved profile.
3. Resolve inheritance using its actual sections-and-dimensions-only behavior.
4. Check inclusive month ranges, sort precedence, aliases, modes, safety, all cross-field
   coherence checks, page-interval overlap, exact compiler routing, and the matching Story Craft
   entry when the task includes creative choices.
5. Treat developmental benchmarks as editorial defaults, not universal facts.
6. Do not fabricate evidence, unsupported precision, or persistence.

For strict JSON output, emit only valid JSON in the requested shape. For an audit, give findings
by severity, corrected values, assumptions, and any evidence gaps.
```

### 12.1 Minimum Task Inputs

If the requester does not provide enough information, use explicit assumptions for reversible editorial choices. Ask a focused question only when the missing choice materially changes the product—for example, whether a 7-year-old reads independently or is listening to an adult, or whether the deliverable is a 16-page illustrated story or a conventional chapter book.
