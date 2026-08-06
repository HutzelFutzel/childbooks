import type { ProjectMilestone } from "../../../state/adminProjectsStore";

/**
 * The lifecycle stages a book passes, in order. Shared by the funnel and the
 * milestone filters so they can't drift apart.
 */
export const MILESTONES: { key: ProjectMilestone; label: string }[] = [
  { key: "created", label: "Started" },
  { key: "storyDrafted", label: "Story" },
  { key: "castStarted", label: "Cast" },
  { key: "pagesStarted", label: "Pages" },
  { key: "coverDone", label: "Cover" },
  { key: "ordered", label: "Ordered" },
];
