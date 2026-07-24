"use client";

import { useMemo } from "react";
import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from "lucide-react";
import type { PublicPlan } from "../../../core/config/plans";
import type { PricingSettings, ProductDefinition } from "../../../core/config/products";
import type { SparksConfig } from "../../../core/config/sparks";
import { economicFindings, type EconomicFinding } from "../../../core/config/configHealth";
import { useAdminTab } from "../adminTabStore";

/**
 * Live economic health check across ALL pricing configs (catalog, packs,
 * plans, sparks, financial settings). Because single edits can combine into
 * money-losing setups only visible across documents, this panel re-runs the
 * whole-catalog check against the live config docs and surfaces:
 * errors (out-of-pocket losses), warnings (broken promises / thin margins)
 * and info (deliberate giveaways). Rendered on the Business overview and the
 * Discount planner so a bad save is visible within seconds.
 */
export function ConfigHealthPanel({
  settings,
  sparks,
  products,
  plans,
}: {
  settings: PricingSettings;
  sparks: SparksConfig;
  products: ProductDefinition[];
  plans: PublicPlan[];
}) {
  const setConfigTab = useAdminTab((s) => s.setConfigTab);
  const openCatalog = useAdminTab((s) => s.openCatalog);

  const findings = useMemo(
    () => economicFindings({ settings, sparks, products, plans }),
    [settings, sparks, products, plans],
  );

  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-xs text-emerald-800">
        <ShieldCheck className="size-4 shrink-0" />
        <span>
          <span className="font-semibold">Config health: all clear.</span> No sale loses money for
          any buyer, and every item holds your {settings.minMarginPct}% margin floor.
        </span>
      </div>
    );
  }

  const goto = (f: EconomicFinding) => {
    switch (f.area) {
      case "print":
        openCatalog("print");
        break;
      case "ebook":
        openCatalog("ebook");
        break;
      case "pack":
        openCatalog("packs");
        break;
      case "plan":
        setConfigTab("memberships");
        break;
      case "discounts":
        setConfigTab("discounts");
        break;
    }
  };

  return (
    <div className="space-y-1.5">
      {findings.map((f, i) => (
        <button
          key={`${f.severity}-${i}`}
          type="button"
          onClick={() => goto(f)}
          className={`flex w-full items-start gap-2 rounded-xl border px-3.5 py-2.5 text-left text-xs transition hover:brightness-[0.98] ${
            f.severity === "error"
              ? "border-rose-200 bg-rose-50 text-rose-800"
              : f.severity === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-ink-100 bg-ink-50/60 text-ink-600"
          }`}
        >
          {f.severity === "error" ? (
            <AlertOctagon className="mt-0.5 size-4 shrink-0" />
          ) : f.severity === "warning" ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            <span className="font-semibold">{f.title}.</span> {f.detail}
          </span>
        </button>
      ))}
    </div>
  );
}
