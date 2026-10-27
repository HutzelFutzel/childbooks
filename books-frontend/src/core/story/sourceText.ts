/**
 * The reader's own words about the story, kept next to the structured brief.
 *
 * The guide turns what a parent says into claims, and a claim can fail in many
 * quiet ways: it was never made, its quotation did not match, a second claim
 * for the same slot won. The draft is written from the saved brief alone, so a
 * fact that is not saved is a fact the story never hears. Keeping the words
 * themselves is the one copy that cannot be lost to a misreading: the writer
 * reads them as a source of facts, and the structured fields stay what the
 * pictures, the cast and the checks are built from.
 */
import { nameRegExp } from "../guide/agent/resolve";
import { isBareGoAhead } from "../guide/goAhead";
import { isKinWord } from "../guide/kinship";
import type { StoryBrief } from "../types";
import { namedCast, wordCount } from "./brief";

/** Longest the kept words may be in total (the brief's wire limit). */
export const SOURCE_TEXT_MAX = 4000;
/** Longest one message may add. */
export const SOURCE_NOTE_MAX = 1500;
/** Fewer words than this are an answer ("Aren is 2"), not a telling. */
export const SOURCE_NOTE_MIN_WORDS = 8;

const SEPARATOR = "\n\n";

/** Whether a message tells something about the story, rather than answering a question or giving a go-ahead. */
export function isStoryTelling(message: string): boolean {
  const text = message.trim();
  if (!text || isBareGoAhead(text)) return false;
  return wordCount(text) >= SOURCE_NOTE_MIN_WORDS;
}

/** Words that say how someone looks or what they are like: a short message with one is a fact worth keeping. */
const DESCRIBES =
  /\b(wears?|wearing|has|have|had|hair|eyes|cap|hat|glasses|dress|shirt|beard|trägt|tragen|hat|haare|augen|mütze|muetze|brille|bart|loves?|likes?|hates?|afraid|scared|liebt|mag|hasst|angst)\b/iu;

/** Words that say how two people are connected: a short message with one is a fact worth keeping. */
const RELATES =
  /\b(friends?|best|neighbou?rs?|cousins?|brothers?|sisters?|twins?|sons?|daughters?|freunde?|freundin|nachbar(?:in)?|bruder|schwester|zwillinge?|sohn|tochter|pets?|dog|cat|hund|katze)\b/iu;

/**
 * Whether a message is worth keeping in the reader's words: a telling, or a short
 * fact about somebody ("Papa wears a gray cap", "Luca is Aren's best friend").
 * Bare answers ("yes", "ok", "2") and go-aheads are not: whatever they decided is
 * in the book already, and kept as notes they would only be noise to the writer.
 */
export function isKeepable(message: string): boolean {
  const text = message.trim();
  if (!text || isBareGoAhead(text)) return false;
  if (isStoryTelling(text)) return true;
  if (wordCount(text) < 3) return false;
  return (
    /\d/.test(text) ||
    DESCRIBES.test(text) ||
    RELATES.test(text) ||
    text.split(/\s+/).some((word) => word.length >= 3 && isKinWord(word.replace(/[^\p{L}]/gu, "")))
  );
}

function clean(message: string): string {
  return message.replace(/\s+/gu, " ").trim().slice(0, SOURCE_NOTE_MAX);
}

/** The kept notes, oldest first. */
export function sourceNotes(brief: Pick<StoryBrief, "sourceText">): string[] {
  return (brief.sourceText ?? "")
    .split(SEPARATOR)
    .map((note) => note.trim())
    .filter(Boolean);
}

function namesIn(brief: StoryBrief): string[] {
  return namedCast(brief).flatMap((member) => [member.name.trim(), ...(member.aliases ?? [])]).filter(Boolean);
}

function mentions(note: string, name: string): boolean {
  return nameRegExp(name).test(note);
}

/** A note cut down to the sentences that name somebody in the book. */
function condense(note: string, names: readonly string[]): string {
  return note
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => names.some((name) => mentions(sentence, name)))
    .join(" ");
}

/**
 * Notes brought under the limit without losing anyone. The oldest note goes first,
 * but never the only one that mentions somebody in the book: that one is cut down
 * to the sentences naming them instead, and only dropped when there is nothing left
 * to keep.
 */
function fit(notes: string[], names: readonly string[]): string[] {
  const out = [...notes];
  const total = () => out.join(SEPARATOR).length;
  while (out.length > 1 && total() > SOURCE_TEXT_MAX) {
    const removable = out.findIndex((note, index) =>
      names.every((name) => !mentions(note, name) || out.some((other, at) => at !== index && mentions(other, name))),
    );
    if (removable >= 0) {
      out.splice(removable, 1);
      continue;
    }
    const condensed = condense(out[0]!, names);
    if (condensed && condensed.length < out[0]!.length) out[0] = condensed;
    else out.shift();
  }
  return out;
}

/**
 * The brief with a message added to the words kept. A message already kept is
 * not added twice; when the total outgrows the limit, the oldest notes go first,
 * except where one is the only place somebody in the book is mentioned.
 */
export function withSourceText(brief: StoryBrief, message: string): StoryBrief {
  if (brief.mode === "own" || !isKeepable(message)) return brief;
  const note = clean(message);
  const notes = sourceNotes(brief);
  if (notes.includes(note)) return brief;
  notes.push(note);
  const kept = fit(notes, namesIn(brief));
  return { ...brief, sourceText: kept.join(SEPARATOR).slice(0, SOURCE_TEXT_MAX) };
}

/**
 * The kept words as the draft prompt reads them. Angle brackets are removed so
 * nothing in a parent's message can close the block it sits in.
 */
export function sourceTextForPrompt(brief: Pick<StoryBrief, "sourceText">): string {
  return sourceNotes(brief)
    .map((note) => note.replace(/[<>]/g, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}
