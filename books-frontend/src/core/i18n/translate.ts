/**
 * The shape of a `next-intl` translator, for functions that take one as an
 * argument.
 *
 * Plenty of the copy in checkout is chosen by a pure helper — which binding
 * doesn't fit, which perk a plan grants — and those helpers can't call
 * `useTranslations` themselves. Passing the translator in keeps them pure and
 * testable while moving the words into the catalogue.
 *
 * Deliberately narrower than the real signature: values are limited to the
 * primitives an ICU message can interpolate. `useTranslations()` accepts more
 * (React nodes, for `t.rich`), and a function accepting more is assignable to
 * this, so the narrowing costs nothing at the call site and stops a helper from
 * quietly returning markup where a string is expected.
 */
export type Translate = (
  key: string,
  values?: Record<string, string | number | Date>,
) => string;

/** A translator that can also be asked whether a key exists. */
export type Translator = Translate & { has: (key: string) => boolean };

/**
 * A catalogue string, falling back to a value from code when the key is absent.
 *
 * Used where customer-facing copy sits in a domain constant that has to stay
 * there for another reason — binding nouns and variant labels also seed the
 * admin product catalogue — so the English cannot simply be deleted. The
 * catalogue is authoritative; the constant covers the gap between a provider
 * adding an option and us describing it.
 *
 * This is a safety net, not a strategy: `yarn check:locales` fails when a known
 * binding, axis or option has no key, so a reader never silently gets English
 * inside an otherwise translated page.
 */
export function translated(t: Translator, key: string, fallback: string): string {
  return t.has(key) ? t(key) : fallback;
}
