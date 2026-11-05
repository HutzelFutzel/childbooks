/**
 * A page's words as plain text and as styled text, and how one becomes the other without
 * losing the styling of the words that did not change.
 *
 * A page's words live in two places: `spread.text` (plain, read by the story, the assistant and the
 * picture prompts) and the story text box (styled, what the page shows and prints). This file is the
 * pure part of keeping them the same: comparing them, and rewriting the box's words from new plain text
 * (`rewordParagraphs`). `pageWordsGate.ts` decides when each is used.
 */
import { textFromParagraphs, type TextParagraph, type TextSpan } from "../design";

/**
 * The words in one fixed shape, so two copies of the same words compare equal: line endings, runs of
 * blank lines and spaces at line ends do not make a difference.
 */
export function canonWords(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

/** The words a styled box holds, in the shape `canonWords` gives. */
export function wordsOfParagraphs(paragraphs: readonly TextParagraph[]): string {
  return canonWords(textFromParagraphs(paragraphs as TextParagraph[]));
}

type Style = Omit<TextSpan, "text">;

type Token = { text: string; word: boolean; style: Style; paragraph: number };

const styleOf = (span: TextSpan): Style => {
  const { text: _text, ...style } = span;
  void _text;
  return style;
};

/** Every word and every run of space in the paragraphs, each with the style of the span it sat in. */
function tokensOf(paragraphs: readonly TextParagraph[]): Token[] {
  const out: Token[] = [];
  paragraphs.forEach((paragraph, index) => {
    for (const span of paragraph.spans) {
      const style = styleOf(span);
      for (const part of span.text.split(/(\s+)/)) {
        if (part.length === 0) continue;
        out.push({ text: part, word: !/^\s+$/.test(part), style, paragraph: index });
      }
    }
  });
  return out;
}

/**
 * The longest run of words the two lists share, as pairs of positions in each. Words are matched by
 * their letters, so "Hello!" and "Hello" are different words.
 */
function sharedWords(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  // Most edits touch the middle: keep the shared start and end out of the table.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start += 1;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < start; i += 1) pairs.push([i, i]);
  const rows = endA - start;
  const cols = endB - start;
  if (rows > 0 && cols > 0) {
    const table: Uint16Array[] = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i]![j] =
          a[start + i] === b[start + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (a[start + i] === b[start + j]) {
        pairs.push([start + i, start + j]);
        i += 1;
        j += 1;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
      else j += 1;
    }
  }
  for (let k = 0; k < n - endA; k += 1) pairs.push([endA + k, endB + k]);
  return pairs;
}

/**
 * The styled paragraphs for new plain text, from the ones the page had.
 *
 * A word that stayed keeps its style (bold, colour, size). A word that replaced another one takes the
 * style of the word it replaced, so fixing a word inside a bold phrase stays bold. A word with no
 * counterpart takes the style of the word before it. Spaces follow the word before them, and blank lines
 * start new paragraphs that keep their alignment.
 */
export function rewordParagraphs(old: readonly TextParagraph[], text: string): TextParagraph[] {
  const blocks = canonWords(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (blocks.length === 0) {
    const style = styleOf(old[0]?.spans[0] ?? { text: "" });
    return [{ ...(old[0]?.align ? { align: old[0].align } : {}), spans: [{ ...style, text: "" }] }];
  }

  const before = tokensOf(old);
  const oldWords = before.filter((token) => token.word);
  // New words with nothing to copy look like the page's first word, or like an empty box's own style.
  const fallback: Style = oldWords[0]?.style ?? (old[0]?.spans[0] ? styleOf(old[0].spans[0]) : {});

  const next: Token[] = [];
  blocks.forEach((block, index) => {
    for (const part of block.split(/(\s+)/)) {
      if (part.length === 0) continue;
      next.push({ text: part, word: !/^\s+$/.test(part), style: fallback, paragraph: index });
    }
  });
  const newWords = next.filter((token) => token.word);

  // Style the words: kept words keep theirs, a changed stretch pairs up with what it replaced.
  const pairs = sharedWords(
    oldWords.map((token) => token.text),
    newWords.map((token) => token.text),
  );
  const styleFor: Style[] = new Array(newWords.length);
  const anchors: Array<[number, number]> = [[-1, -1], ...pairs, [oldWords.length, newWords.length]];
  for (let k = 0; k < anchors.length - 1; k += 1) {
    const [oi, ni] = anchors[k]!;
    const [oj, nj] = anchors[k + 1]!;
    if (k > 0 && ni >= 0) styleFor[ni] = oldWords[oi]!.style;
    const gapOld = oldWords.slice(oi + 1, oj);
    for (let g = ni + 1; g < nj; g += 1) {
      const counterpart = gapOld[g - ni - 1];
      const earlier = g > 0 ? styleFor[g - 1] : undefined;
      styleFor[g] = counterpart?.style ?? earlier ?? gapOld[gapOld.length - 1]?.style ?? fallback;
    }
  }
  let wordIndex = 0;
  let current: Style = styleFor[0] ?? fallback;
  for (const token of next) {
    if (token.word) {
      current = styleFor[wordIndex] ?? current;
      wordIndex += 1;
    }
    token.style = current;
  }

  // Back into paragraphs. A space at the very start follows the first word.
  const alignOf = (index: number) => old[index]?.align ?? old[Math.min(index, old.length - 1)]?.align;
  return blocks.map((_, index) => {
    const tokens = next.filter((token) => token.paragraph === index);
    const align = alignOf(index);
    return {
      ...(align ? { align } : {}),
      spans: tokens.map((token) => ({ ...token.style, text: token.text })),
    };
  });
}
