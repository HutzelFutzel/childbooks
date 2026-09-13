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
import { defaultAudienceProfile } from "./audienceCatalog";

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
  "graphic violence, gore, brutality, or severe injury",
  "sexual content of any kind",
  "slurs, bullying framed approvingly, or cruelty played for laughs",
  "unresolved fear at the end of the story",
];

// ---- Per-band catalogs -----------------------------------------------------

export const DEFAULT_STORY_CRAFT: Record<AgeBandId, AgeBandStoryCraft> = {
  "0-11m": {
    themes: [
      opt("closeness", "You and me", "Being held, rocked and adored.", "Build the book on physical closeness: being held, rocked, carried, kissed and adored. The feeling is safety, not story."),
      opt("faces", "Faces", "Looking at people looking back.", "Centre the book on faces looking out at the baby — smiling, surprised, sleepy, laughing. One clear face per page."),
      opt("body", "My body", "Toes, nose, hands, tummy.", "Name body parts one at a time — toes, nose, hands, tummy — in a rhythm the adult can touch along with."),
      opt("animals", "Animal sounds", "Friendly animals and the noises they make.", "Introduce one friendly animal per page with its sound, so the adult can perform it and the baby can watch."),
      opt("bedtime", "Goodnight", "A soft, slow wind-down to sleep.", "Move gently towards sleep: lights lowering, everything saying goodnight, the last page calm and still."),
      opt("sensory-discovery", "Soft, cold, loud", "Textures, temperatures and sounds.", "Build the book from sensations — soft, cold, fuzzy, loud, wet — each one attached to something the baby knows."),
    ],
    devices: [
      opt("naming-cycle", "Naming cycle", "One thing named per page.", "Structure the whole book as a naming cycle: one concrete thing per page, named plainly, with nothing else competing."),
      opt("repeated-frame", "Same line, new thing", "One sentence, one word changes.", "Use one identical sentence frame on every page and change a single concrete word inside it."),
      opt("sound-play", "Sounds to make", "Splash, boom, moo — noises to perform.", "Lean on sound words as the spine of the text and make every one of them fun for an adult to say out loud."),
      opt("contrast-pairs", "Opposites", "Big and small, loud and quiet.", "Pair opposites across facing pages — big and small, loud and quiet, awake and asleep — so each is defined by the other."),
      opt("peekaboo", "Peekaboo", "Something hides and comes straight back.", "Use a hide-and-return rhythm: something disappears and comes back on the very next page, every time."),
      opt("lullaby-rhythm", "Lullaby rhythm", "A rocking, singable beat.", "Write in a slow, rocking, singable metre that an adult can almost hum. Sound matters more than sense here."),
    ],
    settings: [
      opt("home", "At home", "The safest, most familiar place.", "Set it entirely inside a warm, familiar home."),
      opt("lap", "On a lap", "Held close at bedtime.", "Set it in the space between adult and baby — a lap, a chair, a bed — with the world only glimpsed beyond."),
      opt("bath", "Bath time", "Warm water and splashing.", "Set it at bath time: warm water, splashing, bubbles, a towel at the end."),
      opt("garden", "The garden", "Just outside the door.", "Set it in a small garden or yard just outside the door."),
      opt("gentle-outdoors", "Out in the world", "A pram walk on a soft day.", "Set it on a gentle outing — a pram walk, a park bench, leaves moving — at the baby's eye level."),
    ],
    structure: { minWords: 15, maxWords: 90, beats: 2, maxSentenceWords: 8 },
    protagonist: {
      minAge: 0,
      maxAge: 2,
      guidance:
        "The main subject should read as roughly {{min}}–{{max}} years old, or a friendly animal of that emotional age. When the customer supplies a real child's age, keep it.",
    },
    safety: {
      avoid: [
        ...UNIVERSAL_AVOID,
        "separation from a caregiver that is not resolved immediately",
        "loud or frightening surprises",
        "sudden darkness or characters disappearing without returning",
        "sustained threat of any kind",
      ],
      note: "Security dominates at this age. Every page ends safe, and nothing is left unresolved across a page turn except a friendly, immediately answered question.",
    },
  },

  "12-23m": {
    themes: [
      opt("routines", "Our day", "Getting up, eating, bath, bed.", "Follow a familiar daily routine in order — waking, dressing, eating, bath, bed — one step per page."),
      opt("animals", "Animal friends", "Meeting animals and their sounds.", "Friendly animals the toddler can name and imitate, each with a clear sound or movement of its own."),
      opt("movement", "Run, jump, stomp", "Bodies moving in every way.", "Build the book from movements the toddler can copy: running, jumping, stomping, spinning, tiptoeing, flopping down."),
      opt("autonomy", "I can do it", "Doing something all by myself.", "Let the toddler character manage something themselves — shoes, a spoon, a big step — and be visibly proud of it."),
      opt("finding-things", "Where is it?", "Something is lost and then found.", "Structure it as a search: something familiar is missing, looked for in three obvious places, and found."),
      opt("helping", "Helping out", "Carrying, tidying, passing things.", "The toddler helps with a real task — carrying, tidying, passing something — and is thanked for it."),
      opt("everyday-discovery", "Something new", "Noticing something for the first time.", "The toddler notices one ordinary thing properly for the first time: rain, a snail, a shadow, a puddle."),
    ],
    devices: [
      opt("refrain", "Repeating refrain", "The same line returns every page.", "Give the book one repeating refrain the adult can chant and the toddler can join in on."),
      opt("search-reveal", "Look and find", "Lift, look, and there it is.", "Use a look-and-find rhythm: the text wonders where something is, and the next page reveals it plainly."),
      opt("call-response", "Question and answer", "Ask, then turn the page to find out.", "Ask a simple question on one page and answer it on the next, so the page turn is the payoff."),
      opt("sound-words", "Sounds and noises", "Splash, moo, beep — noises to copy.", "Lean on sound words as the spine of the text and make them fun to say aloud."),
      opt("cumulative", "One more each time", "Each page adds another.", "Build cumulatively — each page repeats what came before and adds exactly one new thing."),
      opt("page-turn-reveal", "Turn and see", "The page turn is the surprise.", "Set up an expectation at the bottom of each page and pay it off immediately overleaf."),
      opt("tiny-counting", "Counting along", "One, two, three — no further.", "Structure it as a count from one to three or five, adding one thing per page and never going higher."),
    ],
    settings: [
      opt("home", "At home", "Kitchen, bedroom, hallway.", "Set it in and around a warm, familiar home."),
      opt("park", "The park", "Swings, grass, ducks.", "Set it at a small park with swings, grass and something to feed or watch."),
      opt("farm", "The farm", "Big friendly animals.", "Set it on a gentle farm full of big friendly animals."),
      opt("zoo", "The zoo", "Amazing animals behind glass.", "Set it at a zoo, moving from one clearly-named animal to the next."),
      opt("street", "Out on the street", "Buses, dogs, puddles, shops.", "Set it on an ordinary street walk: buses, dogs, puddles, shop windows, a lot to point at."),
      opt("bath", "Bath time", "Warm water and splashing.", "Set it at bath time: water, bubbles, toys, a warm towel at the end."),
      opt("bedroom", "The bedroom", "Pyjamas, teddy, curtains, dark.", "Set it in the bedroom at the end of the day, moving steadily towards sleep."),
    ],
    structure: { minWords: 35, maxWords: 180, beats: 3, maxSentenceWords: 12 },
    protagonist: {
      minAge: 1,
      maxAge: 3,
      guidance:
        "The main character should read as roughly {{min}}–{{max}} years old so the toddler recognises themselves. When the customer supplies a real child's age, keep it.",
    },
    safety: {
      avoid: [
        ...UNIVERSAL_AVOID,
        "separation from a caregiver that is not resolved immediately",
        "loud or frightening surprises",
      ],
      note: "Brief lost-and-search moments and frustration are fine, but reassurance follows rapidly — any wobble is resolved on the very next page and the book ends calm.",
    },
  },

  "2y": {
    themes: [
      opt("independence", "All by myself", "Insisting on doing it alone.", "The child wants to do something themselves, struggles honestly with it, and manages it in the end."),
      opt("routines", "Our day", "The shape of an ordinary day.", "Follow a familiar routine, but give it one small complication that makes the day a story rather than a list."),
      opt("friendship", "A friend", "Playing with someone else.", "Two characters play together, hit one small snag over sharing or taking turns, and sort it out themselves."),
      opt("helping", "Helping out", "Being genuinely useful.", "The child helps with something that actually matters, and the help visibly changes the outcome."),
      opt("lost-and-found", "Lost and found", "Something precious goes missing.", "Something loved goes missing. Search it out through three recurring encounters and find it, with real relief at the end."),
      opt("animal-adventure", "An animal adventure", "Off into the world with an animal.", "Send the child and one animal companion on a small journey with recurring encounters along the way."),
      opt("small-fears", "A bit scary", "Something big, dark or loud.", "Face one manageable fear — the dark, a loud noise, a big animal — stylised clearly and resolved securely."),
      opt("new-experiences", "The first time", "Somewhere never been before.", "Take the child somewhere new for the first time: the nerves beforehand, the discovery, the pride afterwards."),
      opt("bedtime", "Getting sleepy", "Winding down to a cosy goodnight.", "A wind-down towards sleep: the day ending, soft lights, a familiar bed, everyone safe."),
    ],
    devices: [
      opt("refrain", "Repeating refrain", "One line the child will chant.", "Give the story one memorable refrain that returns at each turning point so the child can join in."),
      opt("cumulative-encounters", "Meeting one after another", "Each page brings someone new.", "Build the story from recurring encounters: the same exchange with a new character each time, accumulating as it goes."),
      opt("rule-of-three", "Three tries", "It goes wrong twice, then works.", "Use the rule of three: two attempts that do not work, then a third that does."),
      opt("rhythmic-rhyme", "Rhyme and rhythm", "A bouncy, confident beat.", "Write in confident rhyme with a steady beat. Never twist meaning to reach a rhyme — rewrite the line instead."),
      opt("sound-play", "Sounds and noises", "Splash, crunch, boom.", "Thread sound words through the story so there is something to perform on nearly every page."),
      opt("circular-return", "Back where we started", "Ending where it began.", "End the story back where it started, changed only by what happened in between."),
      opt("page-turn-reveal", "Turn and see", "The page turn is the surprise.", "Use the page turn deliberately: set up anticipation, then pay it off overleaf."),
    ],
    settings: [
      opt("home", "At home", "Bedroom, kitchen, garden.", "Set it in and around a warm family home."),
      opt("garden", "The garden", "Just outside the door.", "Set it in a garden or yard, small enough to know and full of things to find."),
      opt("woods", "The woods", "Trees, animals, dappled light.", "Set it in a friendly wood full of animals and dappled light."),
      opt("farm", "The farm", "Big friendly animals.", "Set it on a gentle farm full of big friendly animals with jobs of their own."),
      opt("seaside", "The seaside", "Sand, waves and rock pools.", "Set it at the seaside among sand, waves and rock pools."),
      opt("neighbourhood", "Our street", "Shops, neighbours, the bus.", "Set it on a familiar street of shops, neighbours and short journeys."),
      opt("one-rule-magic", "A magical place", "Impossible, with one clear rule.", "Set it somewhere gently impossible that obeys exactly one magical rule, stated plainly and never broken."),
    ],
    structure: { minWords: 90, maxWords: 750, beats: 5, maxSentenceWords: 22 },
    protagonist: {
      minAge: 2,
      maxAge: 4,
      guidance:
        "The main character should read as roughly {{min}}–{{max}} years old, or an animal of that emotional age. When the customer supplies a real child's age, preserve it and calibrate the situations around that child.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "threat that is not securely resolved by the ending"],
      note: "Mild fear, hungry animals, storms, things breaking and getting briefly lost can all work when strongly stylised and securely resolved. Two-year-old accessible does not mean nothing scary may happen.",
    },
  },

  "3y": {
    themes: [
      opt("friendship", "Making a friend", "Someone new turns out to be lovely.", "Meeting someone new, feeling shy about it, and discovering a friendship by the end."),
      opt("courage", "Being brave", "Something feels huge, until it isn't.", "The hero faces something that feels enormous to a small person and finds their own courage — never rescued by an adult."),
      opt("curiosity", "What's in there?", "Following a question all the way.", "The hero wonders about one thing and follows the question through the whole book until they find out."),
      opt("feelings", "Big feelings", "Cross, sad or jealous — and through it.", "Name one big feeling plainly, sit with it honestly, and move through it to calm."),
      opt("first-time", "The first time", "First day, first swim, first sleepover.", "A first-time milestone: the nerves beforehand, the moment itself, the pride afterwards."),
      opt("fairness", "That's not fair", "Working out what's fair.", "A fairness problem the hero cares about intensely, resolved by their own change of heart rather than a telling-off."),
      opt("persistence", "Trying again", "It doesn't work, and then it does.", "The hero wants something that keeps not working. Let the attempts escalate and the success be earned."),
      opt("mistakes", "Oops", "Getting it wrong and putting it right.", "The hero makes an honest mistake, feels it, and does something concrete to put it right."),
      opt("imagination", "Let's pretend", "Ordinary things become an adventure.", "Ordinary surroundings become an imagined adventure, with a clear moment of stepping in and stepping back out."),
    ],
    devices: [
      opt("rule-of-three", "Three tries", "It goes wrong twice, then works.", "Use the rule of three: two attempts that do not work, then a third that does."),
      opt("refrain", "A repeating refrain", "One line the child will chant.", "Give the story one memorable refrain that returns at each turning point so the child can join in."),
      opt("rhyme", "Rhyme and rhythm", "Bouncy rhyming couplets.", "Write in confident rhyming couplets with a steady beat. Never force a rhyme at the cost of sense."),
      opt("cumulative", "Cumulative tale", "Each page adds to the list.", "Build cumulatively — every page repeats what came before and adds one new thing."),
      opt("direct-address", "Ask the reader", "The book talks to the child.", "Address the child directly with questions and invitations to point, count or shout out."),
      opt("surprise-ending", "A twist at the end", "The last page flips it.", "Play the story straight, then land a gentle, delighted twist on the final page."),
      opt("running-visual-gag", "A running joke in the pictures", "Something silly keeps happening behind them.", "Run one visual gag through the background of the whole book, never mentioned in the text."),
    ],
    settings: [
      opt("preschool", "Preschool", "The first small world outside home.", "Set it at preschool or nursery with a few other children and one kind grown-up."),
      opt("home", "At home", "Bedroom, kitchen, garden.", "Set it in and around a warm family home."),
      opt("playground", "The playground", "Slides, swings, other children.", "Set it at a playground where the equipment and the other children both shape what happens."),
      opt("woods", "The woods", "Trees, animals, dappled light.", "Set it in a friendly wood full of animals and dappled light."),
      opt("farm", "The farm", "Animals with jobs to do.", "Set it on a working farm where the animals have their own routines."),
      opt("seaside", "The seaside", "Sand, waves and rock pools.", "Set it at the seaside among sand, waves and rock pools."),
      opt("town", "The town", "Shops, buses, busy pavements.", "Set it in a small town of shops, buses and busy pavements."),
      opt("magical", "A magical place", "Somewhere impossible and lovely.", "Set it somewhere gently impossible — a cloud, a tiny door, a world inside a cupboard — with rules it keeps."),
    ],
    structure: { minWords: 180, maxWords: 850, beats: 6, maxSentenceWords: 24 },
    protagonist: {
      minAge: 3,
      maxAge: 5,
      guidance:
        "The hero should be about {{min}}–{{max}} years old — a touch older than the listener, which is who a three-year-old wants to be. When the customer supplies a real child's age, preserve it.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "danger or distress that is left without visible recovery"],
      note: "Several beats of danger or social and emotional tension are acceptable, provided the recovery is visible and the ending is secure.",
    },
  },

  "4-5": {
    themes: [
      opt("friendship", "Friendship", "Finding, keeping and mending a friendship.", "A friendship story with a real snag in the middle that the hero has to do something about."),
      opt("belonging", "Fitting in", "Feeling outside, then finding a place.", "The hero feels outside something and finds their way in without having to stop being themselves."),
      opt("courage", "Being brave", "Doing the frightening thing anyway.", "The hero does the frightening thing themselves. Show the fear honestly before the courage."),
      opt("fairness", "That's not fair", "Injustice, and doing something about it.", "Something genuinely unfair happens and the hero acts on it rather than waiting to be rescued."),
      opt("mistakes-repair", "Putting it right", "Breaking something and mending it.", "The hero causes a real problem, feels the weight of it, and repairs it through their own effort."),
      opt("persistence", "Trying again", "Failing better each time.", "Escalating attempts at one goal, each failure teaching something the next attempt uses."),
      opt("jealousy", "Wanting what they have", "Envy, honestly handled.", "Let the hero be genuinely jealous, behave a little badly because of it, and find their way back."),
      opt("family-change", "Something's changing", "A new sibling, a move, a new routine.", "A change in family life handled honestly: the worry, the adjustment, the new normal that turns out fine."),
      opt("invention", "A big idea", "Building, tinkering, trying again.", "The hero invents or builds something. It fails in an interesting way before it works."),
      opt("mystery-lite", "A small mystery", "Something odd, and an answer.", "A small solvable puzzle: one odd thing, two or three fair clues, and an answer the child could reach."),
    ],
    devices: [
      opt("rule-of-three", "Three tries", "It goes wrong twice, then works.", "Use the rule of three: two attempts that do not work, then a third that does."),
      opt("running-gag", "A running joke", "The same joke, funnier each time.", "Run one joke through the book, escalating each time it returns, and pay it off at the end."),
      opt("refrain", "A repeating refrain", "One line the child will chant.", "Give the story one memorable refrain that returns at each turning point so the child can join in."),
      opt("dialogue-led", "Dialogue-led", "The characters talk it out.", "Carry the story mostly through natural dialogue, with each character sounding distinctly different."),
      opt("first-person", "First person", "Told by the hero, in their voice.", "Write in first person in the hero's own voice, with opinions, asides and a distinct way of speaking."),
      opt("direct-address", "Ask the reader", "The book talks to the child.", "Build direct address into the concept itself, so the reader is part of the plot rather than merely questioned."),
      opt("fair-twist", "A fair twist", "Clued early, surprising anyway.", "Plant a fair clue early, then reveal a twist that recontextualises the story without cheating the reader."),
      opt("visual-irony", "The pictures know better", "The words say one thing, the art another.", "Let the illustrations contradict the narrator, so the child is in on a joke the text does not admit to."),
      opt("controlled-rhyme", "Rhyme and rhythm", "Rhyming couplets that swing along.", "Write in confident rhyming couplets with a steady metre, never bending sense to reach a rhyme."),
    ],
    settings: [
      opt("kindergarten", "School or kindergarten", "The first big social world.", "Set it at kindergarten or the first year of school, with a class, a routine and one kind grown-up."),
      opt("neighbourhood", "The neighbourhood", "Streets, gardens and corner shops.", "Set it in a walkable neighbourhood of streets, gardens and small shops."),
      opt("museum", "A museum", "Big halls full of astonishing things.", "Set it in a museum where one exhibit matters more than all the others."),
      opt("woods", "The woods", "Trees, animals, dappled light.", "Set it in a friendly wood full of animals and dappled light."),
      opt("transport", "On the move", "Trains, boats, buses, bikes.", "Set it in transit — a train, a boat, a long bus ride — where the journey shapes the story."),
      opt("space", "Space", "Ships, moons and strange planets.", "Set it in space: a small ship, an odd moon, one alien with a clear personality."),
      opt("simple-fantasy", "A world with simple rules", "Impossible, but consistent.", "Set it in an invented world with two or three consistent rules the story always respects."),
    ],
    structure: { minWords: 250, maxWords: 1000, beats: 7, maxSentenceWords: 28 },
    protagonist: {
      minAge: 4,
      maxAge: 7,
      guidance:
        "The hero should be about {{min}}–{{max}} years old, with a decision that changes the outcome. When the customer supplies a real child's age or identity, preserve it and calibrate agency around that child.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "sustained terror", "cruelty presented as normal"],
      note: "Genuine conflict, jealousy, anger, fear and failure are healthy story material at this age. Avoid sustained terror and cruelty — not uncomfortable emotions.",
    },
  },

  "6-7": {
    themes: [
      opt("friendship", "Friendship trouble", "Falling out and finding the way back.", "A friendship that goes wrong through an honest mistake and is repaired by the hero's own effort."),
      opt("school", "School life", "Playgrounds, projects and fitting in.", "School life: a project, a rivalry or a playground problem told from the child's point of view."),
      opt("fairness", "That's not fair", "Injustice worth acting on.", "Something genuinely unfair happens and the hero decides to do something about it, at some cost."),
      opt("competence", "Getting good at something", "Practice, failure and progress.", "The hero wants to be good at one specific thing. Show the practice and the plateau, not only the triumph."),
      opt("honesty", "Owning up", "Telling the truth when it's hard.", "The hero makes a mistake, hides it, and finds the courage to own up — with a kind rather than punitive outcome."),
      opt("responsibility", "Looking after something", "Being trusted with something that matters.", "The hero is trusted with something that matters and has to live with how well they look after it."),
      opt("invention", "A big idea", "Building, tinkering, trying again.", "The hero invents or builds something; it fails in an interesting way before it works."),
      opt("teamwork", "Together", "Nobody can do it alone.", "Set a goal no one character can reach alone, so the hero has to work out who is good at what."),
      opt("mystery", "A small mystery", "Clues, suspects and a satisfying answer.", "A small solvable mystery: an odd event, three fair clues, and an answer the reader could have worked out."),
      opt("quest", "A proper quest", "Setting off to fetch, find or fix something.", "A quest with a clear goal, two real obstacles, and a hero who solves the last one alone."),
      opt("animals", "An animal companion", "A creature who becomes a best friend.", "A bond with an animal companion who has a real personality and wants something of its own."),
    ],
    devices: [
      opt("dialogue-led", "Dialogue-led", "The characters talk it out.", "Carry the story mostly through natural dialogue, with each character sounding different."),
      opt("clues", "Clues to piece together", "The reader can solve it too.", "Plant clues the reader can assemble ahead of the hero, and never resolve the plot with information they never had."),
      opt("running-gag", "A running joke", "The same joke, funnier each time.", "Run one joke through the book, escalating each time it returns, and pay it off at the end."),
      opt("first-person", "First person", "Told by the hero, in their voice.", "Write in first person in the hero's own voice, with opinions, asides and a distinct way of speaking."),
      opt("diary-messages", "Notes and messages", "Told partly through what they write.", "Weave in notes, lists or messages between characters alongside the narrative thread."),
      opt("fair-twist", "A twist", "The truth turns out different.", "Plant a fair clue early, then reveal a twist that recontextualises the story without cheating the reader."),
      opt("foreshadowing", "Small hints", "Details that matter later.", "Plant two or three small details early and pay every one of them off before the end."),
      opt("chapter-hooks", "Cliffhangers", "Each section makes you read on.", "End each section on a hook — a discovery, a threat or an unanswered question — that compels the next page."),
    ],
    settings: [
      opt("school", "School", "Classroom, corridor and playground.", "Set it across a school's classroom, corridors and playground."),
      opt("neighbourhood", "The neighbourhood", "Streets, gardens and corner shops.", "Set it in a walkable neighbourhood of streets, gardens and small shops."),
      opt("library", "The library", "Quiet rooms full of possibility.", "Set it in a library, where the building itself and what is in it both matter to the plot."),
      opt("camp", "Camp", "Away from home with other children.", "Set it at a camp or on a school trip: away from home, new rules, unfamiliar company."),
      opt("forest", "The forest", "Deep woods with their own logic.", "Set it in deep forest, big enough to get properly lost in."),
      opt("castle", "A castle", "Towers, passages and old secrets.", "Set it in a castle whose age, layout and secrets shape what can happen."),
      opt("space-station", "A space station", "Corridors, airlocks and a long way from home.", "Set it on a space station: confined, technical, and a very long way from help."),
      opt("simple-fantasy", "A fantasy world", "Its own rules, kept consistently.", "Set it in an invented world with a few consistent rules the story always obeys."),
    ],
    structure: { minWords: 450, maxWords: 1500, beats: 8, maxSentenceWords: 30 },
    protagonist: {
      minAge: 6,
      maxAge: 9,
      guidance:
        "The hero should be about {{min}}–{{max}} years old and solve the final problem themselves; adults may help but must not fix it for them. When the customer supplies a real child's age, preserve it.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "genuine horror or body horror", "humiliation as a punchline"],
      note: "Real failure, embarrassment, injustice and suspense are fine. The resolution should restore hope rather than erase every consequence.",
    },
  },

  "8-9": {
    themes: [
      opt("belonging", "Finding your people", "Feeling outside, then finding where you fit.", "The ache of not fitting in, and the slow discovery of where — and with whom — the hero belongs."),
      opt("loyalty", "Whose side are you on?", "Friendship tested by a real choice.", "Put the hero's loyalty under genuine pressure, so choosing one person costs them another."),
      opt("rivalry", "Rivals", "Competition that turns into respect.", "A rivalry that starts sharp and earns its way to respect without either side simply surrendering."),
      opt("confidence", "Believing you can", "Self-doubt, and working past it.", "The hero's real obstacle is their own self-doubt; the external plot exists to make that visible."),
      opt("responsibility", "It's on me", "Consequences that can't be handed off.", "Give the hero a responsibility they cannot pass to an adult, and let the consequences land."),
      opt("mystery", "A mystery to crack", "Clues, red herrings, a real solution.", "A layered mystery with one red herring and a solution the attentive reader could reach a page early."),
      opt("adventure", "A real adventure", "A journey with genuine stakes.", "A journey with real stakes, a ticking clock, and consequences the hero has to live with."),
      opt("justice", "Standing up", "Doing the right thing at a cost.", "The hero does the right thing when it costs them socially, and the cost is shown honestly."),
      opt("discovery", "Finding something out", "A secret, a place, a truth.", "The hero uncovers something genuinely hidden, and has to decide what to do with it."),
      opt("family-change", "Something's changing", "Moving, separation, a new arrangement.", "A significant change in family life handled honestly, without tidying away the difficult parts."),
      opt("survival-lite", "Out of your depth", "Skill and nerve, not luck.", "Put the hero somewhere genuinely demanding and let them get out through observation and skill rather than luck."),
    ],
    devices: [
      opt("suspense", "Suspense", "You can't stop reading.", "Withhold one specific piece of information and let the reader feel its absence on every page."),
      opt("fair-twist", "A real twist", "Fairly planted, properly earned.", "Build to a genuine twist that is fairly clued and changes the meaning of what came before."),
      opt("foreshadowing", "Foreshadowing", "Small clues that pay off later.", "Plant three small details early and pay every one of them off before the end."),
      opt("chapter-hooks", "Chapter hooks", "Each section demands the next.", "End each section on a revelation, a threat or a question that compels the next page."),
      opt("first-person", "First person voice", "A narrator with real personality.", "Write in a distinctive first-person voice with wit, blind spots and opinions the reader can see past."),
      opt("diary-messages", "Letters and logs", "Diaries, messages, found documents.", "Tell part of it through diary entries, messages or found documents, with a clear through-line."),
      opt("dramatic-irony", "The reader knows more", "We can see it coming; they can't.", "Let the reader know something a character does not, and mine the gap for tension or comedy."),
      opt("dual-pov", "Two points of view", "The same events, two heads.", "Alternate between two viewpoints so each one reveals something the other could not see."),
    ],
    settings: [
      opt("school", "School", "Classroom, corridor and playground.", "Set it across a school whose rules, hierarchies and rumours matter to the plot."),
      opt("town", "A town", "Streets, shops, everyone half-known.", "Set it in a town large enough for strangers and small enough for word to travel."),
      opt("wilderness", "The wilderness", "Mountains, forests, open water.", "Set it in demanding wilderness — mountains, deep forest or open water."),
      opt("expedition", "An expedition", "A team, a goal, a long way out.", "Set it on an expedition with a stated objective, a fixed team and no easy way to turn back."),
      opt("historical", "The past", "A real time, richly drawn.", "Set it in a specific historical period, grounded in concrete daily detail rather than costume."),
      opt("fantasy", "A built world", "Its own history, rules and politics.", "Set it in an invented world with a consistent history and rules the plot obeys."),
      opt("space", "Space", "Ships, stations and strange planets.", "Set it in space, where distance and dependence on equipment shape every decision."),
    ],
    structure: { minWords: 700, maxWords: 2200, beats: 9, maxSentenceWords: 34 },
    protagonist: {
      minAge: 8,
      maxAge: 11,
      guidance:
        "The hero should be about {{min}}–{{max}} years old, with real agency and consequences they have to live with. When the customer supplies a real child's age, preserve it.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "self-harm or suicide", "substance use", "humiliation as a punchline"],
      note: "Grief, exclusion, family change, serious mistakes and meaningful consequences can all appear, and the ending may leave some issues open.",
    },
  },

  "10-12": {
    themes: [
      opt("identity", "Who I am", "Working out what you actually believe.", "The hero tests an inherited belief about themselves and comes out with one they chose."),
      opt("loyalty", "Whose side are you on?", "Friendship tested by a real choice.", "Put loyalty under genuine pressure, so every choice costs the hero something real."),
      opt("moral-choice", "The right thing", "No option is clean.", "Give the hero a decision with no clean answer, and let them live with what they pick."),
      opt("injustice", "This is wrong", "Confronting something bigger than you.", "The hero confronts an injustice larger than themselves and cannot fix all of it."),
      opt("grief-change", "Loss", "Something is gone and stays gone.", "Handle loss or a permanent change honestly. Do not resolve grief; show the hero learning to carry it."),
      opt("ambition", "Wanting it badly", "Drive, and what it costs.", "The hero wants something intensely, and the story examines what wanting it that much costs them."),
      opt("rivalry", "Rivals", "Competition that turns into respect.", "A rivalry that starts sharp and earns its way to respect without either side simply surrendering."),
      opt("responsibility", "It's on me", "Consequences that can't be handed off.", "The hero takes on something they cannot hand back, and the story holds them to it."),
      opt("family-tension", "At home", "Love and friction in the same house.", "Write family relationships with real friction in them, where affection and frustration coexist."),
      opt("mystery", "A mystery to crack", "Clues, red herrings, a real solution.", "A layered mystery with red herrings and a solution the attentive reader could reach a page early."),
      opt("survival", "Against the elements", "Skill, nerve and the natural world.", "A survival situation solved through skill, observation and nerve rather than luck."),
      opt("legacy", "What came before", "Something inherited from another generation.", "An object, story or place inherited from an older generation pulls the hero into the past."),
    ],
    devices: [
      opt("foreshadowing", "Foreshadowing", "Small clues that pay off later.", "Plant three small details early and pay every one of them off before the end."),
      opt("multiple-pov", "Several points of view", "More than one head to be in.", "Rotate between viewpoints so each reveals what the others cannot see, and give each a distinct voice."),
      opt("epistolary", "Letters and logs", "Diaries, messages, found documents.", "Tell it through diary entries, messages or found documents, with a clear through-line."),
      opt("dramatic-irony", "The reader knows more", "We can see it coming; they can't.", "Let the reader know something a character does not, and sustain the gap long enough to matter."),
      opt("chapter-hooks", "Chapter hooks", "You can't stop reading.", "End each section on a revelation, a threat or a question that compels the next page."),
      opt("fair-twist", "A real twist", "Fairly planted, properly earned.", "Build to a genuine twist that is fairly clued and changes the meaning of what came before."),
      opt("parallel-threads", "Two threads", "Separate stories that converge.", "Run two threads that appear unrelated and converge meaningfully in the final act."),
      opt("dual-timeline", "Two timelines", "Now and then, braided together.", "Braid two timelines — present and past — so each reveals something the other was hiding."),
      opt("unreliable", "An unreliable narrator", "The teller isn't quite right.", "Let the narrator misread events in a way the reader can catch, then correct honestly at the end. Keep the unreliability limited and fair."),
    ],
    settings: [
      opt("school-community", "School and community", "Rules, hierarchies and rumours.", "Set it across a school and the community around it, where reputation travels faster than truth."),
      opt("small-town", "A small town", "Everyone knows everyone.", "Set it in a small town where everyone knows everyone and secrets are hard to keep."),
      opt("wilderness", "The wilderness", "Mountains, forests, open water.", "Set it in demanding wilderness — mountains, deep forest or open water."),
      opt("historical", "A historical period", "A real time, richly drawn.", "Set it in a specific historical period, grounded in concrete daily detail rather than costume."),
      opt("detailed-fantasy", "A built world", "History, rules and politics of its own.", "Set it in an invented world with a consistent history, economy and politics the plot obeys."),
      opt("near-future", "The near future", "Slightly ahead of now.", "Set it slightly ahead of now: change one thing about the world and follow the consequences honestly."),
      opt("space", "Space", "Ships, stations and the long dark.", "Set it in space, where distance, dependence and isolation shape every decision."),
    ],
    structure: { minWords: 1000, maxWords: 3000, beats: 10, maxSentenceWords: 40 },
    protagonist: {
      minAge: 10,
      maxAge: 13,
      guidance:
        "The hero should be about {{min}}–{{max}} years old, with agency over the plot and an inner life the reader can inhabit. When the customer supplies a real child's age, preserve it.",
    },
    safety: {
      avoid: [...UNIVERSAL_AVOID, "self-harm or suicide", "substance use"],
      note: "Difficult emotions, grief, moral ambiguity, injustice and bittersweet outcomes are all allowed. Do not force an artificially happy ending beyond the mandatory safety floor.",
    },
  },

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

/**
 * Rules are supplied by the resolved audience profile at prompt time. These
 * placeholders keep the legacy Story Craft shape usable in UI code while an
 * admin-created band has not had its choice lists configured yet.
 */
const UNCONFIGURED_STORY_CRAFT: AgeBandStoryCraft = {
  themes: [],
  devices: [],
  settings: [],
  structure: { minWords: 10, maxWords: 20_000, beats: 1, maxSentenceWords: 0 },
  protagonist: {
    minAge: 0,
    maxAge: 30,
    guidance: "",
  },
  safety: {
    avoid: [...UNIVERSAL_AVOID],
    note: "",
  },
};

export function hasDefaultStoryCraft(ageRangeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULT_STORY_CRAFT, ageRangeId);
}

export function defaultStoryCraft(ageRangeId: string): AgeBandStoryCraft {
  return DEFAULT_STORY_CRAFT[ageRangeId as AgeBandId] ?? UNCONFIGURED_STORY_CRAFT;
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
    label: "Create with AI",
    tagline: "Full AI magic",
    description:
      "Tell us who it's about and pick a theme — we'll write the whole story. Perfect when you want something lovely in under a minute.",
  },
  {
    id: "co-write",
    label: "Guided by details",
    tagline: "Your details, AI words",
    description:
      "Give us the real people, the occasion and where it happens. We turn your details into a proper story — the one only your family could have.",
  },
  {
    id: "own",
    label: "My own words",
    tagline: "Your words, untouched",
    description:
      "Write or paste your own story. We'll check it reads right for the age you chose, and never change a word unless you ask.",
  },
];

export function storyModeInfo(mode: StoryMode): StoryModeInfo {
  return STORY_MODES.find((m) => m.id === mode) ?? STORY_MODES[0];
}

/**
 * Human label for an age band, for prompts and summaries.
 *
 * Reads the shipped profiles rather than the enabled-only `AGE_RANGES`, so a
 * band that has since been switched off still names itself in an old book's
 * summary. Callers with the live config should prefer `audienceLabel`, which
 * honours admin renames.
 */
export function ageBandLabel(ageRangeId: string): string {
  return defaultAudienceProfile(ageRangeId)?.label ?? ageRangeId;
}
