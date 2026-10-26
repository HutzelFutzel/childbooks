/**
 * The target-margin settings, on their own so `products.ts` can hold them in
 * {@link PricingSettings} without importing the pricing math (which imports it
 * back). The math lives in `targetMargin.ts`.
 */
import { BINDINGS, type Binding } from "../fulfillment/types";

/** What a target margin is measured on: ex-tax revenue kept, after print cost and fees. */
export interface TargetMargins {
  /** The margin every product is priced to, unless its binding says otherwise. */
  defaultPct: number;
  /** Per-binding overrides. A binding absent here uses {@link defaultPct}. */
  byBinding: Partial<Record<Binding, number>>;
}

export const DEFAULT_TARGET_MARGIN_PCT = 45;

export function createDefaultTargetMargins(): TargetMargins {
  return { defaultPct: DEFAULT_TARGET_MARGIN_PCT, byBinding: {} };
}

const clampPct = (n: number) => Math.max(0, Math.min(90, n));

export function normalizeTargetMargins(raw: unknown): TargetMargins {
  const def = createDefaultTargetMargins();
  const t = (raw ?? {}) as Partial<TargetMargins>;
  const byBinding: Partial<Record<Binding, number>> = {};
  if (t.byBinding && typeof t.byBinding === "object") {
    for (const [binding, pct] of Object.entries(t.byBinding)) {
      if (!(BINDINGS as readonly string[]).includes(binding)) continue;
      if (typeof pct === "number" && Number.isFinite(pct)) byBinding[binding as Binding] = clampPct(pct);
    }
  }
  return {
    defaultPct:
      typeof t.defaultPct === "number" && Number.isFinite(t.defaultPct) ? clampPct(t.defaultPct) : def.defaultPct,
    byBinding,
  };
}
