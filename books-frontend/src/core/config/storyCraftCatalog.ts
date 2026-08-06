/**
 * Static catalog for how a story is drafted, per age band: the themes and
 * stylistic devices offered in the Story step, the protagonist age that lets a
 * reader identify with the hero, the structural rules a draft must satisfy, and
 * the safety line. Admin overrides live in `appConfig/storyCraft`
 * (`StoryCraftConfig`) — this file is the shipped default and the shape.
 *
 * Split of responsibility (deliberate): everything here is a *constraint* or a
 * *curated choice*. Voice, plot and imagery stay the model's job.
 */
import type { AgeBandId } from "./ageWritingCatalog";
import { AGE_RANGES } from "./options";

/** One selectable option in a per-band catalog (theme, device, setting). */
export interface StoryOption {
  id: string;
  label: string;
  /** One-line explanation shown under the chip when selected. */
  description: string;
  /** Injected into the draft prompt when chosen. */
  llmGuidance: string;
}

/** Hard constraints a draft is generated against and then checked against. */
export interface StoryStructureRules {
  /** Whole-story word bounds. */
  minWords: number;
  maxWords: number;
  /** Rough number of story beats the draft should hit. */
  beats: number;
  /** Longest sentence (in words) the band tolerates; 0 disables the check. */
  maxSentenceWords: number;
}

/** The age of the hero, so the reader can see themselves in the book. */
export interface ProtagonistRules {
  minAge: number;
  maxAge: number;
  /** Prompt sentence explaining the rule; `{{min}}`/`{{max}}` are substituted. */
  guidance: string;
}

export interface StorySafetyRules {
  /** Themes/imagery the band must never contain. */
  avoid: string[];
  /** Extra prompt sentence appended after the avoid list. */
  note: string;
}

export interface AgeBandStoryCraft {
  themes: StoryOption[];
  devices: StoryOption[];
  settings: StoryOption[];
  structure: StoryStructureRules;
  protagonist: ProtagonistRules;
  safety: StorySafetyRules;
}

const opt = (id: string, label: string, description: string, llmGuidance: string): StoryOption => ({
  id,
  label,
  description,
  llmGuidance,
});

// ---- Shared safety baseline ------------------------------------------------

const UNIVERSAL_AVOID = [
  "graphic violence or injury",
  "death of a parent or caregiver",
  "sexual content of any kind",
  "slurs, bullying framed approvingly, or cruelty played for laughs",
  "brand names, real politics, or religious instruction",
  "unresolved fear at the end of the story",
];

// ---- Per-band catalogs -----------------------------------------------------

export const DEFAULT_STORY_CRAFT: Record<AgeBandId, AgeBandStoryCraft> = {
  "0-2": {
    themes: [
      opt("bedtime", "Getting sleepy", "Winding down towards a cosy goodnight.", "A gentle wind-down towards sleep: the day ending, soft lights, a familiar bed, everyone safe."),
      opt("animals", "Animal friends", "Meeting friendly animals and their sounds.", "Friendly animals the child can name and imitate, each with a clear sound or movement."),
      opt("first-words", "Naming the world", "Pointing at everyday things and naming them.", "Naming everyday objects the toddler already knows — cup, shoe, ball, moon — one clear thing at a time."),
      opt("peekaboo", "Hide and find", "Something disappears and comes happily back.", "A simple hide-and-find rhythm: something vanishes, the toddler wonders, it returns happily."),
      opt("family", "My people", "Hugs, faces and everyday family warmth.", "The child's people — grown-ups, siblings, grandparents — shown through hugs, faces and small everyday care."),
      opt("out-and-about", "Going out", "A little trip: the park, the shops, the bus.", "A short outing (park, shops, bus) reduced to a handful of vivid, concrete moments."),
    ],
    devices: [
      opt("repetition", "Repeating refrain", "The same line returns on every page.", "Build the whole story on one repeating refrain the adult can chant and the toddler can join in on."),
      opt("sound-words", "Sounds and noises", "Splash, boom, moo — noises to copy.", "Lean on sound words (splash, moo, boom) as the spine of the text; make them fun to say aloud."),
      opt("call-response", "Question and answer", "Ask, then turn the page to find out.", "Ask a simple question on one page and answer it on the next, so the page turn is the payoff."),
      opt("counting", "Counting along", "One, two, three — a tiny counting frame.", "Structure the story as a simple count from one to five, adding one thing per page."),
    ],
    settings: [
      opt("home", "At home", "The safest, most familiar place.", "Set it entirely inside a warm, familiar home."),
      opt("garden", "The garden", "Just outside the door.", "Set it in a small garden or yard just outside the door."),
      opt("farm", "The farm", "Big friendly animals.", "Set it on a gentle farm full of big friendly animals."),
    ],
    structure: { minWords: 60, maxWords: 140, beats: 3, maxSentenceWords: 8 },
    protagonist: {
      minAge: 2,
      maxAge: 4,
      guidance:
        "The main character should read as roughly {{min}}–{{max}} years old (or a small animal of that emotional age) so the listener recognises themselves.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "separation from a caregiver that is not resolved immediately", "loud or frightening surprises"],
      note: "Any surprise must be resolved on the very next page. The book ends calm and safe.",
    },
  },

  "3-5": {
    themes: [
      opt("bedtime-adventure", "A bedtime adventure", "The imagination takes off after lights-out.", "A bedtime adventure that starts in a real bedroom, drifts into imagination, and lands safely back in bed."),
      opt("new-friend", "Making a new friend", "Someone new turns out to be lovely.", "Meeting someone new, feeling shy about it, and discovering a friendship by the end."),
      opt("brave-day", "A day of courage", "Something feels big and scary, until it isn't.", "The hero faces something that feels enormous to a small person and finds their own courage — never rescued by an adult."),
      opt("forest", "Exploring outside", "A woodland, a beach, a big adventure.", "An outdoor exploration full of things to notice, touch and name."),
      opt("mix-up", "A silly mix-up", "Everything goes gloriously wrong.", "A comic misunderstanding that escalates cheerfully and is sorted out with a laugh."),
      opt("sharing", "Learning to share", "Wanting it all, then finding something better.", "A sharing or turn-taking problem resolved by the hero's own change of heart, never by being told off."),
      opt("big-feelings", "Big feelings", "Cross, sad or jealous — and coming through it.", "Name one big feeling plainly (cross, sad, jealous), sit with it honestly, and move through it to calm."),
      opt("first-time", "The first time", "First day, first swim, first sleepover.", "A first-time milestone: the nerves beforehand, the moment itself, the pride afterwards."),
    ],
    devices: [
      opt("rhyme", "Rhyme and rhythm", "Bouncy rhyming couplets.", "Write in confident rhyming couplets with a steady beat. Never force a rhyme at the cost of sense — if a rhyme would twist the meaning, rewrite the line."),
      opt("refrain", "A repeating refrain", "One line the child will chant.", "Give the story one memorable refrain that returns at each turning point so the child can join in."),
      opt("rule-of-three", "Three tries", "It goes wrong twice, then works.", "Use the rule of three: two attempts that don't work, then a third that does."),
      opt("cumulative", "Cumulative tale", "Each page adds to the list.", "Build cumulatively — every page repeats what came before and adds one new thing."),
      opt("call-response", "Ask the reader", "The book talks to the child.", "Address the child directly with questions and invitations to point, count or shout."),
      opt("surprise-ending", "A twist at the end", "The last page flips it.", "Play the story straight, then land a gentle, delighted twist on the final page."),
    ],
    settings: [
      opt("home", "At home", "Bedroom, kitchen, garden.", "Set it in and around a warm family home."),
      opt("forest", "The woods", "Trees, animals, dappled light.", "Set it in a friendly wood full of animals and dappled light."),
      opt("seaside", "The seaside", "Sand, waves and rock pools.", "Set it at the seaside among sand, waves and rock pools."),
      opt("nursery", "Nursery or preschool", "The first small world outside home.", "Set it at nursery/preschool with a few other children and one kind grown-up."),
      opt("magical", "A magical place", "Somewhere impossible and lovely.", "Set it somewhere gently impossible — a cloud, a tiny door, a world inside a cupboard."),
    ],
    structure: { minWords: 150, maxWords: 320, beats: 5, maxSentenceWords: 16 },
    protagonist: {
      minAge: 4,
      maxAge: 6,
      guidance:
        "The hero should be about {{min}}–{{max}} years old — a touch older than the reader, which is who a preschooler wants to be.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "peril that lasts more than a page", "adults who are frightening rather than kind"],
      note: "Tension is welcome but must resolve warmly within a page or two, and the ending is unambiguously happy.",
    },
  },

  "6-8": {
    themes: [
      opt("mystery", "A small mystery", "Clues, suspects and a satisfying answer.", "A small solvable mystery: an odd event, three clues, and an answer the reader could have worked out."),
      opt("friendship", "Friendship trouble", "Falling out and finding the way back.", "A friendship that goes wrong through an honest mistake and is repaired by the hero's own effort."),
      opt("quest", "A proper quest", "Setting off to fetch, find or fix something.", "A quest with a clear goal, two obstacles, and a hero who solves the last one alone."),
      opt("school", "School life", "Playgrounds, projects and fitting in.", "School life: a project, a rivalry or a playground problem told from the child's point of view."),
      opt("animal-companion", "An animal companion", "A creature who becomes a best friend.", "A bond with an animal companion who has a real personality and wants something of its own."),
      opt("invention", "A big idea", "Building, tinkering, trying again.", "The hero invents or builds something; it fails in an interesting way before it works."),
      opt("brave-truth", "Owning up", "Telling the truth when it's hard.", "The hero makes a mistake, hides it, and finds the courage to own up — with a kind rather than punitive outcome."),
      opt("family-change", "Something's changing", "Moving house, a new sibling, a new routine.", "A change in family life handled honestly: the worry, the adjustment, and the new normal that turns out fine."),
    ],
    devices: [
      opt("humour", "Comedy", "Jokes, timing and running gags.", "Play for laughs: comic timing, a running gag, and a narrator who enjoys the joke with the reader."),
      opt("suspense", "Cliffhangers", "Each page makes you turn it.", "End most pages on a small hook or unanswered question so the reader has to turn the page."),
      opt("first-person", "First person", "Told by the hero, in their voice.", "Write in first person in the hero's own voice, with opinions, asides and a distinct way of speaking."),
      opt("dialogue", "Dialogue-led", "The characters talk it out.", "Carry the story mostly through natural dialogue, with each character sounding different."),
      opt("letters", "Letters and notes", "Told through messages back and forth.", "Tell it through letters, notes or messages between characters, with a light narrative thread between them."),
      opt("rhyme", "Rhyme and rhythm", "Rhyming couplets that swing along.", "Write in rhyming couplets with a confident metre, never bending sense to reach a rhyme."),
      opt("twist", "A twist", "The truth turns out to be different.", "Plant a fair clue early, then reveal a twist that recontextualises the story without cheating the reader."),
    ],
    settings: [
      opt("neighbourhood", "The neighbourhood", "Streets, gardens and corner shops.", "Set it in a walkable neighbourhood of streets, gardens and small shops."),
      opt("school", "School", "Classroom, corridor and playground.", "Set it across a school's classroom, corridors and playground."),
      opt("countryside", "The countryside", "Fields, woods, rivers and barns.", "Set it in open countryside — fields, woods, a river, an old barn."),
      opt("city", "The city", "Buses, markets and tall buildings.", "Set it in a busy city of buses, markets and tall buildings."),
      opt("fantasy", "Another world", "Somewhere with its own rules.", "Set it in an invented world with two or three consistent rules the story respects."),
      opt("space", "Space", "Ships, moons and strange planets.", "Set it in space — a small ship, an odd moon, one alien with a clear personality."),
    ],
    structure: { minWords: 300, maxWords: 600, beats: 7, maxSentenceWords: 22 },
    protagonist: {
      minAge: 7,
      maxAge: 9,
      guidance:
        "The hero should be about {{min}}–{{max}} years old and solve the final problem themselves; adults may help but must not fix it for them.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "genuine horror or body horror", "humiliation as a punchline"],
      note: "Real stakes and real feelings are welcome; the ending must leave the reader hopeful.",
    },
  },

  "9-12": {
    themes: [
      opt("adventure", "A real adventure", "A journey with genuine stakes.", "A journey with real stakes, a ticking clock, and consequences the hero has to live with."),
      opt("mystery", "A mystery to crack", "Clues, red herrings, a real solution.", "A layered mystery with a red herring and a solution the attentive reader could reach one page early."),
      opt("belonging", "Finding your people", "Feeling outside, then finding where you fit.", "The ache of not fitting in, and the slow discovery of where — and with whom — the hero belongs."),
      opt("identity", "Who I am", "Working out what you actually believe.", "The hero tests an inherited belief about themselves and comes out with one they chose."),
      opt("rivalry", "Rivals", "Competition that turns into respect.", "A rivalry that starts sharp and earns its way to respect without either side simply surrendering."),
      opt("secret", "A secret", "Something known that can't be told.", "The hero carries a secret; the pressure of holding it drives the plot more than the secret itself."),
      opt("courage", "Standing up", "Doing the right thing at a cost.", "The hero does the right thing when it costs them socially, and the cost is shown honestly."),
      opt("legacy", "Family history", "Something inherited from before.", "An object, story or place inherited from an older generation pulls the hero into the past."),
      opt("survival", "Against the elements", "Skill, nerve and the natural world.", "A survival situation solved through skill, observation and nerve rather than luck."),
    ],
    devices: [
      opt("first-person", "First person voice", "A narrator with real personality.", "Write in a distinctive first-person voice with wit, blind spots and opinions the reader can see past."),
      opt("dual-timeline", "Two timelines", "Now and then, braided together.", "Braid two timelines — present and past — so each reveals something the other was hiding."),
      opt("foreshadowing", "Foreshadowing", "Small clues that pay off later.", "Plant three small details early and pay every one of them off before the end."),
      opt("humour", "Dry humour", "Funny in a way tweens respect.", "Keep the humour dry and character-driven; never talk down or explain the joke."),
      opt("epistolary", "Letters and logs", "Diaries, messages, found documents.", "Tell it through diary entries, messages or found documents, with a clear through-line."),
      opt("unreliable", "An unreliable narrator", "The teller isn't quite right.", "Let the narrator misread events in a way the reader can catch, then correct honestly at the end."),
      opt("twist", "A real twist", "Fairly planted, properly earned.", "Build to a genuine twist that is fairly clued and changes the meaning of what came before."),
      opt("suspense", "Chapter hooks", "You can't stop reading.", "End each section on a hook — a revelation, a threat or a question — that compels the next page."),
    ],
    settings: [
      opt("small-town", "A small town", "Everyone knows everyone.", "Set it in a small town where everyone knows everyone and secrets are hard to keep."),
      opt("boarding-school", "A school with secrets", "Corridors, rules and rumours.", "Set it in a school with its own rules, hierarchies and rumours."),
      opt("wilderness", "The wilderness", "Mountains, forests, open water.", "Set it in demanding wilderness — mountains, deep forest or open water."),
      opt("city", "A big city", "Anonymous, electric, full of corners.", "Set it in a large city that is anonymous, electric and full of overlooked corners."),
      opt("fantasy", "A built world", "Its own history, rules and politics.", "Set it in an invented world with a consistent history and rules the plot obeys."),
      opt("future", "The near future", "Slightly ahead of now.", "Set it slightly ahead of now, changing one thing about the world and following the consequences."),
      opt("historical", "The past", "A real time, richly drawn.", "Set it in a specific historical period, grounded in concrete daily detail rather than costume."),
    ],
    structure: { minWords: 450, maxWords: 900, beats: 9, maxSentenceWords: 30 },
    protagonist: {
      minAge: 10,
      maxAge: 13,
      guidance:
        "The hero should be about {{min}}–{{max}} years old, with agency over the plot and an inner life the reader can inhabit.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "self-harm or suicide", "substance use", "despairing or nihilistic endings"],
      note: "Difficulty, loss and moral complexity are fine at this age; the ending must still offer hope or agency.",
    },
  },
};

export function defaultStoryCraft(ageRangeId: string): AgeBandStoryCraft {
  return DEFAULT_STORY_CRAFT[ageRangeId as AgeBandId] ?? DEFAULT_STORY_CRAFT["3-5"];
}

/** The three ways a story gets written in the Story step. */
export type StoryMode = "guided" | "co-write" | "own";

export interface StoryModeInfo {
  id: StoryMode;
  label: string;
  tagline: string;
  description: string;
}

export const STORY_MODES: StoryModeInfo[] = [
  {
    id: "guided",
    label: "Write it for me",
    tagline: "Most magic",
    description:
      "Tell us who it's about and pick a theme — we'll write the whole story. Perfect when you want something lovely in under a minute.",
  },
  {
    id: "co-write",
    label: "Write it together",
    tagline: "Your story, our words",
    description:
      "Give us the real people, the occasion and where it happens. We turn your details into a proper story — the one only your family could have.",
  },
  {
    id: "own",
    label: "I'll write it myself",
    tagline: "Your words, untouched",
    description:
      "Write or paste your own story. We'll check it reads right for the age you chose, and never change a word unless you ask.",
  },
];

export function storyModeInfo(mode: StoryMode): StoryModeInfo {
  return STORY_MODES.find((m) => m.id === mode) ?? STORY_MODES[0];
}

/** Human label for an age band, for prompts and summaries. */
export function ageBandLabel(ageRangeId: string): string {
  return AGE_RANGES.find((a) => a.id === ageRangeId)?.label ?? ageRangeId;
}
