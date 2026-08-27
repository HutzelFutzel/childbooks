/**
 * Pseudo-localization: the English catalogue rendered as accented, padded,
 * bracketed text.
 *
 *   "Turn a story into a printed picture book."
 *   → "⟦Ţüřñ á šţóřý íñţó á ρříñţéð ρíçţüřé βóóķ.··············⟧"
 *   "{minutes} min read"
 *   → "⟦{minutes} ɱíñ řéáð···⟧"
 *
 * It finds three classes of bug that no automated check can, and it finds them
 * before a single word has been translated:
 *
 *   - **Un-extracted strings.** Anything still rendering plain English under the
 *     pseudo-locale is hardcoded. This is the whole reason it exists during the
 *     extraction phase.
 *   - **Layout that can't take a longer translation.** The padding simulates the
 *     ~35% that German runs over English, so an overflowing hero headline shows
 *     up now rather than on the day German copy lands.
 *   - **Truncation.** The brackets are the first and last characters, so a
 *     clipped or ellipsized string is visible as a missing bracket.
 *
 * Generated at request time from `en.json` rather than checked in as a
 * catalogue: a generated file is a file that drifts, and this one would need
 * regenerating on every copy change.
 */

/** Latin look-alikes. Deliberately still readable — the point is to spot English, not to obfuscate it. */
const ACCENTS: Readonly<Record<string, string>> = {
  a: "á", b: "β", c: "ç", d: "ð", e: "é", f: "ƒ", g: "ĝ", h: "ĥ", i: "í", j: "ĵ",
  k: "ķ", l: "ĺ", m: "ɱ", n: "ñ", o: "ó", p: "ρ", q: "q", r: "ř", s: "š", t: "ţ",
  u: "ü", v: "ν", w: "ŵ", x: "х", y: "ý", z: "ž",
  A: "Á", B: "Β", C: "Ç", D: "Ð", E: "É", F: "Ƒ", G: "Ĝ", H: "Ĥ", I: "Í", J: "Ĵ",
  K: "Ķ", L: "Ĺ", M: "Ϻ", N: "Ñ", O: "Ó", P: "Ρ", Q: "Q", R: "Ř", S: "Š", T: "Ţ",
  U: "Ü", V: "Ν", W: "Ŵ", X: "Х", Y: "Ý", Z: "Ž",
};

/** How much longer than English to make each string, as a fraction of its length. */
const EXPANSION = 0.35;

const OPEN = "⟦";
const CLOSE = "⟧";

/**
 * Accent one string, leaving ICU placeholders and markup tags untouched.
 *
 * Substitution is applied only at brace depth zero. Tracking depth rather than
 * parsing ICU means a nested message —
 * `{count, plural, one {# book} other {# books}}` — passes through whole: the
 * literal words inside a plural branch don't get accented, which loses a little
 * coverage and cannot possibly corrupt the message. A pseudo-locale that breaks
 * `intl-messageformat` at runtime would be worse than useless, because every
 * page it touched would throw instead of showing the layout problem it exists
 * to reveal.
 */
function accent(text: string): string {
  let out = "";
  let depth = 0;
  let inTag = false;

  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === "<") inTag = true;
    else if (depth === 0 && ch === ">") inTag = false;

    const substitutable = depth === 0 && !inTag && ch !== ">" && ch !== "<";
    out += substitutable ? (ACCENTS[ch] ?? ch) : ch;
  }

  return out;
}

/** Visible padding, sized from the *translatable* length so a placeholder-heavy string isn't over-padded. */
function pad(text: string): string {
  const translatable = text.replace(/\{[^{}]*\}/g, "").length;
  return "·".repeat(Math.max(2, Math.round(translatable * EXPANSION)));
}

/** One message, accented, padded, and bracketed. */
export function pseudoLocalizeMessage(message: string): string {
  return `${OPEN}${accent(message)}${pad(message)}${CLOSE}`;
}

/** Arbitrarily nested message catalogue, as loaded from a `messages/*.json`. */
export type MessageTree = { [key: string]: string | MessageTree };

/**
 * Pseudo-localize a whole catalogue, preserving its shape.
 *
 * Non-string, non-object leaves are dropped rather than coerced: a number in a
 * catalogue is a mistake, and `yarn check:locales` reports it as one.
 */
export function pseudoLocalize(messages: MessageTree): MessageTree {
  const out: MessageTree = {};
  for (const [key, value] of Object.entries(messages)) {
    if (typeof value === "string") out[key] = pseudoLocalizeMessage(value);
    else if (value && typeof value === "object") out[key] = pseudoLocalize(value);
  }
  return out;
}
