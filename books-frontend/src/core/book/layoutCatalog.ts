/**
 * The one place anything asks "which layouts can this book use, and why not?".
 *
 * Three independent gates decide it — the plan the reader is on, the page size
 * they chose, and what the resolved image model can do — and they all funnel
 * through {@link layoutAvailability} so the picker, the studio and the server
 * give the same answer, with a reason a human can read.
 *
 * Availability never *hides* a layout for a model reason alone: a prompt-driven
 * region treatment degrades to its deterministic equivalent instead (see
 * `./treatments`). Only size, plan and an explicit admin switch can remove one.
 */
import type { BookProduct } from "../fulfillment/types";
import { bookSizeFromAspect, type BookSize } from "../config/options";
import type { PlanEntitlements } from "../config/plans";
import { layoutAllowed } from "../config/entitlements";
import type { ImageTier } from "../config/modelConfig";
import type { ImageModelCapabilities } from "../config/modelCapabilities";
import { nearestAspect } from "../config/modelCapabilities";
import {
  examplesForLayout,
  type LayoutExample,
  type LayoutsConfig,
} from "../config/layouts";
import {
  allBookLayouts,
  getBookLayout,
  type BookLayout,
  type CompositionMode,
  type LayoutRequirements,
} from "./layouts";
import { getTreatment, resolveTreatmentForModel } from "./treatments";

/** Stable key grouping products that share a physical trim (mirrors `trimKey`). */
export function productTrimKey(p: Pick<BookProduct, "trim">): string {
  return `${p.trim.widthIn}x${p.trim.heightIn}`;
}

/** A layout with its admin overlay applied — what the UI should actually show. */
export interface ResolvedLayout {
  layout: BookLayout;
  id: string;
  label: string;
  description: string;
  order: number;
  enabled: boolean;
  supportedModes: CompositionMode[];
  defaultMode: CompositionMode;
  requirements: LayoutRequirements;
  examples: LayoutExample[];
}

export type LayoutAvailability =
  | { ok: true }
  | { ok: false; reason: string };

/** Merge a layout's shipped definition with the admin overlay. */
export function resolveLayout(
  layout: BookLayout,
  config?: LayoutsConfig | null,
  shape?: BookSize,
): ResolvedLayout {
  const o = config?.overrides[layout.id];
  const allowedModes = o?.modes?.allowed?.filter((m) => layout.supportedModes.includes(m));
  const supportedModes = allowedModes?.length ? allowedModes : layout.supportedModes;
  const wantedDefault = o?.modes?.default;
  return {
    layout,
    id: layout.id,
    label: o?.label?.trim() || layout.label,
    description: o?.description?.trim() || layout.description,
    order: o?.order ?? 100,
    enabled: o?.enabled !== false,
    supportedModes,
    defaultMode:
      wantedDefault && supportedModes.includes(wantedDefault)
        ? wantedDefault
        : supportedModes.includes(layout.defaultMode)
          ? layout.defaultMode
          : supportedModes[0],
    requirements: mergeRequirements(layout.requirements, config, layout.id),
    examples: examplesForLayout(config, layout.id, shape),
  };
}

function mergeRequirements(
  base: LayoutRequirements | undefined,
  config: LayoutsConfig | null | undefined,
  layoutId: string,
): LayoutRequirements {
  const rule = config?.overrides[layoutId]?.sizes;
  if (!rule) return base ?? {};
  return {
    ...(base ?? {}),
    ...(rule.shapes ? { shapes: rule.shapes } : {}),
    ...(rule.trims ? { trims: rule.trims } : {}),
  };
}

/** Every layout with its overlay applied, in picker order. */
export function resolvedLayouts(
  config?: LayoutsConfig | null,
  shape?: BookSize,
): ResolvedLayout[] {
  return allBookLayouts()
    .map((l) => resolveLayout(l, config, shape))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function resolveLayoutById(
  id: string | undefined | null,
  config?: LayoutsConfig | null,
  shape?: BookSize,
): ResolvedLayout {
  return resolveLayout(getBookLayout(id), config, shape);
}

// ---- Gating ----------------------------------------------------------------

export interface AvailabilityInput {
  product: Pick<BookProduct, "trim" | "aspect">;
  entitlements?: PlanEntitlements | null;
  baseLayoutIds?: readonly string[];
  tier?: ImageTier;
  capabilities?: ImageModelCapabilities | null;
  mode?: CompositionMode;
  config?: LayoutsConfig | null;
}

/**
 * Can this layout be used for this book? Returns the first blocking reason in
 * plain language, so the picker can grey a card and say why rather than
 * silently hiding an option the reader may be looking for.
 */
export function layoutAvailability(
  resolved: ResolvedLayout,
  input: AvailabilityInput,
): LayoutAvailability {
  const { product, config } = input;

  if (!resolved.enabled) {
    return { ok: false, reason: "This layout isn't currently offered." };
  }

  // 1. Plan entitlement.
  if (resolved.layout.premium && input.entitlements && input.baseLayoutIds) {
    if (!layoutAllowed(input.entitlements, resolved.id, input.baseLayoutIds)) {
      return { ok: false, reason: "Available on a paid plan." };
    }
  }

  // 2. Quality tier, when an admin has switched it off for one.
  if (input.tier) {
    const tiers = config?.overrides[resolved.id]?.tiers;
    if (tiers && tiers[input.tier] === false) {
      return { ok: false, reason: "Not available at this image quality." };
    }
  }

  // 3. Page size — the explicit lists first, then the measured guards, which
  //    are the real reason and stay correct for trims that don't exist yet.
  const req = resolved.requirements;
  const trimKey = productTrimKey(product);
  if (req.trims?.deny?.includes(trimKey)) {
    return { ok: false, reason: "Not available at this book size." };
  }
  if (req.trims?.allow && !req.trims.allow.includes(trimKey)) {
    return { ok: false, reason: "Not available at this book size." };
  }
  if (req.shapes && !req.shapes.includes(bookSizeFromAspect(product.aspect))) {
    const list = req.shapes.join(" or ");
    return { ok: false, reason: `Designed for ${list} pages.` };
  }

  if (req.minTextColumnIn) {
    const narrowest = narrowestTextColumnIn(resolved, product);
    if (narrowest != null && narrowest < req.minTextColumnIn) {
      return {
        ok: false,
        reason: `The text column would be only ${narrowest.toFixed(1)}″ wide on this page size.`,
      };
    }
  }

  // 4. Composition mode feasibility.
  const mode = input.mode ?? resolved.defaultMode;
  if (!resolved.supportedModes.includes(mode)) {
    return { ok: false, reason: "This layout doesn't support the selected art placement." };
  }
  if (mode === "inset-art" && input.capabilities) {
    const check = insetArtFit(resolved, product, input.capabilities);
    if (check) return check;
  }

  return { ok: true };
}

/** The narrowest text column this layout produces on the given trim, in inches. */
export function narrowestTextColumnIn(
  resolved: ResolvedLayout,
  product: Pick<BookProduct, "trim">,
): number | null {
  const spec = resolved.layout.spec;
  if (!spec) return null;
  let narrowest: number | null = null;
  for (const [side, slots] of Object.entries(spec.slots)) {
    // A spread surface is two pages wide, so the same fraction is twice the inches.
    const surfaceIn = product.trim.widthIn * (side === "spread" ? 2 : 1);
    for (const slot of slots) {
      if (slot.role !== "text") continue;
      const inches = slot.rect.w * surfaceIn;
      if (narrowest == null || inches < narrowest) narrowest = inches;
    }
  }
  return narrowest;
}

/** Whether inset art on this trim lands on a shape the model can produce. */
function insetArtFit(
  resolved: ResolvedLayout,
  product: Pick<BookProduct, "trim" | "aspect">,
  caps: ImageModelCapabilities,
): LayoutAvailability | null {
  const spec = resolved.layout.spec;
  if (!spec) return null;
  const req = resolved.requirements;
  // Approximate the art rect from the widest text slot on a single page: the
  // exact rect needs a page count for the gutter, which the picker doesn't have.
  const slots = spec.slots.right.filter((s) => s.role === "text");
  const textWidth = slots.reduce((sum, s) => sum + s.rect.w, 0);
  const artWidth = Math.max(0.05, 1 - textWidth);
  const artAspect = artWidth * product.aspect;

  if (req.minArtAspect != null && artAspect < req.minArtAspect) {
    return { ok: false, reason: "The artwork would be too narrow at this book size." };
  }
  if (req.maxArtAspect != null && artAspect > req.maxArtAspect) {
    return { ok: false, reason: "The artwork would be too wide at this book size." };
  }
  const { error } = nearestAspect(caps, artAspect);
  if (error > 0.25) {
    return {
      ok: false,
      reason: "The selected image model can't produce artwork of that shape.",
    };
  }
  return null;
}

// ---- Health ----------------------------------------------------------------

export interface LayoutFinding {
  severity: "error" | "warning" | "info";
  layoutId?: string;
  title: string;
  detail: string;
}

/**
 * Cross-check the admin overlay against the trims actually sold.
 *
 * Each individual setting is plausible on its own; the damage comes from
 * combinations — a shape restriction plus a readability floor that together
 * leave a layout available nowhere, or the last enabled layout being switched
 * off. Run live in the admin tab so a bad combination is visible immediately
 * rather than discovered by a reader who can't pick anything.
 */
export function layoutFindings(
  config: LayoutsConfig | null | undefined,
  products: Pick<BookProduct, "trim" | "aspect" | "sku">[],
): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const all = resolvedLayouts(config);
  const trims = dedupeByTrim(products);

  const usable = all.filter((l) =>
    trims.some((p) => layoutAvailability(l, { product: p, config }).ok),
  );
  if (usable.length === 0) {
    findings.push({
      severity: "error",
      title: "No layout is available to readers",
      detail:
        "Every layout is either switched off or excluded on all the book sizes you sell, so the Design step would have nothing to offer.",
    });
  }

  for (const layout of all) {
    if (!layout.enabled) {
      findings.push({
        severity: "info",
        layoutId: layout.id,
        title: `“${layout.label}” is switched off`,
        detail: "Readers can't choose it. Existing books keep the layout they were made with.",
      });
      continue;
    }

    const available = trims.filter((p) => layoutAvailability(layout, { product: p, config }).ok);
    if (available.length === 0) {
      findings.push({
        severity: "warning",
        layoutId: layout.id,
        title: `“${layout.label}” is offered but fits no book size`,
        detail:
          "Its size rules or the readability floor rule it out on every trim you sell, so it never appears.",
      });
    } else if (available.length < trims.length) {
      const missing = trims.length - available.length;
      findings.push({
        severity: "info",
        layoutId: layout.id,
        title: `“${layout.label}” isn't offered on ${missing} of ${trims.length} book sizes`,
        detail: "Readers on those sizes see it greyed out with the reason.",
      });
    }

    // Treatment overrides that name something the catalog doesn't have would
    // silently fall back to the default, which looks like the setting being
    // ignored rather than wrong.
    const slots = config?.overrides[layout.id]?.slots ?? {};
    for (const [slotId, override] of Object.entries(slots)) {
      if (override.treatmentId && getTreatment(override.treatmentId).id !== override.treatmentId) {
        findings.push({
          severity: "warning",
          layoutId: layout.id,
          title: `Unknown treatment on “${layout.label}”`,
          detail: `Slot “${slotId}” asks for “${override.treatmentId}”, which no longer exists — the default is used instead.`,
        });
      }
    }

    if (layout.examples.length === 0) {
      findings.push({
        severity: "info",
        layoutId: layout.id,
        title: `“${layout.label}” has no showcase image`,
        detail:
          "The picker falls back to a schematic. A real page from the same story makes layouts genuinely comparable.",
      });
    }
  }

  return findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

function severityRank(s: LayoutFinding["severity"]): number {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}

function dedupeByTrim<T extends Pick<BookProduct, "trim">>(products: T[]): T[] {
  const seen = new Map<string, T>();
  for (const p of products) {
    const key = productTrimKey(p);
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}

/**
 * The treatment that will actually be applied to a layout's text regions, once
 * the model's negative-space reliability is taken into account. A weak model
 * gets the deterministic fallback rather than losing the layout.
 */
export function effectiveTreatmentId(
  resolved: ResolvedLayout,
  slotId: string,
  input?: { capabilities?: ImageModelCapabilities | null; config?: LayoutsConfig | null },
): string {
  const slot = resolved.layout.spec
    ? Object.values(resolved.layout.spec.slots)
        .flat()
        .find((s) => s.id === slotId)
    : undefined;
  const override = input?.config?.overrides[resolved.id]?.slots?.[slotId]?.treatmentId;
  const base = getTreatment(override ?? slot?.treatmentId);
  const caps = input?.capabilities;
  if (!caps) return base.id;
  return resolveTreatmentForModel(base, caps.negativeSpaceControl).id;
}
