/**
 * The AUDIENCE catalog: who a book is written for, and every editorial rule
 * that follows from that.
 *
 * This replaces four separate places that were each keyed by a hardcoded age
 * band id (`AGE_RANGES`, `ageWriting.bands`, the rule half of `storyCraft`, and
 * the wizard's caption map). One profile per band now owns the whole editorial
 * contract, and every LLM call reads its overlay from the same resolved object.
 *
 * Split of ownership, deliberately the same as `prompts/registry.ts`:
 *   - CODE owns the STRUCTURE: which dimensions exist, which guardrail sections
 *     exist, and — crucially — which pipeline CHANNEL each one is compiled
 *     into. A section can never leak into a prompt it wasn't written for.
 *   - ADMINS own the CONTENT: the bands themselves, their month bounds, the
 *     prose of every section, the level of every dimension, and the numbers.
 *
 * Adding a band is a dashboard action, not a code change. Adding a *kind* of
 * guidance is a one-line addition here, and it appears in the dashboard, the
 * compiler and the affected prompts at once.
 */
import type { ReadingModeId } from "./readingModes";

// ---------------------------------------------------------------------------
// Channels — where a piece of guidance is allowed to end up
// ---------------------------------------------------------------------------

/**
 * The consumers of audience guidance. Each maps to one compiled string on
 * {@link import("../prompts/audience").AudienceOverlays}.
 *
 * `story` covers drafting, translation, revision and the age-fit read — every
 * call that produces or judges the manuscript. `screenplay` is pagination and
 * illustration briefs. `illustration` and `characterArt` are image models,
 * which need the visual consequences and nothing about prose.
 */
export const OVERLAY_CHANNELS = [
  "human",
  "story",
  "screenplay",
  "illustration",
  "characterArt",
  "evaluation",
] as const;

export type OverlayChannel = (typeof OVERLAY_CHANNELS)[number];

export const CHANNEL_LABELS: Record<OverlayChannel, string> = {
  human: "Shown to the customer",
  story: "Story writing",
  screenplay: "Page plan",
  illustration: "Page pictures",
  characterArt: "Character sheets",
  evaluation: "Reading-level check",
};

// ---------------------------------------------------------------------------
// Editorial dimensions — the rubric
// ---------------------------------------------------------------------------

/**
 * One measurable axis of "how a book for this age reads".
 *
 * `levels` is dimension-specific vocabulary rather than a shared 1–5 scale,
 * because "Very high repetition" and "Very high plot complexity" describe
 * different things and an admin comparing two bands should read words, not
 * numbers. The index into `levels` is what's stored.
 */
export interface EditorialDimensionDef {
  id: string;
  label: string;
  /** One line under the label in the dashboard. */
  hint: string;
  /** Ascending: index 0 is the least of this quality. */
  levels: string[];
  /** Which compiled overlays this dimension's guidance may appear in. */
  channels: OverlayChannel[];
}

const dim = (
  id: string,
  label: string,
  hint: string,
  levels: string[],
  channels: OverlayChannel[],
): EditorialDimensionDef => ({ id, label, hint, levels, channels });

/**
 * The rubric every band is described with. Order is the order they appear in
 * the dashboard and in every compiled overlay.
 */
export const EDITORIAL_DIMENSIONS: EditorialDimensionDef[] = [
  dim(
    "textDensity",
    "Text density",
    "How much text a page carries. The page-level numbers live in Page pacing.",
    ["Minimal", "Very low", "Low", "Low–medium", "Medium", "Medium–high", "High"],
    ["story", "screenplay", "evaluation"],
  ),
  dim(
    "sentenceComplexity",
    "Sentence complexity",
    "Sentence length and grammar, not vocabulary difficulty.",
    ["Tiny", "Simple", "Moderate", "Varied", "Varied and complex"],
    ["story", "evaluation"],
  ),
  dim(
    "illustrationDependency",
    "Illustration dependency",
    "How much of the story the picture carries instead of the words.",
    ["Low", "Low–medium", "Medium", "High", "Very high"],
    ["screenplay", "illustration", "evaluation"],
  ),
  dim(
    "repetition",
    "Repetition",
    "Repeated phrases and structures the child can learn and join in with.",
    ["Optional", "Low", "Medium", "High", "Very high"],
    ["story", "screenplay", "evaluation"],
  ),
  dim(
    "plotComplexity",
    "Plot complexity",
    "Whether the book needs a plot at all, and how much of one.",
    ["None", "Tiny", "Simple", "Full but simple", "Moderate", "Complex"],
    ["story", "evaluation"],
  ),
  dim(
    "castSize",
    "Characters",
    "How many characters the reader can hold in mind at once.",
    ["1–2", "1–3", "1–4", "A small cast", "Several", "Flexible"],
    ["story", "screenplay", "illustration", "evaluation"],
  ),
  dim(
    "dialogue",
    "Dialogue",
    "How much of the story is carried by people talking.",
    ["Rare", "Minimal", "Simple", "Common", "Rich"],
    ["story", "evaluation"],
  ),
  dim(
    "conflict",
    "Conflict",
    "How much can go wrong, and for how long.",
    ["Almost none", "Tiny", "Mild", "Moderate", "Significant"],
    ["story", "screenplay", "illustration", "evaluation"],
  ),
  dim(
    "emotionalComplexity",
    "Emotional complexity",
    "How layered the feelings are allowed to be.",
    ["Basic", "Simple", "Moderate", "Nuanced"],
    ["story", "illustration", "evaluation"],
  ),
  dim(
    "readerInference",
    "Reader inference",
    "How much the reader has to work out that the text never says.",
    ["None", "Very low", "Low", "Medium", "Medium–high", "High"],
    ["story", "evaluation"],
  ),
  dim(
    "figurativeLanguage",
    "Figurative language",
    "Metaphor, simile and idiom that need interpreting.",
    ["None", "Rare", "Light", "Some", "Freely"],
    ["story", "evaluation"],
  ),
  dim(
    "subplots",
    "Subplots",
    "Whether a second thread can run alongside the main one.",
    ["None", "Usually none", "Light", "Yes"],
    ["story", "evaluation"],
  ),
  dim(
    "interaction",
    "Interaction",
    "Pointing, naming, counting, answering — inviting the child in.",
    ["Rare", "Low", "Medium", "Medium–high", "High", "Very high"],
    ["story", "screenplay", "evaluation"],
  ),
  dim(
    "sensoryLanguage",
    "Sensory language",
    "Sound, touch, movement and other body-level description.",
    ["As appropriate", "Medium", "High"],
    ["story", "illustration", "evaluation"],
  ),
];

export const DIMENSION_IDS = EDITORIAL_DIMENSIONS.map((d) => d.id);

export function dimensionDef(id: string): EditorialDimensionDef | undefined {
  return EDITORIAL_DIMENSIONS.find((d) => d.id === id);
}

/** The stored value for one dimension on one band. */
export interface AudienceDimension {
  /** Index into the definition's `levels`. Clamped on resolve. */
  level: number;
  /** What the model is told. Empty means "level only, no prose". */
  guidance: string;
}

// ---------------------------------------------------------------------------
// Guardrail sections — the editorial prose
// ---------------------------------------------------------------------------

/**
 * A named block of editorial direction. Sections are how a real picture-book
 * brief is organised, and keeping them separate (rather than as one long
 * textarea) is what lets the compiler send page-turn rules to the screenplay
 * and visual rules to the image model without sending either the whole essay.
 */
export interface GuardrailSectionDef {
  id: string;
  label: string;
  hint: string;
  channels: OverlayChannel[];
  /** Heading emitted above the text in the compiled overlay. */
  heading: string;
}

const sec = (
  id: string,
  label: string,
  hint: string,
  heading: string,
  channels: OverlayChannel[],
): GuardrailSectionDef => ({ id, label, hint, heading, channels });

export const GUARDRAIL_SECTIONS: GuardrailSectionDef[] = [
  sec(
    "language",
    "Language",
    "Vocabulary, sentence shape, and what to prefer over what.",
    "LANGUAGE",
    ["story", "evaluation"],
  ),
  sec(
    "readAloud",
    "Read-aloud quality",
    "Writing for the adult's voice, not just the child's comprehension.",
    "READ-ALOUD QUALITY",
    ["story", "evaluation"],
  ),
  sec(
    "repetition",
    "Repetition and predictability",
    "How patterns are established and varied.",
    "REPETITION & PREDICTABILITY",
    ["story", "screenplay", "evaluation"],
  ),
  sec(
    "pageStructure",
    "Page structure",
    "One page's job, and the reason to turn it. Goes to the page plan only.",
    "PAGE STRUCTURE",
    ["screenplay", "evaluation"],
  ),
  sec(
    "storyStructure",
    "Story structure",
    "What shape the whole book takes — plot, cycle, journey or routine.",
    "STORY STRUCTURE",
    ["story", "evaluation"],
  ),
  sec(
    "interaction",
    "Interaction",
    "How the child is invited to take part.",
    "INTERACTION",
    ["story", "screenplay", "evaluation"],
  ),
  sec(
    "visualStorytelling",
    "Visual storytelling",
    "How text and picture divide the work. Reaches the page plan and the image model.",
    "VISUAL STORYTELLING",
    ["screenplay", "illustration", "evaluation"],
  ),
  sec(
    "recognition",
    "Recognition and learning",
    "The concepts this age enjoys spotting and naming.",
    "RECOGNITION & LEARNING",
    ["story", "illustration"],
  ),
  sec(
    "sensory",
    "Sensory language",
    "Sounds, textures and physical experience.",
    "SENSORY LANGUAGE",
    ["story", "illustration"],
  ),
  sec(
    "emotion",
    "Emotion and conflict",
    "The emotional range, and how fast trouble has to resolve.",
    "EMOTION & CONFLICT",
    ["story", "screenplay", "illustration", "evaluation"],
  ),
  sec(
    "humor",
    "Humour",
    "What is actually funny at this age.",
    "HUMOUR",
    ["story", "screenplay", "illustration"],
  ),
  sec(
    "characterArt",
    "Character design",
    "How the cast should be drawn for this age. Character sheets only.",
    "CHARACTER DESIGN FOR THIS AGE",
    ["characterArt"],
  ),
  sec(
    "calibration",
    "Age calibration",
    "What separates this band from its neighbours. The main thing to override on an inherited band.",
    "AGE CALIBRATION",
    ["story", "screenplay", "evaluation"],
  ),
  sec(
    "qualityTest",
    "Quality test",
    "The questions to ask of every page before finalising it.",
    "QUALITY TEST",
    ["story", "screenplay", "evaluation"],
  ),
];

export const SECTION_IDS = GUARDRAIL_SECTIONS.map((s) => s.id);

export function sectionDef(id: string): GuardrailSectionDef | undefined {
  return GUARDRAIL_SECTIONS.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// The profile
// ---------------------------------------------------------------------------

/** Hard structural bounds for the whole manuscript. */
export interface AudienceStructure {
  minWords: number;
  maxWords: number;
  /** Rough number of story beats (or repetition cycles) to move through. */
  beats: number;
  /** Longest sentence in words; 0 disables both the instruction and the check. */
  maxSentenceWords: number;
  /**
   * Whether a conventional beginning/middle/end is required. False lets a band
   * be a naming book, a counting book or a routine — the shipped story-draft
   * prompt demands a plot, and for a twelve-month-old that is the wrong book.
   */
  plotRequired: boolean;
}

/**
 * Page-level pacing. Applied when the manuscript is split into pages, which is
 * the only point where "one short sentence per page" can be enforced at all.
 */
export interface AudienceDensity {
  /** What a typical page should carry. */
  targetWordsPerPage: number;
  /** The ceiling a page may not exceed. 0 disables the check. */
  maxWordsPerPage: number;
  targetSentencesPerPage: number;
  /** How many characters may share one illustration and stay readable. */
  maxFocalCharactersPerScene: number;
  /** Rough page budget for the book, so pacing has somewhere to land. */
  minPages: number;
  maxPages: number;
}

export interface AudienceProtagonist {
  minAge: number;
  maxAge: number;
  /** `{{min}}` / `{{max}}` are substituted. */
  guidance: string;
}

export interface AudienceSafety {
  avoid: string[];
  note: string;
}

/** Guidance that varies by how the book is read. */
export interface ModeGuidance {
  /** Shown in the setup wizard. */
  humanGuidance: string;
  /** Appended to the story overlay for this mode. */
  storyGuidance: string;
}

/** The default key in `modes` for bands with no reading-mode split. */
export const DEFAULT_MODE_KEY = "default";
export type ModeKey = typeof DEFAULT_MODE_KEY | ReadingModeId;

export interface AudienceProfile {
  id: string;
  /** Shown everywhere a band is named. */
  label: string;
  /** Two words of publishing context under the label in the age picker. */
  caption: string;
  /** One line in the age picker. */
  description: string;
  /** Inclusive lower bound in months. Months, so 0–12 and 13–24 are expressible. */
  minMonths: number;
  /** Inclusive upper bound in months. */
  maxMonths: number;
  order: number;
  /** Off means: keeps working for books that already use it, hidden from the picker. */
  enabled: boolean;
  /** Other ids that resolve here — how a band is renamed without breaking books. */
  aliases: string[];
  /** Inherit every unset section and dimension from this profile. */
  extendsId?: string;
  /** Empty means this band has no reading-mode question. */
  readingModes: ReadingModeId[];
  modes: Partial<Record<ModeKey, ModeGuidance>>;
  sections: Record<string, string>;
  dimensions: Record<string, AudienceDimension>;
  structure: AudienceStructure;
  density: AudienceDensity;
  protagonist: AudienceProtagonist;
  /**
   * Age in YEARS for a character the story never dates. Explicit rather than
   * derived from the band's midpoint: a 0–12 month band's midpoint is six
   * months, and "six" as a character age would put an infant's height on every
   * unnamed grown-up.
   */
  defaultCharacterAgeYears: number;
  safety: AudienceSafety;
  /** Which dimensions the reading-level check actually scores. */
  evaluatedDimensionIds: string[];
}

// ---------------------------------------------------------------------------
// Shared building blocks for the shipped defaults
// ---------------------------------------------------------------------------

const UNIVERSAL_AVOID = [
  "graphic violence, gore, brutality, or severe injury",
  "death of a parent or caregiver",
  "sexual content of any kind",
  "slurs, bullying framed approvingly, or cruelty played for laughs",
  "unresolved fear at the end of the story",
];

/**
 * The floor no admin can edit away. `safety.avoid` on a profile ADDS to this;
 * a dashboard field that can delete "sexual content of any kind" from a
 * children's-book prompt should not exist.
 */
export const MANDATORY_AVOID: readonly string[] = Object.freeze([...UNIVERSAL_AVOID]);

const d = (level: number, guidance: string): AudienceDimension => ({ level, guidance });

// ---------------------------------------------------------------------------
// Shipped profiles
// ---------------------------------------------------------------------------

/**
 * The bands the app ships with.
 *
 * The four original ids are unchanged and enabled, so every existing book keeps
 * resolving exactly what it resolved before. The two month-level bands ship
 * disabled: they extend `0-2`, override only what genuinely differs, and become
 * available the moment an admin switches them on.
 */
export const DEFAULT_AUDIENCE_PROFILES: AudienceProfile[] = [
  {
    id: "0-2",
    label: "0–2 years",
    caption: "First books",
    description: "Board-book simplicity: a few words per page, bold shapes, warm and reassuring.",
    minMonths: 0,
    maxMonths: 35,
    order: 10,
    enabled: true,
    aliases: [],
    readingModes: [],
    modes: {
      default: {
        humanGuidance:
          "Board-book simplicity: a few words per page, bold shapes, warm and reassuring.",
        storyGuidance: "",
      },
    },
    sections: {
      language:
        "Use very short, immediately understandable language. Most pages should carry one short sentence, phrase, sound, or naming expression. A few words may be enough — but do not force every page into a rigid word limit when a natural short sentence reads better aloud.\n" +
        "Prefer concrete things the child can see, hear, touch or physically imagine: Mama, dog, moon, cup, toes, rain, ball, bird. Prefer simple actions: run, eat, hug, jump, sleep, wave, splash, open, fall, find.\n" +
        "Favour familiar words over artificially short ones. A longer but familiar word such as \"banana\", \"elephant\" or \"butterfly\" is better than an unfamiliar shorter one.\n" +
        "Use simple sentence structures. Avoid subordinate clauses, tense changes, explanations, abstract reasoning, metaphor that needs interpreting, and adult vocabulary.",
      readAloud:
        "Write for the adult's voice as much as for the child's comprehension. Favour rhythm, repetition, parallel structure, playful sounds, and phrases that are satisfying to say again and again.\n" +
        "Useful patterns include: \"Up, up, up!\" / \"Splash!\" / \"Where is Bear?\" / \"Hello, duck!\" / \"Goodnight, moon.\"\n" +
        "Rhyme is optional. Never force a rhyme at the expense of natural language or comprehension.",
      repetition:
        "Repetition is a feature, not a flaw. Establish a pattern the child can learn after one or two repetitions, then change ONE concrete element at a time — the object, animal, colour, action, sound, number or location — while the sentence structure stays familiar.\n" +
        "Let the child anticipate what comes next and eventually \"read\" or complete the repeated phrases themselves.",
      pageStructure:
        "Give each page or spread ONE dominant idea, action, object, emotion or discovery. Never advance several plot events on one page.\n" +
        "Think in page turns. Wherever possible create a small reason to turn the page: a question, a movement, a hidden object, an unfinished action, a repeated sequence, or an expected reveal. A page may set something up and the next page may answer it.",
      storyStructure:
        "Keep the narrative extremely easy to follow. Strong shapes for this age are repetition cycles, searches, routines, journeys through familiar objects, counting or accumulation, greetings and goodnights, simple transformations, call-and-response, and tiny cause-and-effect sequences.\n" +
        "A conventional beginning–middle–end plot is OPTIONAL. When there is a story, favour clear physical causality: baby drops the ball; the ball rolls; dog finds it; baby hugs dog.\n" +
        "Avoid complicated motivations, backstory, parallel plots, hidden meanings, or lessons that have to be explained.",
      interaction:
        "Where it fits, give the child something to do: pointing, naming, finding, counting, making a sound, copying an action, predicting something, answering a repeated question, or noticing something in the picture.\n" +
        "Do not turn every page into an instruction. Interaction should feel playful, not drilled.",
      visualStorytelling:
        "Assume the illustrations carry a large part of the story. Do not describe in words what the picture already makes obvious.\n" +
        "Text and illustration should COMPLEMENT rather than duplicate each other: the words name the important action while the picture supplies setting, expressions, secondary detail, humour, or a small visual surprise.\n" +
        "Compose scenes around ONE visually dominant subject with a clear, readable action. Avoid scenes that depend on many characters or complicated spatial relationships.",
      recognition:
        "Naturally include the things babies and toddlers enjoy recognising: animals, family members, faces, body parts, food, toys, vehicles, bedtime objects, nature, colours, simple numbers, sizes, sounds and everyday routines.\n" +
        "Do not make the book feel instructional. Learning should emerge through naming, repetition, comparison and joining in.",
      sensory:
        "Favour experiences the child knows through their senses and body: \"Soft bunny.\" \"Cold snow.\" \"Splash, splash!\" \"Crunch!\" \"Warm blanket.\" \"Big stretch!\"\n" +
        "Expressive sound words — beep, woof, uh-oh, pop, yum, whoosh — are especially effective.",
      emotion:
        "Keep the emotional world secure, understandable and quickly recoverable. Warmth, affection, curiosity, excitement, silliness, surprise, impatience, small mistakes, searching and brief uncertainty all belong here.\n" +
        "Mild tension is allowed when it is simple and resolves quickly — losing sight of a toy, wondering what is behind something, a gentle fall, looking for a parent who is immediately nearby.\n" +
        "Avoid sustained fear, abandonment, real danger, death, humiliation, threatening villains, emotionally complex conflict, and any distress left unresolved.\n" +
        "Do not state a moral. If the book models kindness, curiosity, patience or affection, let it come from what happens.",
      humor:
        "Use simple visual or situational humour rather than wordplay. Good toddler humour comes from repetition with an unexpected variation, animals behaving slightly oddly, funny sounds, things being in the wrong place, exaggeration, or a harmless surprise.",
      characterArt:
        "Design for a very young viewer: large readable faces with clear, friendly expressions, simple bold silhouettes that stay recognisable at a glance, strong colour separation between characters, and uncluttered detail. Nothing sharp, gloomy or menacing.",
      calibration:
        "Around 0–12 months, prioritise rhythm, sounds, faces, naming, repetition, contrast, sensory language and very simple recurring structures. Plot may be almost nonexistent.\n" +
        "Around 12–24 months, add simple questions, familiar routines, predictable sequences, tiny problems and resolutions, cause and effect, actions to imitate, and things to name or find.",
      qualityTest:
        "Before finalising each page, ask: can a very young child enjoy this without understanding every word? Does it sound good spoken aloud? Is there one clear focus? Can the picture carry much of the meaning? Is there repetition, recognition, anticipation, interaction or sensory pleasure? Is there enough here to make the child want to look, listen, join in, or turn the page?\n" +
        "Across the whole book, avoid monotonous minimalism. Simplicity must not mean every page has the same energy — vary sounds, actions, scale, movement, expressions and reveals while keeping the overall structure highly predictable.\n" +
        "Above all, optimise for RE-READABILITY. A good book for this age gets better on the tenth reading, because the child starts recognising objects, anticipating phrases, joining in, making the sounds, pointing and predicting.",
    },
    dimensions: {
      textDensity: d(1, "A phrase or one very short sentence per page."),
      sentenceComplexity: d(1, "Simple subject-verb sentences. No clauses."),
      illustrationDependency: d(4, "The picture carries most of the meaning."),
      repetition: d(4, "A repeating pattern is the spine of the book."),
      plotComplexity: d(1, "At most a tiny sequence of cause and effect."),
      castSize: d(1, "One to three characters across the whole book."),
      dialogue: d(1, "Only single spoken words or greetings."),
      conflict: d(1, "A momentary wobble, resolved on the next page."),
      emotionalComplexity: d(0, "One plain feeling at a time."),
      readerInference: d(0, "Nothing is left for the reader to work out."),
      figurativeLanguage: d(0, "Everything literal."),
      subplots: d(0, "A single thread only."),
      interaction: d(4, "Invite pointing, naming and sound-making often."),
      sensoryLanguage: d(2, "Sound, texture and movement throughout."),
    },
    structure: {
      minWords: 60,
      maxWords: 140,
      beats: 3,
      maxSentenceWords: 8,
      plotRequired: false,
    },
    density: {
      targetWordsPerPage: 6,
      maxWordsPerPage: 12,
      targetSentencesPerPage: 1,
      maxFocalCharactersPerScene: 2,
      minPages: 10,
      maxPages: 24,
    },
    protagonist: {
      minAge: 2,
      maxAge: 4,
      guidance:
        "The main character should read as roughly {{min}}–{{max}} years old (or a small animal of that emotional age) so the listener recognises themselves.",
    },
    defaultCharacterAgeYears: 2,
    safety: {
      avoid: [
        "separation from a caregiver that is not resolved immediately",
        "loud or frightening surprises",
      ],
      note: "Any surprise must be resolved on the very next page. The book ends calm and safe.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "sentenceComplexity",
      "repetition",
      "interaction",
      "emotionalComplexity",
      "plotComplexity",
    ],
  },

  {
    id: "3-5",
    label: "3–5 years",
    caption: "Picture books",
    description: "Picture-book read-aloud: short sentences, playful rhythm, lots of imagery.",
    minMonths: 36,
    maxMonths: 71,
    order: 20,
    enabled: true,
    aliases: [],
    readingModes: [],
    modes: {
      default: {
        humanGuidance:
          "Picture-book read-aloud: short sentences, playful rhythm, lots of imagery.",
        storyGuidance: "",
      },
    },
    sections: {
      language:
        "One or two short sentences per page. Simple sentences mostly; the occasional compound sentence joined with \"and\" or \"but\" is fine.\n" +
        "Everyday vocabulary plus a few stretch words whose meaning is obvious from context. Playful sound words and dialogue in quotes are welcome.\n" +
        "Avoid nested clauses, sarcasm, irony and abstract philosophy.",
      readAloud:
        "This book will be read aloud by an adult, often at bedtime and often many times. Write for the mouth: a steady rhythm, satisfying sounds, and lines an adult enjoys performing.\n" +
        "If the story rhymes, keep the metre confident and never bend sense to reach a rhyme.",
      repetition:
        "Use a refrain or a repeated structure the child can learn and chant along with. Repetition at this age is what turns a book into a favourite.",
      pageStructure:
        "One story beat per page. Make it clear who is doing what.\n" +
        "End most pages on a small hook — a question, a movement, or an unfinished action — so the page turn has a payoff.",
      storyStructure:
        "A clear beginning, one problem or adventure in the middle, and a warm, satisfying ending. Keep the causal chain visible: this happened, so that happened.\n" +
        "The hero should solve or survive the problem themselves rather than being rescued and told what to think.",
      interaction:
        "Direct questions to the reader, invitations to count, spot or shout along, and moments of anticipation all work well. Use them a few times, not on every page.",
      visualStorytelling:
        "The picture should carry the setting, the expressions and the jokes; the words carry the action and the voice. Don't spend words describing what the reader can already see.\n" +
        "Give each scene one clear focal moment an illustrator can actually stage.",
      recognition:
        "Friendship, curiosity, bedtime, family, animals, weather, food and everyday adventures are the furniture of this age. Concrete and familiar beats novel and abstract.",
      sensory:
        "Sound words, textures and physical comedy land well. Let the child feel the splash, the crunch and the cold.",
      emotion:
        "Name big feelings plainly — cross, sad, jealous, proud — and move through them to calm. Mild tension is welcome but must resolve warmly within a page or two.\n" +
        "The ending is unambiguously happy. Avoid frightening adults, lasting peril and explicit morals.",
      humor:
        "Silliness, gentle absurdity, repetition with a twist, and characters behaving unexpectedly. The joke should work in the picture as well as the words.",
      characterArt:
        "Expressive, rounded, friendly designs with clear silhouettes and strong colour identity per character. Faces should read emotion instantly at picture-book size.",
      calibration:
        "Nearer three, lean on rhythm, repetition and very concrete events. Nearer five, a real problem, a proper middle and a small twist all become enjoyable.",
      qualityTest:
        "Per page: one clear beat, a reason to turn, something for the illustrator, and a line that is a pleasure to read aloud. Across the book: does the hero change something, and does the ending feel earned?",
    },
    dimensions: {
      textDensity: d(2, "One or two short sentences per page."),
      sentenceComplexity: d(1, "Simple sentences; occasional 'and'/'but'."),
      illustrationDependency: d(3, "The picture carries setting and emotion."),
      repetition: d(3, "A refrain or repeated structure the child can join."),
      plotComplexity: d(2, "A single clear problem and its resolution."),
      castSize: d(2, "Up to about four characters."),
      dialogue: d(2, "Short, clearly attributed lines."),
      conflict: d(2, "Real but small, and resolved warmly."),
      emotionalComplexity: d(1, "One named feeling, honestly handled."),
      readerInference: d(1, "Almost everything is stated."),
      figurativeLanguage: d(1, "The occasional obvious comparison."),
      subplots: d(0, "One thread."),
      interaction: d(3, "Regular invitations to join in."),
      sensoryLanguage: d(2, "Rich and physical."),
    },
    structure: {
      minWords: 150,
      maxWords: 320,
      beats: 5,
      maxSentenceWords: 16,
      plotRequired: true,
    },
    density: {
      targetWordsPerPage: 22,
      maxWordsPerPage: 45,
      targetSentencesPerPage: 2,
      maxFocalCharactersPerScene: 3,
      minPages: 8,
      maxPages: 16,
    },
    protagonist: {
      minAge: 4,
      maxAge: 6,
      guidance:
        "The hero should be about {{min}}–{{max}} years old — a touch older than the reader, which is who a preschooler wants to be.",
    },
    defaultCharacterAgeYears: 4,
    safety: {
      avoid: ["peril that lasts more than a page", "adults who are frightening rather than kind"],
      note: "Tension is welcome but must resolve warmly within a page or two, and the ending is unambiguously happy.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "sentenceComplexity",
      "plotComplexity",
      "conflict",
      "emotionalComplexity",
      "figurativeLanguage",
    ],
  },

  {
    id: "6-8",
    label: "6–8 years",
    caption: "Early readers",
    description: "Early readers: richer plot, longer paragraphs, real feelings.",
    minMonths: 72,
    maxMonths: 107,
    order: 30,
    enabled: true,
    aliases: [],
    readingModes: ["read-aloud", "with-help", "independent"],
    modes: {
      "read-aloud": {
        humanGuidance:
          "Richer story for listening: an adult reads while the child follows the pictures. Longer sentences and more descriptive language are fine.",
        storyGuidance:
          "Write for listening rather than solo reading. The adult carries the difficult words, so vocabulary can be richer and sentences a little longer. Include vivid description and natural dialogue, and polish the rhythm for reading aloud.",
      },
      "with-help": {
        humanGuidance:
          "Early reader with support: the child reads most words while an adult helps with harder vocabulary and longer sentences.",
        storyGuidance:
          "The child reads most of this with an adult nearby. Keep sentences mostly short and medium; when a rare word is worth using, make its meaning clear from context. Keep dialogue simple and clearly attributed.",
      },
      independent: {
        humanGuidance:
          "Confident early reader: the child reads on their own. Shorter sentences, familiar vocabulary, clear action on every page.",
        storyGuidance:
          "The child reads this alone, so nothing may stall them. Favour high-frequency vocabulary, introduce at most one new word per page with a strong context clue, and keep syntax straightforward with strong verbs and clear subjects.",
      },
    },
    sections: {
      language:
        "Two to four sentences per page. Mix sentence lengths so the prose has rhythm. Vocabulary can stretch, but a hard word should either be clear from context or worth the pause.",
      readAloud:
        "Even when the child reads alone, the prose should sound good. Read every line in your head — if it stumbles, rewrite it.",
      repetition:
        "Running gags, repeated phrases and recurring structures still work, but as texture rather than as the spine of the book.",
      pageStructure:
        "One clear story beat per page, ending on a small hook or unanswered question wherever the plot allows.",
      storyStructure:
        "A real plot with a goal, obstacles and a resolution the hero brings about themselves. Adults may help but must not solve it for them.\n" +
        "Small mysteries, quests, friendship trouble and honest mistakes all suit this age.",
      interaction:
        "Direct address is largely gone. Involvement now comes from suspense, from clues the reader can piece together, and from wanting to know what happens.",
      visualStorytelling:
        "Pictures illuminate the moment rather than carrying the plot. Choose the single most dramatic or funniest beat on the page to illustrate.",
      recognition:
        "School, friendship, family change, animals, invention, fairness and owning up are the recognisable territory here.",
      sensory:
        "Concrete sensory detail makes a scene believable. Use it to ground the action, not to decorate it.",
      emotion:
        "Real stakes and real feelings are welcome. Embarrassment, unfairness, worry and pride all belong. The ending must leave the reader hopeful.\n" +
        "Avoid genuine horror and humiliation played for laughs.",
      humor:
        "Comic timing, running gags and a narrator who is in on the joke. Wordplay starts to land at this age.",
      characterArt:
        "Distinct, readable character designs with clear costume identity and expressive faces. Scenes can hold more detail and more figures than at younger ages.",
      calibration:
        "Nearer six, keep sentences short and the plot single-stranded. Nearer eight, longer paragraphs, a light subplot and a genuine twist all become enjoyable.",
      qualityTest:
        "Per page: is it clear who wants what? Is there a reason to keep reading? Across the book: does the hero solve it, and did the reader have a fair chance to see it coming?",
    },
    dimensions: {
      textDensity: d(4, "Two to four sentences per page."),
      sentenceComplexity: d(2, "Mixed lengths, some subordinate clauses."),
      illustrationDependency: d(2, "Pictures support rather than carry."),
      repetition: d(1, "Texture only — running gags and refrains."),
      plotComplexity: d(4, "A goal, obstacles and an earned resolution."),
      castSize: d(4, "Several characters, clearly differentiated."),
      dialogue: d(3, "Frequent, with distinct voices."),
      conflict: d(3, "Real stakes, honestly felt."),
      emotionalComplexity: d(2, "Mixed feelings the reader can name."),
      readerInference: d(3, "Some things are shown, not told."),
      figurativeLanguage: d(3, "Comparisons and light imagery."),
      subplots: d(2, "One light secondary thread at most."),
      interaction: d(1, "Suspense rather than direct address."),
      sensoryLanguage: d(1, "Used to ground scenes."),
    },
    structure: {
      minWords: 300,
      maxWords: 600,
      beats: 7,
      maxSentenceWords: 22,
      plotRequired: true,
    },
    density: {
      targetWordsPerPage: 48,
      maxWordsPerPage: 90,
      targetSentencesPerPage: 3,
      maxFocalCharactersPerScene: 4,
      minPages: 8,
      maxPages: 16,
    },
    protagonist: {
      minAge: 7,
      maxAge: 9,
      guidance:
        "The hero should be about {{min}}–{{max}} years old and solve the final problem themselves; adults may help but must not fix it for them.",
    },
    defaultCharacterAgeYears: 7,
    safety: {
      avoid: ["genuine horror or body horror", "humiliation as a punchline"],
      note: "Real stakes and real feelings are welcome; the ending must leave the reader hopeful.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "sentenceComplexity",
      "plotComplexity",
      "dialogue",
      "conflict",
      "readerInference",
    ],
  },

  {
    id: "9-12",
    label: "9–12 years",
    caption: "Chapter books",
    description: "Chapter-style storytelling with detailed scenes and real stakes.",
    minMonths: 108,
    maxMonths: 155,
    order: 40,
    enabled: true,
    aliases: [],
    readingModes: ["read-aloud", "with-help", "independent"],
    modes: {
      "read-aloud": {
        humanGuidance:
          "Family read-aloud or bedtime: richer language and longer passages — the adult reads while the child enjoys the art.",
        storyGuidance:
          "Write for listening by an adult. Sophisticated vocabulary and varied syntax are welcome, as are foreshadowing and interiority. Give dialogue personality and subtext, and pace it for reading aloud.",
      },
      "with-help": {
        humanGuidance:
          "Upper elementary reader with occasional help: engaging plot with mostly accessible language and some stretch vocabulary.",
        storyGuidance:
          "The reader manages most of this alone with occasional help on hard words. Mix sentence lengths, contextualise challenging vocabulary, and keep scene goals and emotional beats clear.",
      },
      independent: {
        humanGuidance:
          "Tween reads solo: chapter-book density with clear prose, strong hooks, and age-appropriate complexity.",
        storyGuidance:
          "Accessible but never dumbed down. Clear syntax, strong verbs, concrete description. Subplots and foreshadowing are fine when they are easy to follow page to page, and every character should sound like themselves.",
      },
    },
    sections: {
      language:
        "Three to six sentences per page. Vary syntax deliberately. Sophisticated vocabulary is fine when the sentence around it does the explaining.",
      readAloud:
        "Prose rhythm still matters, especially in dialogue and at chapter ends. Read the last line of every section aloud.",
      repetition:
        "Repetition is now a deliberate rhetorical device — a motif, a callback, a refrain that gains meaning — not a scaffold.",
      pageStructure:
        "Pages carry scenes rather than single beats. End sections on a revelation, a threat or a question.",
      storyStructure:
        "A real plot with genuine stakes and consequences the hero must live with. Foreshadow properly and pay off what you plant.\n" +
        "Subplots are welcome when they illuminate the main thread rather than competing with it.",
      interaction:
        "The reader is engaged through curiosity and inference, not invitation. Trust them to notice things.",
      visualStorytelling:
        "Illustrations are punctuation: choose the moments with the strongest visual charge and let the prose carry everything else.",
      recognition:
        "Identity, belonging, fairness, loyalty, rivalry and inherited history are what this age is actually thinking about.",
      sensory:
        "Specific, unexpected sensory detail is what makes a scene feel real. One precise detail beats three general ones.",
      emotion:
        "Difficulty, loss and moral complexity are all fine here. Let characters be wrong, and let being wrong cost something.\n" +
        "The ending must still offer hope or agency. No nihilism.",
      humor:
        "Dry, character-driven and never explained. Do not talk down.",
      characterArt:
        "Naturalistic proportions and grounded costume detail. Faces should carry subtle emotion rather than broad expression.",
      calibration:
        "Nearer nine, keep the through-line single and the timeline linear. Nearer twelve, braided timelines, unreliable narration and genuine moral ambiguity all become available.",
      qualityTest:
        "Per scene: does someone want something, and is something in the way? Across the book: is every planted detail paid off, and does the ending change how the beginning reads?",
    },
    dimensions: {
      textDensity: d(6, "Three to six sentences per page."),
      sentenceComplexity: d(4, "Varied and deliberately complex."),
      illustrationDependency: d(0, "The prose carries the story."),
      repetition: d(0, "Only as a deliberate motif."),
      plotComplexity: d(5, "Layered, with real consequences."),
      castSize: d(5, "As many as the story earns."),
      dialogue: d(4, "Rich, with subtext."),
      conflict: d(4, "Significant, with lasting cost."),
      emotionalComplexity: d(3, "Nuanced and sometimes contradictory."),
      readerInference: d(5, "Much is implied rather than stated."),
      figurativeLanguage: d(4, "Used freely and precisely."),
      subplots: d(3, "Welcome when they serve the main thread."),
      interaction: d(0, "None — engagement comes from curiosity."),
      sensoryLanguage: d(0, "Whatever the scene needs."),
    },
    structure: {
      minWords: 450,
      maxWords: 900,
      beats: 9,
      maxSentenceWords: 30,
      plotRequired: true,
    },
    density: {
      targetWordsPerPage: 80,
      maxWordsPerPage: 140,
      targetSentencesPerPage: 5,
      maxFocalCharactersPerScene: 5,
      minPages: 8,
      maxPages: 16,
    },
    protagonist: {
      minAge: 10,
      maxAge: 13,
      guidance:
        "The hero should be about {{min}}–{{max}} years old, with agency over the plot and an inner life the reader can inhabit.",
    },
    defaultCharacterAgeYears: 11,
    safety: {
      avoid: ["self-harm or suicide", "substance use", "despairing or nihilistic endings"],
      note: "Difficulty, loss and moral complexity are fine at this age; the ending must still offer hope or agency.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "sentenceComplexity",
      "plotComplexity",
      "readerInference",
      "figurativeLanguage",
      "emotionalComplexity",
    ],
  },

  // The two month-level bands. They inherit the whole 0–2 brief and override
  // only what actually differs between a newborn and a walking toddler, which
  // is the point of `extendsId` — a second copy of the essay would drift.
  {
    id: "0-12m",
    label: "0–12 months",
    caption: "Baby's first book",
    description: "Sounds, faces and naming. Rhythm matters far more than plot.",
    minMonths: 0,
    maxMonths: 12,
    order: 5,
    enabled: false,
    aliases: [],
    extendsId: "0-2",
    readingModes: [],
    modes: {
      default: {
        humanGuidance: "Sounds, faces and naming — rhythm and recognition rather than story.",
        storyGuidance: "",
      },
    },
    sections: {
      storyStructure:
        "There does not need to be a plot. The strongest shapes at this age are naming sequences, sound patterns, greetings and goodnights, simple contrasts (big/small, loud/quiet, awake/asleep), and short repeating cycles.\n" +
        "If something does happen, it must be a single physical cause and effect the baby can see in the picture.",
      calibration:
        "This is the youngest band. Prioritise rhythm, sound, faces, naming, repetition, contrast and sensory language. Plot may be entirely absent, and that is a correct outcome rather than a shortfall.\n" +
        "Do not include questions the baby is expected to answer, sequences that depend on memory across several pages, or any humour that relies on knowing what is normal.",
      interaction:
        "Interaction at this age is the adult's: sounds to make, faces to pull, textures to mime, body parts to touch. Write lines the grown-up can perform, not instructions for the baby.",
    },
    dimensions: {
      textDensity: d(0, "A few words per page. Often a single sound or name."),
      plotComplexity: d(0, "No plot required at all."),
      interaction: d(5, "Almost every page offers something to do or say."),
      repetition: d(4, "Very high — the same shape, one element changing."),
      castSize: d(0, "One or two subjects in the whole book."),
      readerInference: d(0, "Nothing implied."),
      dialogue: d(0, "Single words at most."),
      conflict: d(0, "Essentially none."),
    },
    structure: {
      minWords: 20,
      maxWords: 70,
      beats: 2,
      maxSentenceWords: 6,
      plotRequired: false,
    },
    density: {
      targetWordsPerPage: 3,
      maxWordsPerPage: 7,
      targetSentencesPerPage: 1,
      maxFocalCharactersPerScene: 1,
      minPages: 8,
      maxPages: 22,
    },
    protagonist: {
      minAge: 1,
      maxAge: 3,
      guidance:
        "The main subject should read as roughly {{min}}–{{max}} years old, or a friendly animal of that emotional age.",
    },
    defaultCharacterAgeYears: 2,
    safety: {
      avoid: [
        "separation from a caregiver that is not resolved immediately",
        "loud or frightening surprises",
        "sudden darkness or characters disappearing without returning",
      ],
      note: "Every page ends safe. Nothing is left unresolved across a page turn except a friendly, immediately answered question.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "repetition",
      "interaction",
      "sensoryLanguage",
      "illustrationDependency",
      "emotionalComplexity",
    ],
  },

  {
    id: "13-24m",
    label: "13–24 months",
    caption: "First words",
    description: "Routines, tiny problems and things to find, name and copy.",
    minMonths: 13,
    maxMonths: 24,
    order: 6,
    enabled: false,
    aliases: [],
    extendsId: "0-2",
    readingModes: [],
    modes: {
      default: {
        humanGuidance: "Routines, tiny problems and lots to point at, name and copy.",
        storyGuidance: "",
      },
    },
    sections: {
      storyStructure:
        "A very simple shape is now enjoyable: a familiar routine, a short journey, a search, a tiny problem with an immediate resolution, or an accumulation that grows one item per page.\n" +
        "Keep causality physical and visible. Motivation should never need explaining.",
      calibration:
        "This band is walking, pointing and starting to talk. Add simple questions, familiar routines, predictable sequences, tiny problems and resolutions, clear cause and effect, actions to imitate, and plenty to name or find.\n" +
        "Compared with the youngest band, a small amount of anticipation across a page turn is now a pleasure rather than a confusion.",
      interaction:
        "Ask the child to point, name, find, copy an action or make a sound. A repeated question the child can answer from the picture is one of the strongest devices at this age.\n" +
        "Keep it playful. Two or three invitations across the book beat one on every page.",
    },
    dimensions: {
      textDensity: d(1, "One short sentence or phrase per page."),
      plotComplexity: d(1, "A tiny problem with an immediate resolution."),
      interaction: d(5, "Frequent naming, finding and copying."),
      repetition: d(4, "A learnable pattern with one element changing."),
      castSize: d(1, "Up to three, one clearly dominant."),
      dialogue: d(1, "Single words and greetings."),
      conflict: d(1, "A momentary wobble at most."),
    },
    structure: {
      minWords: 45,
      maxWords: 110,
      beats: 3,
      maxSentenceWords: 8,
      plotRequired: false,
    },
    density: {
      targetWordsPerPage: 6,
      maxWordsPerPage: 11,
      targetSentencesPerPage: 1,
      maxFocalCharactersPerScene: 2,
      minPages: 8,
      maxPages: 20,
    },
    protagonist: {
      minAge: 2,
      maxAge: 3,
      guidance:
        "The main character should read as roughly {{min}}–{{max}} years old so the toddler recognises themselves.",
    },
    defaultCharacterAgeYears: 2,
    safety: {
      avoid: [
        "separation from a caregiver that is not resolved immediately",
        "loud or frightening surprises",
      ],
      note: "Any wobble is resolved on the very next page. The book ends calm and safe.",
    },
    evaluatedDimensionIds: [
      "textDensity",
      "repetition",
      "interaction",
      "plotComplexity",
      "sensoryLanguage",
      "emotionalComplexity",
    ],
  },
];

/** The band used when an id resolves to nothing at all. */
export const FALLBACK_PROFILE_ID = "3-5";

export function defaultAudienceProfile(id: string): AudienceProfile | undefined {
  return DEFAULT_AUDIENCE_PROFILES.find((p) => p.id === id);
}
