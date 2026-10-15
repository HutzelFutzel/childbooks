/**
 * The contracts of the Chat's skill system.
 *
 * A skill (command) is data plus two pure functions: what it would destroy
 * (`impact`) and what it does to a book (`run`). Neither performs I/O. The
 * planner decides from those whether to apply, confirm, quote, ask or refuse;
 * the adapter (`state/guideAgent.ts`) is the only place that writes the book or
 * calls the network. That split is what lets one message combine several
 * skills, lets the server re-check a paid one, and lets the invariants run
 * every skill offline.
 */
import type { GuideCopyVars, GuideLabelKey, GuideLineKey } from "../copy";
import type { BookViewId } from "../journey";
import type { GuideMessage, StoryFitCard } from "../session";
import type { GuideEntry, Project } from "../../types";
import type { GuideTarget } from "../target";
import type { RedrawMode } from "../redrawMode";
import type { GuideCommandId } from "./ids";

export type CommandArgs = Record<string, string>;

/** One skill call, as proposed by the interpreter or made by a tap. */
export interface CommandCall {
  id: GuideCommandId;
  args: CommandArgs;
  /** The reader's own words that ask for this. Empty for taps. */
  evidence: string;
  confidence: number;
  source: "model" | "tap";
}

export type ArgKind =
  | "person"
  | "anchor"
  | "text"
  | "age"
  | "style"
  | "view"
  | "entry"
  | "language"
  | "choice";

export interface ArgSpec {
  name: string;
  kind: ArgKind;
  required: boolean;
  /** One line for the interpreter prompt. */
  hint: string;
  options?: readonly string[];
}

export type CommandArea =
  | "path"
  | "book"
  | "design"
  | "pictures"
  | "pages"
  | "story"
  | "people"
  | "places"
  | "style"
  | "generation"
  | "account"
  | "conversation";

// --- Impact ---------------------------------------------------------------------

export type ImpactLevel = "none" | "reversible" | "destructive" | "irreversible";

export const IMPACT_ORDER: Record<ImpactLevel, number> = {
  none: 0,
  reversible: 1,
  destructive: 2,
  irreversible: 3,
};

/**
 * What a skill would change that the reader might not expect. Rendered on the
 * confirmation card as trusted, localized text — never model output.
 */
export type ImpactEffect =
  | { kind: "removesPerson"; name: string; hasPortrait: boolean }
  | { kind: "storyMentions"; name: string; count: number }
  | { kind: "deletesPhoto"; name: string }
  | { kind: "replacesStory"; words: number }
  | { kind: "renamesInStory"; from: string; to: string; count: number }
  | { kind: "outdatesPortraits"; names: string[] }
  | { kind: "retiresArtwork"; names: string[]; preset: string }
  | { kind: "removesPlace"; name: string }
  | { kind: "removesPage"; page: number; hasPicture: boolean; hasWords: boolean };

export interface Impact {
  level: ImpactLevel;
  effects: ImpactEffect[];
}

export const NO_IMPACT: Impact = { level: "none", effects: [] };

// --- Requirements ---------------------------------------------------------------

export type RequirementId =
  | "notLocked"
  | "pagesStarted"
  | "hasStory"
  | "hasCast"
  | "castAges"
  | "styleChosen"
  | "portraitsDrawn"
  | "signedIn"
  | "storyIdle"
  | "bookSetup"
  | "coverWords"
  | "storyAccepted";

/** How to get past a requirement: the missing step in words, and the skill or view that does it. */
export interface Remedy {
  requirement: RequirementId;
  /** English meaning, filled into the `blocked` line as `{what}`. */
  what: string;
  command?: GuideCommandId;
  view?: BookViewId;
}

// --- Beats ----------------------------------------------------------------------

export type BeatPriority = "blocking" | "confirm" | "question" | "result" | "answer";

/**
 * One thing the guide has to say. The configured line is the meaning; the
 * composer phrases it in the persona and the chat language.
 */
export interface Beat {
  key: GuideLineKey;
  priority: BeatPriority;
  vars?: GuideCopyVars;
  /** A meaning written by the app at run time, used instead of the configured line. */
  text?: string;
  /** Words the phrased message must contain verbatim (names, numbers). */
  mustSay?: string[];
  /** The trusted one-row receipt for what changed, read from the book. */
  receipt?: string;
  /** The story check's card, shown under the message that says its headline. */
  fit?: StoryFitCard;
}

// --- Effects --------------------------------------------------------------------

/** Work the adapter performs for a skill: network, jobs, navigation, or store helpers. */
export type CommandEffect =
  | { kind: "title"; title: string }
  | { kind: "subtitle"; subtitle: string }
  | { kind: "author"; author: string }
  /** A rename reached the cover's words: write them through the store, which keeps the canvas boxes in step. */
  | { kind: "coverText"; title?: string; subtitle?: string }
  /** Settle the cover's words as the card shows them. */
  | { kind: "coverWords" }
  /** Own words: the reader said the story is done. */
  | { kind: "storyDone" }
  /** `scoped`: the reader marked a passage, so the change may only touch that. */
  | { kind: "reviseStory"; instruction: string; scoped?: boolean }
  | { kind: "draftStory" }
  | { kind: "checkStory" }
  | { kind: "portraits"; castIds: string[] }
  | { kind: "redraw"; castId: string; name: string; instruction: string; mode?: RedrawMode }
  /** Change one finished page or cover picture: the reader sees the price on the redraw card first. */
  | { kind: "redrawPage"; unitIds: string[]; instruction: string; mode?: RedrawMode }
  /** Show a page or cover on the right. Changes nothing. */
  | { kind: "goToPage"; unitId: string }
  /** Say the latest changes from the book's change log. */
  | { kind: "listChanges" }
  /** Open the order screen. The price and the buy button are there; nothing is bought here. */
  | { kind: "openOrder" }
  | { kind: "drawBook" }
  | { kind: "sparks" }
  | { kind: "signIn" }
  | { kind: "view"; view: BookViewId }
  | { kind: "entry"; entry: GuideEntry }
  | { kind: "undo" }
  /** Put back the change that was just undone. */
  | { kind: "redo" }
  /** Take a picture back to its earlier version (free; nothing is drawn). */
  | { kind: "picture"; target: GuideTarget; delta: number }
  | { kind: "skip"; fact?: string; personField?: { personId: string; field: string } }
  | { kind: "deletePhoto"; castId: string };

// --- Results --------------------------------------------------------------------

export interface AskOption {
  id: string;
  label: string;
}

export type CommandResult =
  /** A pure change to the book. `then` runs after it is saved. */
  | { kind: "write"; project: Project; beat: Beat; then?: CommandEffect; view?: BookViewId }
  | { kind: "effect"; effect: CommandEffect; beat?: Beat }
  /** Something is missing from the request itself; ask for it. */
  | { kind: "ask"; arg: string; beat: Beat; options: AskOption[] }
  | { kind: "blocked"; remedy: Remedy }
  /** Already that way. Said only when nothing else in the turn changed. */
  | { kind: "noop"; beat: Beat }
  /**
   * `say`: the reason is written for the reader ("Arthur is already in the
   * book"), so the reply gives it instead of a bare "I can't".
   */
  | { kind: "invalid"; reason: string; say?: true };

export interface CommandContext {
  now: number;
  guest: boolean;
  /** The art styles on offer, for resolving "watercolor" to an id. */
  styles: readonly {
    id: string;
    label: string;
    generationReference?: import("../../types").GenerationStyleReference;
  }[];
  /** Book languages on offer. */
  languages: readonly { id: string; label: string }[];
  /**
   * The reader marked a passage of the story for this message. Set by the app
   * from what the reader did, never by the interpreter.
   */
  marked?: boolean;
  /** The picture the reader has selected, for a skill that is about "this one". */
  chip?: GuideTarget | null;
  /**
   * The pages the reader means by "this page": the one they selected, else the
   * spread open in front of them. Set by the app from what is on screen, never
   * by the interpreter. Empty when no page is in view.
   */
  pages?: readonly string[];
  /** The reader named those pages in the sentence ('page 18'), rather than the app reading them off the screen. Set by the app. */
  pagesNamed?: boolean;
  /** Pages whose picture no longer matches the people and places it shows. Read by the app from the book, never by the interpreter. */
  stalePages?: readonly string[];
  /** Why the book is being drawn right now ("Still drawing page 3…"), when it is: set by the app from the live jobs. */
  drawingReason?: string;
  /** The admin's limits for what one message may do to the finished pages. */
  limits?: { pictureBatch: number; extrasPages: number; refreshBatch: number };
  /** The admin's extra and refused color names. */
  palette?: { colors: readonly { name: string; hex: string }[]; hidden: readonly string[] };
  /** A portrait is being drawn, which opens the Cast tab before any portrait is done. Set by the app from the running jobs. */
  portraitsRunning?: boolean;
  /** The fonts on offer for this book's language, for resolving "a serif font" to one. */
  fonts?: readonly { id: string; label: string; category?: string }[];
}

/**
 * A button on a confirmation card that runs the calls with extra args —
 * "rewrite the story without them" versus "keep the story as it is".
 */
export interface ConfirmChoice {
  label: GuideLabelKey;
  args: CommandArgs;
}

// --- Ideas ----------------------------------------------------------------------

/** How the ideas menu sorts what the chat can do. */
export const GUIDE_IDEA_GROUPS = ["check", "story", "people", "book", "help"] as const;
export type GuideIdeaGroup = (typeof GUIDE_IDEA_GROUPS)[number];

/**
 * One thing a parent could say to try a skill, as a short suggestion. Its text
 * is `guide.ideas.<id>` in the message files; a text ending in "…" is the start
 * of a sentence for the parent to finish.
 *
 * The tab it shows on comes from the skill's `area` unless `views` says
 * otherwise (an empty list shows on every tab), and it shows only while the
 * skill is on and its requirements are met, so a suggestion never leads to
 * "that needs something first".
 */
export interface CommandIdea {
  id: string;
  /** Where the menu files it. Defaults from the skill's area. */
  group?: GuideIdeaGroup;
  views?: readonly BookViewId[];
  /** A tap runs it: its result is reviewed or advisory anyway. Otherwise a tap fills the composer. */
  instant?: boolean;
  /** Acts on the passage the reader marked, so it shows only while one is marked and never runs without it. */
  marked?: boolean;
  /** Stands for this skill when the book's next step is this skill. */
  lead?: boolean;
  /** Still worth suggesting once the pages have started, when little else can change. */
  duringDrawing?: boolean;
  /**
   * Makes sense before there is a book to act on. Every other idea is about the
   * book (its size, look, story, people) and stays hidden until one exists.
   */
  beforeBook?: boolean;
  /** Null hides the idea; an object shows it with these vars. Default: always. */
  relevant?: (project: Project) => { name?: string } | null;
  /**
   * The idea is worth suggesting first right now. Returns what the suggestion
   * is about (such as the text it would read), or null. Setting it aside is
   * remembered for that state only, so a changed book can offer it again.
   */
  offer?: (project: Project, messages: readonly GuideMessage[]) => string | null;
}

export interface CommandDef {
  id: GuideCommandId;
  /**
   * The skill acts on pages the reader names ("page 18"). A sentence that names a
   * page the book does not have is answered with that, never run on another page.
   */
  aimsAtPages?: boolean;
  /** The write reshapes the page list (pages added, removed, moved or copied): the change log keeps whole-book snapshots for it. */
  structural?: boolean;
  area: CommandArea;
  /** When to use it, for the interpreter. One or two sentences. */
  summary: string;
  args: readonly ArgSpec[];
  /** Phrasings a parent might type. Prompt examples, suggestion chips and eval cases. */
  examples: readonly string[];
  /** What this does, for help answers. */
  help: string;
  requires: readonly RequirementId[];
  /**
   * What to suggest so the parent finds this skill. `false` says on purpose that
   * nothing is suggested (a button, a card or the flow already covers it), so
   * adding a skill means deciding.
   */
  suggest: readonly CommandIdea[] | false;
  /** Spends Sparks. At most one paid skill runs per message, and never without a tap. */
  paid?: boolean;
  /**
   * Several calls of this paid skill in one message are one piece of work
   * ("make Aren and Amira blonde"): they run together and are priced and
   * started as one batch, still behind the same single price and tap.
   */
  batchable?: boolean;
  /** The code's floor: this always confirms, whatever the admin saved. */
  alwaysConfirm?: boolean;
  /**
   * A write that "Undo" puts back whole. A destructive impact then needs no
   * confirmation card: the reader asked in words, and Undo is one tap. The
   * exception is a skill with `choices`, which is a question, not a safeguard.
   */
  undoable?: boolean;
  impact?: (project: Project, args: CommandArgs, ctx: CommandContext) => Impact;
  /** Buttons for the confirmation card when the impact offers a choice. */
  choices?: (project: Project, args: CommandArgs) => ConfirmChoice[] | null;
  /** Fill generated values (a new person's id) once, so the dry run and the write agree. */
  prepare?: (args: CommandArgs) => CommandArgs;
  run: (project: Project, args: CommandArgs, ctx: CommandContext) => CommandResult;
}
