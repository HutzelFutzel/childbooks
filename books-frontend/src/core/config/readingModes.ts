/**
 * How a book gets read. Kept in its own module (rather than in the age catalog)
 * because both the audience profiles and the typography coefficients need it,
 * and neither should have to import the other to get it.
 *
 * WHICH bands offer a reading-mode choice is not decided here — it's a field on
 * each audience profile, so an admin can add a band that asks the question.
 */
export type ReadingModeId = "read-aloud" | "with-help" | "independent";

export interface ReadingModeDef {
  id: ReadingModeId;
  label: string;
  shortLabel: string;
}

export const READING_MODES: ReadingModeDef[] = [
  { id: "read-aloud", label: "Adult reads aloud", shortLabel: "Read aloud" },
  { id: "with-help", label: "Child reads with help", shortLabel: "With help" },
  { id: "independent", label: "Child reads independently", shortLabel: "Independent" },
];

export const READING_MODE_IDS = READING_MODES.map((m) => m.id);

export function isReadingModeId(value: unknown): value is ReadingModeId {
  return typeof value === "string" && READING_MODES.some((m) => m.id === value);
}

export function readingModeLabel(id: ReadingModeId | string | null | undefined): string {
  return READING_MODES.find((m) => m.id === id)?.label ?? "";
}
