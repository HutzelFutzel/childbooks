/**
 * The single place a page's layout plan is computed.
 *
 * The design editor (to seed text boxes), the illustration pipeline (to compile
 * prompt facts) and the image request (to choose dimensions) all call this, so
 * there is exactly one answer to "where does the text go on this page" and it
 * accounts for the real trim, safety margin and gutter of the chosen product.
 */
import { bookProductForConfig, formatCapabilitiesForProject } from "../book";
import type { LayoutsConfig } from "../config/layouts";
import type { Project } from "../types";
import { computePageGuides, type BindingSide } from "./format";
import { resolveLayoutById } from "./layoutCatalog";
import {
  type CompositionMode,
  type LayoutPlan,
  type PageSide,
} from "./layouts";
import { getTreatment } from "./treatments";

/** Which edge binds into the spine for a page on the given side. */
export function bindingSideFor(side: PageSide): BindingSide {
  if (side === "spread") return "center";
  // A recto (right-hand page) binds on its left edge, and vice versa.
  return side === "right" ? "left" : "right";
}

/**
 * The composition mode in force for a project: the user's choice when the
 * (possibly admin-overlaid) layout supports it, otherwise the layout's default.
 */
export function compositionModeForProject(
  project: Project,
  layoutsConfig?: LayoutsConfig | null,
): CompositionMode {
  const resolved = resolveLayoutById(project.config.layoutId, layoutsConfig);
  const chosen = project.config.compositionMode;
  return chosen && resolved.supportedModes.includes(chosen)
    ? chosen
    : resolved.defaultMode;
}

export interface PageLayoutInput {
  side: PageSide;
  isCover?: boolean;
  textLength?: number;
  /** Override the project's mode (used by previews). */
  mode?: CompositionMode;
  /** Admin overlay: treatments and allowed modes. */
  layoutsConfig?: LayoutsConfig | null;
}

function applySlotTreatmentOverrides(
  plan: LayoutPlan,
  layoutsConfig: LayoutsConfig | null | undefined,
): LayoutPlan {
  const slots = layoutsConfig?.overrides[plan.layoutId]?.slots;
  if (!slots) return plan;
  return {
    ...plan,
    slots: plan.slots.map((slot) => {
      const treatmentId = slots[slot.id]?.treatmentId;
      if (!treatmentId) return slot;
      return { ...slot, treatmentId, treatment: getTreatment(treatmentId) };
    }),
  };
}

export function planPageLayout(project: Project, input: PageLayoutInput): LayoutPlan {
  const resolved = resolveLayoutById(project.config.layoutId, input.layoutsConfig);
  const product = bookProductForConfig(project.config);
  const caps = formatCapabilitiesForProject(project);
  const spread = input.side === "spread";
  const { safe } = computePageGuides({
    caps,
    spread,
    // Covers have no gutter, so they use the plain margin on both edges.
    bindingSide: input.isCover ? "center" : bindingSideFor(input.side),
  });
  const requested = input.mode ?? compositionModeForProject(project, input.layoutsConfig);
  const mode = resolved.supportedModes.includes(requested)
    ? requested
    : resolved.defaultMode;
  const plan = resolved.layout.plan({
    side: input.side,
    safe,
    aspect: spread ? product.aspect * 2 : product.aspect,
    trim: product.trim,
    isCover: input.isCover ?? false,
    mode,
    textLength: input.textLength,
  });
  return applySlotTreatmentOverrides(plan, input.layoutsConfig);
}
