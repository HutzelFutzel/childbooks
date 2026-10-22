/**
 * The story's words on the book's pages: reading them back, checking them, and
 * cutting them when the page plan could not.
 *
 * Everything here compares or counts structure — blank lines, line breaks,
 * characters, the sentence boundaries the platform's own segmenter reports. No
 * word lists and no language rules, so it reads a rhymed German story, a
 * Japanese one and an English one the same way.
 */
import { BREAK_MARKERS } from "../story/manuscriptShape";
import { wordCount } from "../story/brief";

/** Text with every run of whitespace as one space: how two copies of the same words are compared. */
export function squash(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

/** The story without the break markers the page plan was shown. */
export function storyParts(story: string): string[] {
  let parts = [story];
  for (const marker of BREAK_MARKERS) {
    parts = parts.flatMap((part) => part.split(marker));
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Blocks of one part: paragraphs and stanzas, split at blank lines. */
function blocksOf(part: string): string[] {
  return part
    .split(/\n[^\S\n]*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);
}

/**
 * Longest line, in characters, at which a hard-wrapped paragraph is still told
 * apart from verse: pasted prose breaks lines near 70-80 characters, a line of
 * verse is short.
 */
const VERSE_LINE_MEDIAN_MAX = 48;

/**
 * A block written as lines — a couplet, a stanza, a refrain — rather than as a
 * paragraph: two or more lines, and short ones.
 */
export function isVerseBlock(block: string): boolean {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const lengths = lines.map((line) => [...line].length).sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)]! <= VERSE_LINE_MEDIAN_MAX;
}

/** The story's verse blocks, as they must stay whole on one page. */
export function verseBlocks(story: string): string[] {
  return storyParts(story)
    .flatMap(blocksOf)
    .filter(isVerseBlock);
}

export interface TextMismatch {
  /** 1-based index of the page where the words stop matching; pages.length + 1 when the story runs on past the last page. */
  page: number;
  /** What the story says next, from that point. */
  expected: string;
  /** What the page says instead; empty when the story simply continues. */
  found: string;
}

/**
 * Whether the pages' words, in order, are exactly the story's. Whitespace is
 * ignored; everything else must match, so a missing sentence, a repeated one,
 * a reworded one and a printed break marker all show up.
 */
export function firstTextMismatch(story: string, pageTexts: string[]): TextMismatch | null {
  let remaining = squash(storyParts(story).join(" "));
  for (let i = 0; i < pageTexts.length; i++) {
    const text = squash(pageTexts[i] ?? "");
    if (!text) continue;
    if (!remaining.startsWith(text)) {
      return { page: i + 1, expected: remaining.slice(0, 120), found: text.slice(0, 120) };
    }
    remaining = remaining.slice(text.length).trimStart();
  }
  return remaining ? { page: pageTexts.length + 1, expected: remaining.slice(0, 120), found: "" } : null;
}

/** Verse blocks that a page boundary cuts in two (or that no single page holds). */
export function splitVerseBlocks(story: string, pageTexts: string[]): { block: string; page: number }[] {
  const pages = pageTexts.map(squash);
  const out: { block: string; page: number }[] = [];
  let from = 0;
  for (const block of verseBlocks(story)) {
    const wanted = squash(block);
    let at = -1;
    for (let i = from; i < pages.length; i++) {
      if (pages[i]!.includes(wanted)) {
        at = i;
        break;
      }
    }
    if (at >= 0) {
      from = at;
      continue;
    }
    // Which page holds its first words: where the cut is.
    const head = wanted.slice(0, Math.max(8, Math.floor(wanted.length / 3)));
    const start = pages.findIndex((page, i) => i >= from && page.includes(head));
    out.push({ block: wanted.slice(0, 80), page: (start >= 0 ? start : from) + 1 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cutting the story into pages without a model
// ---------------------------------------------------------------------------

function sentencesOf(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    const out = [...new Segmenter(undefined, { granularity: "sentence" }).segment(text)]
      .map((s) => s.segment.trim())
      .filter(Boolean);
    if (out.length > 0) return out;
  }
  return text
    .split(/(?<=[.!?…。！？])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface Unit {
  text: string;
  words: number;
  /** Put this between the unit and the one before it when they share a page. */
  sep: string;
}

const weigh = (text: string) => Math.max(1, wordCount(text), Math.ceil([...text].length / 8));

/** How much of a page a beat must fill before the next beat begins a page of its own. */
const BEAT_SHARE = 0.35;

export interface SplitOptions {
  /** The words a page should carry. */
  wordsPerPage: number;
  /** When known, aims the cut at this many pages. */
  pages?: number;
}

/**
 * Cuts the story into page texts at the boundaries the author wrote: a part the
 * author marked starts a new page, a stanza is never divided, a paragraph is
 * kept whole unless it alone is larger than a page, and then it is divided at
 * sentence ends. The words and their order are the story's own.
 */
export function splitStoryIntoPages(story: string, options: SplitOptions): string[] {
  const parts = storyParts(story);
  const unitsOf = (part: string, limit: number): Unit[] => {
    const units: Unit[] = [];
    for (const block of blocksOf(part)) {
      const size = weigh(block);
      if (isVerseBlock(block) || size <= limit) {
        units.push({ text: block, words: size, sep: "\n\n" });
        continue;
      }
      sentencesOf(block).forEach((sentence, i) =>
        units.push({ text: sentence, words: weigh(sentence), sep: i === 0 ? "\n\n" : " " }),
      );
    }
    return units;
  };

  const total = parts.reduce((sum, part) => sum + weigh(part), 0);
  const aimed = options.pages && options.pages > 0 ? Math.ceil(total / options.pages) : 0;
  const target = Math.max(4, aimed || options.wordsPerPage || 40);
  const limit = Math.ceil(target * 1.3);

  const pages: string[] = [];
  for (const part of parts) {
    let current = "";
    let used = 0;
    for (const unit of unitsOf(part, limit)) {
      // A new paragraph or stanza is a new beat: it starts a page once the page
      // has something on it, rather than being packed up to the limit. Only the
      // sentences of one long paragraph fill a page.
      const beat = unit.sep !== " " && used >= target * BEAT_SHARE;
      if (current && (beat || used + unit.words > limit)) {
        pages.push(current);
        current = "";
        used = 0;
      }
      current = current ? `${current}${unit.sep}${unit.text}` : unit.text;
      used += unit.words;
    }
    if (current) pages.push(current);
  }
  return pages;
}
