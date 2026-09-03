import type { Project } from "../../core/types";
import type { StudioStep } from "./studioSteps";
import { computeProgress, initialStep } from "./studioSteps";

export const STUDIO_DESTINATIONS = ["story", "style", "cast", "pages", "order"] as const;

export type StudioDestination = (typeof STUDIO_DESTINATIONS)[number];

export type StudioRoute =
  | { kind: "library" }
  | { kind: "project"; bookId: string; destination: StudioDestination | null }
  | { kind: "invalid" };

const BOOK_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function parseStudioPath(pathname: string): StudioRoute {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "studio") return { kind: "invalid" };
  if (segments.length === 1) return { kind: "library" };
  if (segments.length > 3) return { kind: "invalid" };

  let bookId: string;
  try {
    bookId = decodeURIComponent(segments[1]);
  } catch {
    return { kind: "invalid" };
  }
  if (!BOOK_ID.test(bookId)) return { kind: "invalid" };
  if (segments.length === 2) return { kind: "project", bookId, destination: null };

  const destination = segments[2];
  if (!STUDIO_DESTINATIONS.includes(destination as StudioDestination)) {
    return { kind: "project", bookId, destination: null };
  }
  return { kind: "project", bookId, destination: destination as StudioDestination };
}

export function studioPath(bookId: string, destination: StudioDestination): string {
  return `/studio/${encodeURIComponent(bookId)}/${destination}`;
}

export function defaultDestination(project: Project): StudioDestination {
  const step = initialStep(project);
  if (step === "story") return "story";
  if (step === "anchors") {
    return project.config.styleReady === false ? "style" : "cast";
  }
  if (step === "edit") return "pages";
  return "order";
}

export function destinationForStep(project: Project, step: StudioStep): StudioDestination {
  if (step === "story") return "story";
  if (step === "anchors") {
    return project.config.styleReady === false ? "style" : "cast";
  }
  if (step === "edit") return "pages";
  return "order";
}

export function stepForDestination(destination: StudioDestination): StudioStep {
  if (destination === "story") return "story";
  if (destination === "style" || destination === "cast") return "anchors";
  if (destination === "pages") return "edit";
  return "order";
}

export function destinationUnlocked(project: Project, destination: StudioDestination): boolean {
  const progress = computeProgress(project);
  if (destination === "style" || destination === "cast") return progress.anchors.unlocked;
  return progress[stepForDestination(destination)].unlocked;
}

export function fallbackDestination(
  project: Project,
  requested: StudioDestination,
): StudioDestination {
  if (destinationUnlocked(project, requested)) return requested;
  if (project.stage === "setup") return "story";
  if (project.config.styleReady === false) return "style";
  return defaultDestination(project);
}
