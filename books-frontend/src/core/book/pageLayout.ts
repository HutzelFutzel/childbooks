/**
 * The single place a page's layout plan is computed.
 *
 * The design editor (to seed text boxes), the illustration pipeline (to compile
 * prompt facts) and the image request (to choose dimensions) all call this, so
 * there is exactly one answer to "where does the text go on this page" and it
 * accounts for the real trim, safety margin and gutter of the chosen product.
 */
import { bookProductForConfig, formatCapabilitiesForProject } from "../book";
import type { Project } from "../types";
import { computePageGuides, type BindingSide } from "./format";
import {
  getBookLayout,
  type CompositionMode,
  type LayoutPlan,
  type PageSide,
} from "./layouts";

/** Which edge binds into the spine for a page on the given side. */
export function bindingSideFor(side: PageSide): BindingSide {
  if (side === "spread") return "center";
  // A recto (right-hand page) binds on its left edge, and vice versa.
  return side === "right" ? "left" : "right";
}

/**
 * The composition mode in force for a project: the user's choice when the
 * active layout supports it, otherwise the layout's own default.
 */
export function compositionModeForProject(project: Project): CompositionMode {
  const layout = getBookLayout(project.config.layoutId);
  const chosen = project.config.compositionMode;
  return chosen && layout.supportedModes.includes(chosen) ? chosen : layout.defaultMode;
}

export interface PageLayoutInput {
  side: PageSide;
  isCover?: boolean;
  textLength?: number;
  /** Override the project's mode (used by previews). */
  mode?: CompositionMode;
}

export function planPageLayout(project: Project, input: PageLayoutInput): LayoutPlan {
  const layout = getBookLayout(project.config.layoutId);
  const product = bookProductForConfig(project.config);
  const caps = formatCapabilitiesForProject(project);
  const spread = input.side === "spread";
  const { safe } = computePageGuides({
    caps,
    spread,
    // Covers have no gutter, so they use the plain margin on both edges.
    bindingSide: input.isCover ? "center" : bindingSideFor(input.side),
  });
  return layout.plan({
    side: input.side,
    safe,
    aspect: spread ? product.aspect * 2 : product.aspect,
    trim: product.trim,
    isCover: input.isCover ?? false,
    mode: input.mode ?? compositionModeForProject(project),
    textLength: input.textLength,
  });
}
