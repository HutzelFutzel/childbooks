/**
 * A stored estimate the reader confirmed with one tap.
 *
 * The button names what will be drawn and "about N Sparks"; the quote is that
 * promise written down. It lists its units, what each may cost at most, and when
 * it expires. The worker settles every unit against its own number and never
 * above it, and consumes each unit once — so a reload, a double tap or a return
 * URL cannot start or charge the same unit twice.
 *
 * One quote can back several jobs (Draw the book runs the reference sheets, then
 * the pages). Consumption is per unit for that reason.
 */
import type { ImageActionId } from "../ai/actions";
import type { CostSampleKind } from "../config/imageCostStats";
import type { ImageTier } from "../config/modelConfig";

export type GenerationQuotePurpose = "portraits" | "book" | "redraw";

export interface GenerationQuoteUnit {
  /** The task id it will run as: a cast member id, anchor id, spread id or cover id. */
  id: string;
  action: ImageActionId;
  kind: CostSampleKind;
  /** Reference images the render will send (`referencePlan`). Absent prices from every count. */
  refs?: number;
  /** Server-set: this unit is its slot's first render and carries the print-prep surcharge. */
  prep?: boolean;
}

export interface GenerationQuote {
  id: string;
  projectId: string;
  purpose: GenerationQuotePurpose;
  tier: ImageTier;
  /** Hash of the prices and models the numbers came from. */
  configRevision: string;
  units: GenerationQuoteUnit[];
  /** Settlement cap per {@link quoteUnitKey}. */
  byKey: Record<string, number>;
  /** Which `byKey` entry each unit settles against, by unit id. */
  unitKeys?: Record<string, string>;
  /**
   * The share of a `byKey` price that is the print-prep surcharge, for keys that
   * carry it. Settlement drops it when the slot turns out to be paid already.
   */
  prepByKey?: Record<string, number>;
  maximumSparks: number;
  balanceBefore: number;
  balanceAfter: number;
  issuedAt: number;
  expiresAt: number;
  /** Server-written: which job consumed each unit. */
  consumed?: Record<string, string>;
}

/** How long a confirmed estimate stays valid, including a trip to buy Sparks or sign up. */
export const GENERATION_QUOTE_TTL_MS = 30 * 60_000;

/**
 * Same key the worker settles against (`functions/src/jobs.ts` → `quoteKey`).
 * `group` is the reference-count group the unit was priced in, when known.
 */
export function quoteUnitKey(action: ImageActionId, kind: CostSampleKind, group?: string): string {
  const base = kind === "edit" ? `${action}:edit` : action;
  return group ? `${base}@r${group}` : base;
}

/** The `byKey` entry one unit of this quote settles against. */
export function quoteKeyForUnit(quote: Pick<GenerationQuote, "unitKeys">, unit: GenerationQuoteUnit): string {
  return quote.unitKeys?.[unit.id] ?? quoteUnitKey(unit.action, unit.kind);
}

export function quoteUnitIds(quote: Pick<GenerationQuote, "units">): string[] {
  return quote.units.map((unit) => unit.id);
}

/** Whether a quote still covers exactly these units of this book. */
export function quoteIsCurrent(
  quote: GenerationQuote,
  args: {
    projectId: string;
    units: readonly Pick<GenerationQuoteUnit, "id" | "action" | "kind" | "refs">[];
    now?: number;
  },
): boolean {
  if (quote.projectId !== args.projectId) return false;
  if (quote.expiresAt <= (args.now ?? Date.now())) return false;
  const line = (u: Pick<GenerationQuoteUnit, "id" | "action" | "kind" | "refs">) =>
    `${u.id}|${quoteUnitKey(u.action, u.kind)}|${u.refs ?? ""}`;
  const want = [...args.units].map(line).sort();
  const have = quote.units.map(line).sort();
  return JSON.stringify(want) === JSON.stringify(have);
}

/**
 * The estimate as the button says it: "about 40", or "about 40–55" when the
 * range is wide. The top is always the quote's maximum.
 */
export function quoteRange(low: number, high: number): { low: number; high: number; wide: boolean } {
  const top = Math.max(0, Math.ceil(high));
  const bottom = Math.max(0, Math.min(top, Math.floor(low)));
  return { low: bottom, high: top, wide: top > 0 && bottom < top * 0.8 };
}
