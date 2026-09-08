import type { DisplaySpread, Entry } from "./spreadModel";

/** Stable editor modes. Features attach to a surface instead of adding flows. */
export type StudioSurfaceKind =
  | "front-cover"
  | "back-cover"
  | "page"
  | "spread";

export type SurfaceCapability =
  | "artwork"
  | "cast"
  | "scene"
  | "text"
  | "elements"
  | "history"
  | "cover-text"
  | "branding"
  | "text-only";

export interface SurfaceDefinition {
  kind: StudioSurfaceKind;
  noun: string;
  section: "Cover" | "Pages" | "Back cover";
  createArtworkLabel: string;
  customizeArtworkLabel: string;
  capabilities: readonly SurfaceCapability[];
}

const SHARED_ART_CAPABILITIES = [
  "artwork",
  "cast",
  "scene",
  "text",
  "elements",
  "history",
] as const satisfies readonly SurfaceCapability[];

export const SURFACE_DEFINITIONS: Record<StudioSurfaceKind, SurfaceDefinition> = {
  "front-cover": {
    kind: "front-cover",
    noun: "Front cover",
    section: "Cover",
    createArtworkLabel: "Create cover",
    customizeArtworkLabel: "Customize cover",
    capabilities: [...SHARED_ART_CAPABILITIES, "cover-text"],
  },
  "back-cover": {
    kind: "back-cover",
    noun: "Back cover",
    section: "Back cover",
    createArtworkLabel: "Create back cover",
    customizeArtworkLabel: "Customize back cover",
    capabilities: [...SHARED_ART_CAPABILITIES, "cover-text", "branding"],
  },
  page: {
    kind: "page",
    noun: "Page",
    section: "Pages",
    createArtworkLabel: "Illustrate page",
    customizeArtworkLabel: "Customize illustration",
    capabilities: [...SHARED_ART_CAPABILITIES, "text-only"],
  },
  spread: {
    kind: "spread",
    noun: "Spread",
    section: "Pages",
    createArtworkLabel: "Illustrate spread",
    customizeArtworkLabel: "Customize illustration",
    capabilities: [...SHARED_ART_CAPABILITIES, "text-only"],
  },
};

export interface ActiveSurface {
  definition: SurfaceDefinition;
  label: string;
  entries: { entry: Entry; label: string }[];
}

/** Describe the open canvas once; toolbar and inspector consume the same model. */
export function activeSurfaceFor(disp: DisplaySpread): ActiveSurface {
  const entries =
    disp.kind === "full"
      ? [{ entry: disp.entry, label: disp.label }]
      : [disp.left, disp.right].flatMap((side) =>
          side.kind === "page" ? [{ entry: side.entry, label: side.label }] : [],
        );

  const kind: StudioSurfaceKind =
    disp.cover === "front"
      ? "front-cover"
      : disp.cover === "back"
        ? "back-cover"
        : disp.kind === "full" || entries.length > 1
          ? "spread"
          : "page";

  return {
    definition: SURFACE_DEFINITIONS[kind],
    label: disp.label,
    entries,
  };
}
