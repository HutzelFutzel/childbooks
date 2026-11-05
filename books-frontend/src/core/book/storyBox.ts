/**
 * The text box that carries a page's own words.
 *
 * A page's words live in two places: `spread.text` in the page plan, and one
 * text box in the design layer that shows them. They are written together
 * (`pagePlan.setPageWords`), so what is printed and what the plan says agree.
 */
import type { PageDesign, TextBox } from "../design";

/** The story text box of a page, when there is exactly one the reader could mean. */
export function storyBoxOf(page: PageDesign | undefined): TextBox | "none" | "several" {
  const boxes = (page?.textBoxes ?? []).filter(
    (box) => !box.hidden && !box.locked && (box.role === "story-body" || (!box.role && Boolean(box.slotId))),
  );
  if (boxes.length === 0) return "none";
  return boxes.length > 1 ? "several" : boxes[0]!;
}
