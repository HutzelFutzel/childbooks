/**
 * Where the pages of a story end.
 *
 * The story is read as ATOMS: one per line of verse, one per sentence of prose.
 * A page turn can only fall between two atoms. What belongs together is a TIE
 * between two atoms, and a page turn that falls between them pays that tie's
 * weight. Choosing the pages is then a plain minimisation: the cuts that pay the
 * least, for the number of pages wanted. A story that needs more pages than it
 * has places to cut cleanly is cut where it costs the least, which is how four
 * rhyming lines become 2 + 2, or 1 + 1 + 1 + 1 when the stretch demands it, and
 * never at random.
 *
 * Ties come from two places. The structure of the text gives some of them
 * (lines of one stanza, a sentence that runs over a line break); they are read
 * the same way in every language. A model may add the ones only a reader hears
 * (which lines rhyme, which repeat), and its answer only ever changes where a
 * page turn falls: it is checked here, it can be wrong or missing, and the
 * author's words are never touched either way.
 *
 * Everything is a pure function of the story, so it runs without a network.
 */
import {
  blocksOf,
  isVerseBlock,
  sentenceEnds,
  sentenceSlices,
  squash,
  storyParts,
  weigh,
} from "./screenplayText";

export type TieKind = "sentence" | "stanza" | "paragraph" | "rhyme" | "refrain" | "pattern" | "thought";

/** The kinds a model may report; the structure of the text supplies the others. */
export const ANNOTATED_KINDS = ["rhyme", "refrain", "pattern", "thought"] as const;
export type AnnotatedKind = (typeof ANNOTATED_KINDS)[number];

/**
 * What it costs to put a page turn through each kind of tie. One table, so the
 * balance between them is tuned in one place. A cut also pays for every tie it
 * crosses, so splitting a tied group into more pieces costs more.
 */
export const CUT_WEIGHTS: Record<TieKind, number> = {
  paragraph: 8,
  pattern: 15,
  refrain: 20,
  stanza: 25,
  rhyme: 30,
  thought: 40,
  sentence: 60,
};

/**
 * Ties at or above this weight are protected: a plan that cuts through one when
 * it did not have to is sent back. A paragraph's own sentences are not; where
 * inside a paragraph a page turn falls is a matter of pacing.
 */
export const PROTECTED_MIN = 12;

/** How much a page's size weighs against the soft ties (a paragraph's own sentences). */
const BALANCE = 4;
/** What merging a new paragraph onto a page that is already a third full costs, and how full that is. */
const BEAT = 6;
const BEAT_SHARE = 0.35;
/** One piece's size penalty stops here, so a sum of them stays far below {@link SCALE}. */
const BALANCE_MAX = 100_000;
/** A protected cost always outranks everything soft, whatever the page sizes. */
const SCALE = 1_000_000_000;
/** The most a tie may reach across, and how many a single atom may have: the model's ties are local. */
export const TIE_SPAN_MAX = 8;
const TIE_DEGREE_MAX = 3;
/** Bigger problems than this fall back from an exact page count to the natural one. */
const WORK_MAX = 40_000_000;

export interface Atom {
  text: string;
  /** How much page it takes. */
  weight: number;
  /** Which of the author's marked parts it belongs to; a page never spans two. */
  part: number;
  /** Which paragraph or stanza it belongs to (unique over the story). */
  block: number;
  /** Put this before the atom when it shares a page with the one before it. */
  sep: string;
  /** A line of verse. */
  line: boolean;
  /** A line whose sentence goes on in the next line. */
  open: boolean;
}

export interface Tie {
  a: number;
  b: number;
  kind: TieKind;
  weight: number;
}

/** The story as atoms, in order. */
export function atomsOf(story: string, locale?: string): Atom[] {
  const atoms: Atom[] = [];
  let block = 0;
  storyParts(story).forEach((part, partIndex) => {
    for (const text of blocksOf(part)) {
      block += 1;
      if (isVerseBlock(text)) {
        const lines = text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        // The segmenter reads sentences, and a line break ends one for it: read the lines as one run.
        const ends = sentenceEnds(lines.join(" "), locale);
        let at = 0;
        lines.forEach((line, i) => {
          at += line.length;
          atoms.push({
            text: line,
            weight: weigh(line),
            part: partIndex,
            block,
            sep: i === 0 ? "\n\n" : "\n",
            line: true,
            open: i < lines.length - 1 && !ends.has(at),
          });
          at += 1;
        });
        continue;
      }
      const sentences = sentenceSlices(text.replace(/\s*\n\s*/g, " "), locale);
      // A paragraph of one sentence is kept as the author wrote it, line breaks and all.
      const pieces = sentences.length > 1 ? sentences : [{ text, gap: "" }];
      pieces.forEach((sentence, i) =>
        atoms.push({
          text: sentence.text,
          weight: weigh(sentence.text),
          part: partIndex,
          block,
          // Sentences go back together with the gap the author had between them, none in Japanese.
          sep: i === 0 ? "\n\n" : sentence.gap,
          line: false,
          open: false,
        }),
      );
    }
  });
  return atoms;
}

/** The ties the text's own structure gives. */
export function structuralTies(atoms: readonly Atom[]): Tie[] {
  const ties: Tie[] = [];
  for (let i = 0; i + 1 < atoms.length; i++) {
    const here = atoms[i]!;
    if (here.block !== atoms[i + 1]!.block) continue;
    if (here.line) {
      ties.push({ a: i, b: i + 1, kind: "stanza", weight: CUT_WEIGHTS.stanza });
      if (here.open) ties.push({ a: i, b: i + 1, kind: "sentence", weight: CUT_WEIGHTS.sentence });
    } else {
      ties.push({ a: i, b: i + 1, kind: "paragraph", weight: CUT_WEIGHTS.paragraph });
    }
  }
  return ties;
}

/**
 * The ties a model reported, kept only if they make sense. Its numbers count
 * atoms from 1, as it was shown them. Anything doubtful is dropped, not mended:
 * a tie that is not there only costs a worse cut.
 */
export function sanitizeTies(raw: unknown, atoms: readonly Atom[]): Tie[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set<string>(ANNOTATED_KINDS);
  const degree = new Array<number>(atoms.length).fill(0);
  const seen = new Set<string>();
  const out: Tie[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { a, b, kind } = entry as { a?: unknown; b?: unknown; kind?: unknown };
    if (typeof a !== "number" || typeof b !== "number" || !Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (typeof kind !== "string" || !kinds.has(kind)) continue;
    const from = a - 1;
    const to = b - 1;
    if (from < 0 || to >= atoms.length || from >= to || to - from > TIE_SPAN_MAX) continue;
    if (atoms[from]!.part !== atoms[to]!.part) continue;
    const key = `${from}:${to}`;
    if (seen.has(key) || degree[from]! >= TIE_DEGREE_MAX || degree[to]! >= TIE_DEGREE_MAX) continue;
    seen.add(key);
    degree[from]! += 1;
    degree[to]! += 1;
    out.push({ a: from, b: to, kind: kind as AnnotatedKind, weight: CUT_WEIGHTS[kind as AnnotatedKind] });
    if (out.length >= atoms.length * 2) break;
  }
  return out;
}

/** The atoms as a model is shown them: numbered from 1, a blank line between paragraphs and stanzas, a marker where the author's pages begin. */
export function numberedAtoms(atoms: readonly Atom[]): string {
  const lines: string[] = [];
  atoms.forEach((atom, i) => {
    const before = atoms[i - 1];
    if (before && before.part !== atom.part) lines.push("", "--- page break ---");
    else if (before && before.block !== atom.block) lines.push("");
    lines.push(`${i + 1}. ${atom.text.replace(/\s*\n\s*/g, " ")}`);
  });
  return lines.join("\n");
}

export interface CutOptions {
  /** The exact number of pieces; when absent, as many as the pieces' size asks for. */
  pieces?: number;
  /** The weight a piece should carry. Ignored when `pieces` is set: the pieces then share the story equally. */
  target: number;
  /** Prefer pieces of an even size, as a tie-breaker below every tie. */
  balance: boolean;
  /** Count only protected ties. */
  protectedOnly?: boolean;
}

export interface CutResult {
  /** Where each piece ends: an index into the atoms, exclusive. The last is the atom count. */
  ends: number[];
  /** The summed weight of the protected ties the cuts go through. */
  protectedCost: number;
}

/**
 * The cheapest way to cut the atoms into pieces. A piece never spans two of the
 * author's parts. Protected ties always outrank page balance (the two are
 * compared in that order, never added), so a story is never cut through a stanza
 * for the sake of an even page unless the number of pieces asked for leaves no
 * other way.
 */
export function optimalCuts(atoms: readonly Atom[], ties: readonly Tie[], options: CutOptions): CutResult {
  const n = atoms.length;
  if (n === 0) return { ends: [], protectedCost: 0 };

  // cut[j]: what ending a piece after atom j costs.
  const cut = new Float64Array(n);
  for (const tie of ties) {
    const protectedTie = tie.weight >= PROTECTED_MIN;
    if (options.protectedOnly && !protectedTie) continue;
    const price = protectedTie ? tie.weight * SCALE : tie.weight;
    for (let j = tie.a; j < tie.b; j++) cut[j]! += price;
  }

  const prefix = new Float64Array(n + 1);
  atoms.forEach((atom, i) => {
    prefix[i + 1] = prefix[i]! + atom.weight;
  });
  let parts = 1;
  for (let i = 1; i < n; i++) if (atoms[i]!.part !== atoms[i - 1]!.part) parts += 1;

  const wanted = options.pieces && options.pieces > 0 ? Math.min(n, Math.max(parts, Math.floor(options.pieces))) : 0;
  const exact = wanted > 0 && (wanted + 1) * n * n <= WORK_MAX;
  const target = Math.max(1, exact ? prefix[n]! / wanted : options.target);
  // Where a paragraph or stanza begins: the boundaries a page would rather fall on.
  const blockStarts: number[] = [];
  for (let k = 1; k < n; k++) if (atoms[k]!.block !== atoms[k - 1]!.block) blockStarts.push(k);
  /** The position in the sorted list of the first value that is at least `at`. */
  const firstFrom = (list: readonly number[], at: number) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]! >= at) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  /**
   * A piece pays for every paragraph break inside it that comes after it is
   * already a third full: a new paragraph is a new beat, and begins a page once
   * the page before it has something on it.
   */
  const beats = (i: number, j: number) => {
    const lo = firstFrom(blockStarts, i + 1);
    const hi = firstFrom(blockStarts, j);
    if (lo >= hi) return 0;
    const full = prefix[i]! + BEAT_SHARE * target;
    let a = lo;
    let b = hi;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (prefix[blockStarts[mid]!]! >= full) b = mid;
      else a = mid + 1;
    }
    return (hi - a) * BEAT;
  };
  const size = (i: number, j: number) => {
    if (!options.balance) return 0;
    const off = (prefix[j]! - prefix[i]! - target) / target;
    return Math.min(BALANCE_MAX, BALANCE * off * off) + beats(i, j);
  };
  const before = (i: number) => (i > 0 ? cut[i - 1]! : 0);

  const ends: number[] = [];
  let total = Infinity;
  if (exact) {
    const stride = n + 1;
    const cost = new Float64Array((wanted + 1) * stride).fill(Infinity);
    const back = new Int32Array((wanted + 1) * stride).fill(-1);
    cost[0] = 0;
    for (let c = 1; c <= wanted; c++) {
      for (let j = c; j <= n; j++) {
        for (let i = j - 1; i >= c - 1; i--) {
          if (atoms[i]!.part !== atoms[j - 1]!.part) break;
          const prev = cost[(c - 1) * stride + i]!;
          if (prev === Infinity) continue;
          const next = prev + before(i) + size(i, j);
          if (next < cost[c * stride + j]!) {
            cost[c * stride + j] = next;
            back[c * stride + j] = i;
          }
        }
      }
    }
    total = cost[wanted * stride + n]!;
    if (total !== Infinity) {
      for (let c = wanted, j = n; c > 0; c--) {
        ends.push(j);
        j = back[c * stride + j]!;
      }
      ends.reverse();
    }
  }
  if (ends.length === 0) {
    const cost = new Float64Array(n + 1).fill(Infinity);
    const back = new Int32Array(n + 1).fill(-1);
    cost[0] = 0;
    for (let j = 1; j <= n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        if (atoms[i]!.part !== atoms[j - 1]!.part) break;
        const next = cost[i]! + before(i) + size(i, j);
        if (next < cost[j]!) {
          cost[j] = next;
          back[j] = i;
        }
      }
    }
    total = cost[n]!;
    for (let j = n; j > 0; j = back[j]!) ends.push(j);
    ends.reverse();
  }
  return { ends, protectedCost: Math.floor(total / SCALE + 1e-9) };
}

/** The page texts for the pieces, put back together the way the author wrote them. */
function textsOf(atoms: readonly Atom[], ends: readonly number[]): string[] {
  let from = 0;
  return ends.map((end) => {
    const text = atoms
      .slice(from, end)
      .map((atom, i) => (i === 0 ? atom.text : atom.sep + atom.text))
      .join("");
    from = end;
    return text;
  });
}

export interface SplitOptions {
  /** The words a page should carry. */
  wordsPerPage: number;
  /** Exactly this many pieces, or as near as the story's lines allow. When absent the pages' size decides. */
  pages?: number;
  /** Ties a model reported, added to the ones the text itself has. */
  ties?: readonly Tie[];
  /** The book's language, for reading sentences. */
  locale?: string;
}

/**
 * Cuts the story into page texts. A part the author marked starts a new page,
 * and the rest is cut where the least that belongs together is parted. The
 * words and their order are the story's own.
 */
export function splitStoryIntoPages(story: string, options: SplitOptions): string[] {
  const atoms = atomsOf(story, options.locale);
  if (atoms.length === 0) return [];
  const ties = [...structuralTies(atoms), ...(options.ties ?? [])];
  const { ends } = optimalCuts(atoms, ties, {
    pieces: options.pages,
    target: Math.max(4, options.wordsPerPage || 40),
    balance: true,
  });
  return textsOf(atoms, ends);
}

/** One place where a page turn parts what belongs together. */
export interface BrokenCut {
  /** The page that ends there. */
  page: number;
  kind: TieKind;
  weight: number;
  /** The last words before the turn and the first after it. */
  tail: string;
  head: string;
}

export interface CutInspection {
  /** What the plan's page turns pay. */
  cost: number;
  /** The least any plan with as many pages could pay. */
  optimum: number;
  /** The costliest cuts that, once mended, bring the plan to the optimum. */
  excess: BrokenCut[];
}

const KIND_LABEL: Record<TieKind, string> = {
  sentence: "one sentence",
  stanza: "lines of one stanza",
  paragraph: "one paragraph",
  rhyme: "a rhyming pair",
  refrain: "a refrain and the lines it belongs with",
  pattern: "a repeated pattern",
  thought: "one thought",
};

/** One sentence the repair call can act on. */
export function describeCut(cut: BrokenCut): string {
  return `Page ${cut.page} ends "…${cut.tail}" and page ${cut.page + 1} begins "${cut.head}…": these are ${KIND_LABEL[cut.kind]} and belong on one page. Move the page turn to a place that parts fewer lines that belong together (between stanzas and paragraphs first), and keep every word.`;
}

const tailOf = (text: string) => (text.length > 36 ? text.slice(-36).trimStart() : text);
const headOf = (text: string) => (text.length > 36 ? text.slice(0, 36).trimEnd() : text);

/**
 * Reads a plan's page turns against the story. Null when it cannot judge: the
 * pages do not line up with the story's text, there is nothing to cut, or the
 * plan has more pages than the story has lines.
 *
 * Only protected ties count, and the plan is held to the least that ANY plan of
 * its own length could pay, never to a layout of its own pacing.
 */
export function inspectCuts(
  story: string,
  pageTexts: readonly string[],
  options: { ties?: readonly Tie[]; locale?: string } = {},
): CutInspection | null {
  const pages = pageTexts.map((text, index) => ({ text: squash(text), page: index + 1 })).filter((p) => p.text);
  if (pages.length < 2) return null;
  const atoms = atomsOf(story, options.locale);
  if (atoms.length < 2 || pages.length > atoms.length) return null;
  const ties = [...structuralTies(atoms), ...(options.ties ?? [])].filter((t) => t.weight >= PROTECTED_MIN);

  // Where each atom, and each page, ends in the story with its whitespace squashed. They are
  // found one after the other, so a line the story repeats is never mistaken for its first.
  const flat = squash(storyParts(story).join(" "));
  const found = (text: string, from: number): number => {
    const at = flat.indexOf(text, from);
    return at >= 0 && !flat.slice(from, at).trim() ? at + text.length : -1;
  };
  const atomEnd = new Map<number, number>();
  let at = 0;
  for (const [i, atom] of atoms.entries()) {
    at = found(squash(atom.text), at);
    if (at < 0) return null;
    atomEnd.set(at, i);
  }

  const broken: BrokenCut[] = [];
  let end = 0;
  for (const [k, page] of pages.entries()) {
    end = found(page.text, end);
    if (end < 0) return null;
    const next = pages[k + 1];
    if (!next) continue;
    const tail = tailOf(page.text);
    const head = headOf(next.text);
    const index = atomEnd.get(end);
    if (index === undefined) {
      // A page that ends inside a line or a sentence.
      broken.push({ page: page.page, kind: "sentence", weight: CUT_WEIGHTS.sentence, tail, head });
    } else {
      for (const tie of ties) {
        if (tie.a <= index && index < tie.b) broken.push({ page: page.page, kind: tie.kind, weight: tie.weight, tail, head });
      }
    }
  }
  if (end !== flat.length) return null;

  const cost = broken.reduce((sum, cut) => sum + cut.weight, 0);
  const { protectedCost: optimum } = optimalCuts(atoms, ties, {
    pieces: pages.length,
    target: 1,
    balance: false,
    protectedOnly: true,
  });
  const excess: BrokenCut[] = [];
  let left = cost;
  for (const cut of [...broken].sort((a, b) => b.weight - a.weight || a.page - b.page)) {
    if (left <= optimum) break;
    excess.push(cut);
    left -= cut.weight;
  }
  return { cost, optimum, excess: excess.sort((a, b) => a.page - b.page) };
}
