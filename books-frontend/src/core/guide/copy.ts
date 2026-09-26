/**
 * The Chat's configured wording.
 *
 * Two kinds of text live here and are treated differently:
 *
 *   - **Lines** are what the guide says. The configured sentence is the meaning;
 *     in a chat language other than the configured one the model phrases it
 *     (`guideSpeak`), keeping names exactly as typed.
 *   - **Labels** are trusted controls. They never depend on model output; an
 *     admin override applies to the configured language and every other
 *     language reads the application's localization catalog.
 *
 * `{names}`, `{n}`, `{sparks}`, `{price}`, `{count}`, `{shape}`, `{min}` and
 * `{language}` are the only placeholders, filled by {@link fillGuideCopy}.
 */
import { z } from "zod";

export const GUIDE_LINE_KEYS = [
  "sparksNotice",
  "opening",
  "broadQuestion",
  "drawThem",
  "storyStarting",
  "storyReady",
  "storyFailed",
  "firstPortrait",
  "lookReady",
  "languageNote",
  "readingAgeNote",
  "missingNames",
  "missingAges",
  "missingAgesMany",
  "hardcoverSpread",
  "hardcoverShort",
  "ownWordsOpen",
  "pagesStarted",
  "pagesDone",
  "welcomeBack",
  "whichName",
  "castFix",
  "pageAttention",
  "printReady",
  "accountFirst",
  "topUp",
  "awayStory",
  "awayPortraits",
  "awayPages",
  "redrawReady",
  "reply",
  "keptStory",
  "manuscriptAsk",
] as const;

export const GUIDE_LABEL_KEYS = [
  "guideMe",
  "ownWords",
  "foundCast",
  "foundPlaces",
  "editPeople",
  "drawPortraits",
  "drawBook",
  "createIllustratedBook",
  "estimateLine",
  "tryStoryAgain",
  "redrawPage",
  "redrawTarget",
  "orderBook",
  "createAccount",
  "buyPack",
  "seeAll",
  "skip",
  "spreadIt",
  "keepShort",
  "tryAgain",
  "deletePhoto",
  "useMyStory",
  "useAsIdea",
  "reviewPeople",
] as const;

export type GuideLineKey = (typeof GUIDE_LINE_KEYS)[number];
export type GuideLabelKey = (typeof GUIDE_LABEL_KEYS)[number];
export type GuideCopyKey = GuideLineKey | GuideLabelKey;

export const DEFAULT_GUIDE_COPY: Record<GuideCopyKey, string> = {
  sparksNotice: "Image generation uses Sparks. You'll see the estimate before anything is drawn.",
  opening: "Tell me who this book is for and what you have in mind—or paste a story you've already written.",
  broadQuestion: "Who is it for, and what should happen?",
  drawThem: "I'll draw them in this look.",
  storyStarting:
    "That's everything I need—I'm drafting the story now. You can still add something while I write.",
  storyReady: "Here it is.",
  storyFailed: "The draft didn't come through. The page is as it was.",
  firstPortrait: "{names}'s ready.",
  lookReady: "This drawing now sets the look of the whole book.",
  languageNote: "I'll write the story in {language}.",
  readingAgeNote: "{names} is {n}, so I'll pitch the words at that age.",
  missingNames: "Who is the book for?",
  missingAges: "How old is {names}?",
  missingAgesMany: "How old are {names}?",
  hardcoverSpread: "I'll spread it over {count} pages, so a hardcover is possible.",
  hardcoverShort:
    "This story is too short for a hardcover. A hardcover of this size needs at least {min} pages, and stretching it would leave thin pages. I can spread it if you want one. A softcover can stay at {count}.",
  ownWordsOpen: "Write or paste your story on the page.",
  pagesStarted: "Drawing the book now. You can turn the pages while the rest arrive.",
  pagesDone: "Every page is drawn.",
  welcomeBack: "Welcome back.",
  whichName: "Which one should change?",
  castFix: "A couple of names need a quick look before I draw anyone.",
  pageAttention: "Page {n} needs another go.",
  printReady: "It's ready to print.",
  accountFirst: "Create an account first so this book is saved to you. You'll come straight back here.",
  topUp: "That needs a few more Sparks than you have.",
  awayStory: "Your story is ready.",
  awayPortraits: "{names}'s portrait finished while you were away.",
  awayPages: "{count} pages need attention.",
  redrawReady: "Got it. Tap redraw when you're ready.",
  reply: "Okay.",
  keptStory: "I'll use this as your story.",
  manuscriptAsk: "Is this the finished story, or the idea for one?",

  guideMe: "Guide me",
  ownWords: "I'll use my own words",
  foundCast: "Found {names}",
  foundPlaces: "Places: {names}",
  editPeople: "Edit people",
  drawPortraits: "Draw {names} in this look",
  drawBook: "Draw the book",
  createIllustratedBook: "Create illustrated book",
  estimateLine: "That's the price. Anything that fails to draw is free.",
  tryStoryAgain: "Try the story again",
  redrawPage: "Redraw this page",
  redrawTarget: "Redraw {names}",
  orderBook: "Order the book",
  createAccount: "Create an account",
  buyPack: "Get Sparks",
  seeAll: "See all",
  skip: "Skip",
  spreadIt: "Spread it",
  keepShort: "Keep it short",
  tryAgain: "Try again",
  deletePhoto: "Delete now",
  useMyStory: "Use my story",
  useAsIdea: "Use it as the idea",
  reviewPeople: "Review",
};

/** Keys whose text the admin may override, with a short description for the editor. */
export const GUIDE_COPY_HELP: Partial<Record<GuideCopyKey, string>> = {
  sparksNotice: "Shown once, before the opening line of a new book. Information, not approval.",
  opening: "The single opening invitation. It must support both guided ideas and pasted stories.",
  broadQuestion: "Fallback broad question for older conversations whose opening did not ask for the book.",
  drawThem: "Said when the portrait action appears.",
  storyStarting: "Said when the last fact lands and the draft is queued.",
  storyReady: "Said when the draft is on the page.",
  guideMe: "Opening choice.",
  ownWords: "Opening choice.",
  foundCast: "Receipt after own-words extraction.",
  drawBook: "The Continue button after the story.",
  estimateLine: "Under every Sparks price.",
};

export type GuideCopyOverrides = Partial<Record<GuideCopyKey, string>>;

export const guideCopySchema = z
  .record(z.string(), z.string().max(400))
  .transform((value) => normalizeGuideCopy(value));

export function normalizeGuideCopy(input: unknown): GuideCopyOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: GuideCopyOverrides = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(key in DEFAULT_GUIDE_COPY) || typeof value !== "string") continue;
    const text = value.trim().slice(0, 400);
    if (text && text !== DEFAULT_GUIDE_COPY[key as GuideCopyKey]) out[key as GuideCopyKey] = text;
  }
  return out;
}

export interface GuideCopyVars {
  names?: readonly string[] | string;
  n?: number | string;
  sparks?: string;
  price?: string;
  count?: number;
  shape?: string;
  min?: number;
  language?: string;
}

/** "Maya", "Maya and Leo", "Maya, Leo and Sam". */
export function joinGuideNames(names: readonly string[], and = "and"): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}

export function fillGuideCopy(text: string, vars: GuideCopyVars = {}): string {
  const names = Array.isArray(vars.names) ? joinGuideNames(vars.names) : (vars.names as string | undefined);
  return text.replace(/\{(names|n|sparks|price|count|shape|min|language)\}/g, (match, key: string) => {
    const value =
      key === "names" ? names : (vars as Record<string, unknown>)[key];
    return value === undefined || value === null || value === "" ? match : String(value);
  });
}

/** The configured meaning of one key, filled. */
export function guideCopy(
  overrides: GuideCopyOverrides | undefined,
  key: GuideCopyKey,
  vars?: GuideCopyVars,
): string {
  return fillGuideCopy(overrides?.[key] ?? DEFAULT_GUIDE_COPY[key], vars);
}

export function isGuideLineKey(key: string): key is GuideLineKey {
  return (GUIDE_LINE_KEYS as readonly string[]).includes(key);
}
