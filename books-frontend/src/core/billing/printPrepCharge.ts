/**
 * Which renders carry the print-prep surcharge — shared by the studio's price
 * chip and the server's quote, so the number shown is the number charged.
 *
 * A page or cover slot pays for its print preparation once: on the first render
 * that gives it artwork. The server also keeps a ledger of paid slots
 * (`users/{uid}/printPrepSlots`), so deleting a page's art and drawing it again
 * doesn't charge twice. Books drawn before the surcharge existed are never
 * charged for slots that already have artwork.
 */
import type { ImageActionId } from "../ai/actions";
import { allVersions } from "../versioning";
import type { Project } from "../types";

/** The renders whose output is upscaled when the book is printed. */
export function isPrintPrepAction(action: string): action is Extract<ImageActionId, "pageIllustration" | "coverIllustration"> {
  return action === "pageIllustration" || action === "coverIllustration";
}

/** Whether a slot (spread id or cover id) already holds artwork in this book. */
export function slotHasArt(project: Pick<Project, "illustrations"> | null | undefined, slotId: string): boolean {
  const tree = project?.illustrations?.[slotId];
  if (!tree?.nodes) return false;
  return allVersions(tree).some((node) => Boolean((node.content as { blobId?: string } | undefined)?.blobId));
}

const PREP_SUFFIX = "+prep";

/** The quote key of a unit that carries the surcharge. */
export function withPrintPrepKey(key: string): string {
  return key.endsWith(PREP_SUFFIX) ? key : `${key}${PREP_SUFFIX}`;
}

export function keyCarriesPrintPrep(key: string | undefined): boolean {
  return Boolean(key?.endsWith(PREP_SUFFIX));
}
