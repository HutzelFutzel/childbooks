/**
 * The story's words on the book's pages: reading them back, checking them, and
 * cutting them when the page plan could not.
 *
 * Everything here compares or counts structure — blank lines, line breaks,
 * characters, the sentence boundaries the platform's own segmenter reports. No
 * word lists and no language rules, so it reads a rhymed German story, a
 * Japanese one and an English one the same way.
 *
 * Choosing where the pages end is `screenplayCuts.ts`.
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
export function blocksOf(part: string): string[] {
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
// Reading the story's sentences and sizes (the cutting itself is in screenplayCuts.ts)
// ---------------------------------------------------------------------------

type SentenceSegmenter = new (
  locale?: string,
  options?: { granularity: string },
) => { segment(text: string): Iterable<{ segment: string; index: number }> };

const segmenterOf = (): SentenceSegmenter | undefined => (Intl as unknown as { Segmenter?: SentenceSegmenter }).Segmenter;

/** Where the platform's segmenter (or, without one, the end punctuation) ends each sentence of `text`: character offsets just after the sentence's last character. */
export function sentenceEnds(text: string, locale?: string): Set<number> {
  const Segmenter = segmenterOf();
  const ends = new Set<number>();
  if (Segmenter) {
    try {
      for (const { segment, index } of new Segmenter(locale, { granularity: "sentence" }).segment(text)) {
        const end = index + segment.trimEnd().length;
        if (end > index) ends.add(end);
      }
      if (ends.size > 0) return ends;
    } catch {
      // An unknown locale falls back to the punctuation below.
    }
  }
  for (const match of text.matchAll(/[.!?…。！？]+["'”’»)\]]*(?=\s|$)/gu)) ends.add(match.index! + match[0].length);
  if (text.trim()) ends.add(text.trimEnd().length);
  return ends;
}

/**
 * The sentences of a text, in order, trimmed, each with the whitespace that
 * stood before it. That gap is empty in a language written without spaces, so
 * putting sentences back together with it gives the author's text again.
 */
export function sentenceSlices(text: string, locale?: string): { text: string; gap: string }[] {
  const ends = [...sentenceEnds(text, locale)].sort((a, b) => a - b);
  const out: { text: string; gap: string }[] = [];
  let from = 0;
  const take = (end: number) => {
    const raw = text.slice(from, end);
    const sentence = raw.trim();
    if (sentence) out.push({ text: sentence, gap: raw.slice(0, raw.length - raw.trimStart().length) });
    from = end;
  };
  for (const end of ends) take(end);
  take(text.length);
  return out;
}

/** How much page a text takes: words, or for text without spaces its length. */
export const weigh = (text: string) => Math.max(1, wordCount(text), Math.ceil([...text].length / 8));
