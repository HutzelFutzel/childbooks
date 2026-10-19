/**
 * Ready-made pages for the blank space a printed book has anyway.
 *
 * A binding that works in sheets of four turns an 18-page story into 20 printed
 * pages; those spare pages are blank by default and cost the customer nothing to
 * ignore. These templates let them put the space to use in one click — the
 * pages most children's books carry in their front and back matter.
 *
 * `front` pages belong before the story, `back` pages after it. Nothing here
 * ever lands between story pages.
 */
export interface PageTemplate {
  id: "dedication" | "belongs" | "drawing" | "notes";
  label: string;
  position: "front" | "back";
  text: string;
}

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  { id: "dedication", label: "Dedication", position: "front", text: "For you,\nwith all my love." },
  {
    id: "belongs",
    label: "This book belongs to…",
    position: "front",
    text: "This book belongs to\n\n______________________",
  },
  {
    id: "drawing",
    label: "Drawing page",
    position: "back",
    text: "Your turn!\nDraw your favorite part of the story here.",
  },
  { id: "notes", label: "Notes & memories", position: "back", text: "Our favorite moments\n\n" },
];

/**
 * Front matter shifts every later page by one, which would push a double-page
 * spread onto the wrong side of the fold; so it is only offered for books
 * without one. Back matter is always safe.
 */
export function frontMatterIsSafe(spreads: readonly { kind: string }[]): boolean {
  return !spreads.some((s) => s.kind === "spread");
}
