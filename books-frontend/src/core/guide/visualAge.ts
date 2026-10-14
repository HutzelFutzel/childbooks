/**
 * When a change of age changes the picture.
 *
 * A portrait is drawn at an age. Turning two into three is a different child
 * (a toddler becomes a small girl), turning thirty-five into thirty-six is the
 * same grown-up. The book used to treat every change of age as a different
 * picture, so a birthday year on an adult made the portrait "out of date" and
 * held up the pages until it was drawn again, and nobody could tell the
 * reader why it mattered.
 *
 * This is the one rule for it. A shift matters when it is at least as big as
 * what a person of that age visibly changes in: months for a baby, half a year
 * for a toddler, a year for a child, two years for a teenager, a decade for an
 * adult. The younger of the two ages decides how sensitive to be, so going from
 * twelve to thirteen and from thirteen to twelve are judged the same.
 *
 * The browser and the server both ask whether a portrait is current (the pages
 * are not drawn from an out-of-date one), so this is a constant in code and not
 * an admin setting: two places reading two values would block a book on the
 * server that the browser calls ready.
 */

/** The ages a picture can be told apart by. Unknown parts are `null`. */
export interface AgeParts {
  age?: number | null;
  months?: number | null;
  /** The story's estimate, used only when no age was given. */
  visualYears?: number | null;
}

/**
 * How big a shift (in months) matters, by the younger age (in months) it
 * starts from. The first row whose `below` is above that age is the one used.
 */
export const AGE_SHIFT_RULES: readonly { below: number; shift: number }[] = [
  { below: 12, shift: 2 }, // a baby changes month by month
  { below: 36, shift: 6 }, // a toddler, half a year
  { below: 13 * 12, shift: 12 }, // a child, a year
  { below: 20 * 12, shift: 24 }, // a teenager, two years
  { below: Infinity, shift: 10 * 12 }, // an adult, a decade
];

/**
 * How old the picture should make them look, in months, or null when nothing
 * says. Months only matter while they are small: past three, whole years are
 * what a picture can show.
 */
export function apparentMonths(parts: AgeParts): number | null {
  const months = typeof parts.months === "number" ? parts.months : null;
  if (months !== null && months < 36) return months;
  const years =
    typeof parts.age === "number"
      ? parts.age
      : months !== null
        ? Math.floor(months / 12)
        : typeof parts.visualYears === "number"
          ? parts.visualYears
          : null;
  return years === null ? null : years * 12;
}

/** The age fields of a stored subject signature (`portraitInputs`), read as parts. */
export function ageOfSignature(signature: Record<string, unknown>): AgeParts {
  const visual = signature.visualAge;
  return {
    age: typeof signature.age === "number" ? signature.age : null,
    months: typeof signature.months === "number" ? signature.months : null,
    visualYears:
      visual && typeof visual === "object" && typeof (visual as { years?: unknown }).years === "number"
        ? (visual as { years: number }).years
        : null,
  };
}

/** The smallest shift that matters from this age, in months. */
export function ageShiftThreshold(startMonths: number): number {
  return (AGE_SHIFT_RULES.find((rule) => startMonths < rule.below) ?? AGE_SHIFT_RULES[AGE_SHIFT_RULES.length - 1]!).shift;
}

/**
 * Whether going from one age to the other is a different-looking person.
 * Knowing an age that was unknown (or the reverse) always is.
 */
export function ageShiftMatters(from: AgeParts, to: AgeParts): boolean {
  const a = apparentMonths(from);
  const b = apparentMonths(to);
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  const shift = Math.abs(a - b);
  return shift > 0 && shift >= ageShiftThreshold(Math.min(a, b));
}
