/**
 * The book's look is set once, for the whole book, in the Style step. A page may
 * change WHAT is drawn (who, where, when, what they do, the light, a red umbrella)
 * but never HOW it is drawn: the medium, the technique, a genre look, an artist.
 *
 * This reads a sentence a reader (or a model) wrote about one page and finds the
 * parts that ask for another look, so they can be left out before anything is
 * drawn and the reader can be told so. It only matches an INSTRUCTION about how
 * the picture is drawn ("in anime style", "make it look like a comic"), never a
 * single word: a crayon in his hand, a painting on the wall or a comic she reads
 * are things in the scene and pass through untouched.
 *
 * Pure, English and German, no model call: cheap enough to run on every keystroke.
 */

export interface StylePhrase {
  text: string;
  start: number;
  end: number;
}

export interface StyleRequest {
  /** The parts that ask for another look, in the order they appear. */
  phrases: StylePhrase[];
  /** Once those parts are taken out, nothing is left to draw or change. */
  onlyStyle: boolean;
  /** The text without the style phrases, tidied. */
  rest: string;
}

const L = "\\p{L}\\p{N}";
const B0 = `(?<![${L}])`;
const B1 = `(?![${L}])`;

/** Media, techniques and genre looks. A word here only counts inside an instruction below. */
const STYLE_WORDS = [
  "water[\\s-]?colou?r(?:s|ed)?",
  "aquarell\\p{L}*",
  "gouache",
  "oil[\\s-]?paint(?:ing|s)?",
  "oil\\s+pastels?",
  "ölgemälde\\p{L}*",
  "öl[\\s-]?malerei",
  "acryl(?:ic)?\\p{L}*",
  "(?:wax\\s+)?crayons?",
  "buntstift\\p{L}*",
  "wachsmal\\p{L}*",
  "colou?red[\\s-]+pencils?",
  "pencil(?:[\\s-]+(?:sketch|drawing))?",
  "bleistift\\p{L}*",
  "charcoal",
  "kohle(?:zeichnung)?",
  "ink(?:[\\s-]+(?:drawing|wash))?",
  "tusche",
  "pen[\\s-]and[\\s-]ink",
  "line[\\s-]?art",
  "linocut",
  "woodcut",
  "collage",
  "paper[\\s-]?cut(?:[\\s-]?out)?",
  "pixel[\\s-]?art",
  "anime",
  "manga",
  "chibi",
  "comic(?:[\\s-]?book)?s?",
  "cartoon\\p{L}*",
  "disney",
  "pixar",
  "(?:studio\\s+)?ghibli",
  "3[\\s-]?d",
  "cgi",
  "clay(?:mation)?",
  "plasticine",
  "low[\\s-]?poly",
  "vector",
  "flat[\\s-]+(?:design|illustration|vector)",
  "(?:hyper[\\s-]?|photo[\\s-]?)realis(?:tic|m)",
  "vintage",
  "retro",
  "impressionis(?:t|m|tic)",
  "cubis(?:t|m)",
  "sketch(?:y|ed|book)?",
].join("|");
const STYLE = `(?:${STYLE_WORDS})`;

/** A word that turns a medium into a look: "anime style", "Aquarell-Stil". */
const LOOK_WORD =
  "(?:style[sd]?|looks?|looking|stil|art|aesthetic|ästhetik|rendering|technique|technik|medium|illustration|effect|optik)";
const SUFFIX = `(?:[\\s-]+${LOOK_WORD}${B1})`;

/** What a "make it …" sentence can be about: the whole picture, never a part of it. */
const WHOLE =
  "(?:it|this|that|them|everything|alles|es|das|(?:the\\s+|this\\s+|die\\s+|diese\\s+|dieses\\s+)?(?:(?:whole|entire|ganze[ns]?)\\s+)?(?:page|picture|image|illustration|book|cover|seite|bild|buch)(?:\\s+\\d+)?)";

/** The clause is over: end of the text, punctuation, or a connector. */
const CLAUSE_END = `(?=\\s*(?:$|[,.;:!?)]|\\s(?:and|but|please|then|und|aber|bitte|dann)${B1}))`;

const COLOUR_LOOK =
  "(?:black[\\s-]*and[\\s-]*white|greyscale|grayscale|sepia|monochrome|neon\\s+colou?rs?|schwarz[\\s-]*wei(?:ß|ss)|graustufen)";

interface Rule {
  re: RegExp;
  /** Which capture group is the part to take out; the whole match when absent. */
  group?: number;
}

const rule = (source: string, group?: number): Rule => ({ re: new RegExp(source, "giu"), ...(group ? { group } : {}) });

const RULES: Rule[] = [
  // "in the style of Studio Ghibli", "im Stil von Pixar"
  rule(`${B0}(?:in|im)\\s+(?:the\\s+|a\\s+|dem\\s+|einem\\s+)?(?:style|stil)\\s+(?:of|von|eines|einer)\\s+[^,.;!?\\n]+`),
  // "in watercolor", "in a pencil sketch style", "im Aquarell-Stil"
  rule(`${B0}(?:in|im)\\s+(?:an?\\s+|the\\s+|einem\\s+|dem\\s+)?${STYLE}${SUFFIX}?(?:\\s+(?:style|stil))?${B1}${CLAUSE_END}`),
  // "anime style", "comic look", "Aquarell-Stil"
  rule(`${B0}${STYLE}${SUFFIX}`),
  // "make it look like a comic", "draw it as watercolor", "turn the page into a collage"
  rule(
    `${B0}(?:make|turn|render|draw|paint|redraw|illustrate|zeichne|male|mach(?:e)?|verwandle)\\s+${WHOLE}\\s+(?:all\\s+|ganz\\s+)?` +
      `((?:look\\s+(?:like|as\\s+if(?:\\s+it\\s+were)?)|looks\\s+like|like|as|in|into|to|als|wie|zu)\\s+(?:an?\\s+|the\\s+|ein(?:e|en)?\\s+)?${STYLE}(?:${SUFFIX})?)${B1}`,
    1,
  ),
  // "make page 4 watercolor"
  rule(`${B0}(?:make|turn|redraw|paint|mach(?:e)?|male)\\s+${WHOLE}\\s+(?:all\\s+)?(${STYLE}${B1})`, 1),
  // "change the style to watercolor", "switch to anime"
  rule(
    `${B0}(?:change|switch|swap|go|wechsle|wechseln|ändere|ändern)\\s+(?:the\\s+|den\\s+|dem\\s+)?(?:(?:art\\s+|kunst|zeichen)?(?:style|stil)\\s+)?(?:to|over\\s+to|auf|zu|in)\\s+(?:an?\\s+|the\\s+|ein(?:e|en)?\\s+)?${STYLE}${B1}`,
  ),
  // "a different art style", "another look", "anderer Zeichenstil"
  rule(
    `${B0}(?:(?:a|an|the)\\s+)?(?:different|new|other|another|anderen?|neuen?|neuer|anderer)\\s+(?:art(?:work)?[\\s-]+)?(?:kunst|zeichen)?(?:style|look|medium|technique|stil|technik)${B1}`,
  ),
  // "change the art style", "ändere den Kunststil"
  rule(`${B0}(?:change|switch|swap|replace|ändere\\p{L}*|wechsle\\p{L}*)\\s+(?:the\\s+|den\\s+|dem\\s+|its\\s+|der\\s+)?(?:art\\s+|kunst|zeichen)?(?:style|stil)${B1}`),
  // "black and white", "sepia" for the whole picture
  rule(
    `${B0}(?:make|turn|render|draw|paint|redraw|zeichne|male|mach(?:e)?|verwandle)\\s+${WHOLE}\\s+(?:all\\s+|completely\\s+|fully\\s+|ganz\\s+)?((?:in\\s+|to\\s+|into\\s+)?${COLOUR_LOOK}${B1})`,
    1,
  ),
  rule(`${B0}(?:in|im)\\s+${COLOUR_LOOK}${B1}${CLAUSE_END}`),
];

/** Words that carry no scene on their own: what is left of "please make page 4" once the look is gone. */
const FILLER = new Set(
  (
    "please bitte make made let lets let's it its this that these those the a an to be is are was were been " +
    "everything all whole entire look looks looking like draw drawn redraw paint painted render turn change " +
    "switch swap use try should could can you i we want would now instead also too and then only just more " +
    "very mach mache male zeichne es das die der den dem ein eine einen im in on at for of as into with " +
    "alles ganz ganze soll sollte doch mal nochmal neu wie als zu auf bei style stil art page pages picture " +
    "image book bild seite seiten buch cover illustration them sie ihn her him they on please go"
  ).split(/\s+/u),
);

function mergeSpans(spans: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: { start: number; end: number }[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

function tidy(text: string): string {
  return text
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([,;:])\s*([.!?])/gu, "$2")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^[\s,;:.\-–—]+/u, "")
    .replace(/[\s,;:\-–—]+$/u, "")
    .trim();
}

export function styleRequestIn(text: string): StyleRequest {
  const source = text ?? "";
  const spans: { start: number; end: number }[] = [];
  for (const { re, group } of RULES) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      if (match[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      const part = group ? match[group] : match[0];
      if (!part) continue;
      const start = match.index + match[0].lastIndexOf(part);
      spans.push({ start, end: start + part.length });
    }
  }
  if (spans.length === 0) return { phrases: [], onlyStyle: false, rest: source.trim() };

  const merged = mergeSpans(spans);
  const phrases = merged.map((span) => ({ text: source.slice(span.start, span.end), ...span }));
  let rest = "";
  let at = 0;
  for (const span of merged) {
    rest += source.slice(at, span.start);
    at = span.end;
  }
  rest += source.slice(at);
  const cleaned = tidy(rest);
  const content = (cleaned.toLowerCase().match(/\p{L}+/gu) ?? []).filter((word) => !FILLER.has(word));
  return { phrases, onlyStyle: content.length === 0, rest: cleaned };
}

/** The text without the parts that ask for another look. Only a look asked for: nothing is left. */
export function withoutStyleAsides(text: string): string {
  const request = styleRequestIn(text);
  if (request.phrases.length === 0) return text;
  return request.onlyStyle ? "" : request.rest;
}
