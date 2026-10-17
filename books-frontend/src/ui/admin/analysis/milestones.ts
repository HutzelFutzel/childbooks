import type { ProjectMilestone } from "../../../state/adminProjectsStore";

/**
 * The lifecycle stages a book passes, in order. Shared by the funnel and the
 * milestone filters so they can't drift apart.
 *
 * `guideOnly` stages exist in the guided studio and have no counterpart in the
 * wizard — a wizard book can never carry them, so a comparison renders "n/a" for
 * it rather than a 0% that would read as "the wizard loses everyone here".
 */
export const MILESTONES: { key: ProjectMilestone; label: string; guideOnly?: boolean }[] = [
  { key: "created", label: "Started" },
  { key: "setupLocked", label: "Setup locked", guideOnly: true },
  { key: "storyDrafted", label: "Story" },
  { key: "pagesPlanned", label: "Pages planned" },
  { key: "castStarted", label: "Cast" },
  { key: "pagesStarted", label: "Pages" },
  { key: "coverDone", label: "Cover" },
  { key: "finished", label: "Finished" },
  { key: "previewed", label: "Order screen" },
  { key: "checkoutStarted", label: "Checkout" },
  { key: "ordered", label: "Ordered" },
];
