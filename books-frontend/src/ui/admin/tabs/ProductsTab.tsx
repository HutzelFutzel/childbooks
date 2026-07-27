"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Layers,
  Loader2,
  Package,
  Plus,
  Ruler,
  Sparkles,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import {
  FULFILLMENT_PROVIDERS,
  PROVIDER_ENVS,
  PROVIDER_LABELS,
  SUPPORTED_MARKETS,
  createDefaultProduct,
  productAccessOf,
  verificationCoversPages,
  verificationFor,
  type GeoPolicy,
  type ProductAccess,
  type ProductDefinition,
  type ProductsConfig,
  type ProviderEnv,
  type ShippingFallbackRow,
} from "../../../core/config/products";
import { isDestinationAllowed } from "../../../core/config/productMath";
import { countryFlag, countryLabel } from "../../../core/analytics/markets";
import { bookMediaKey, optionMediaKey } from "../../../core/config/catalogMedia";
import { BINDINGS, FINISHES } from "../../../core/fulfillment/types";
import {
  isOfferable,
  productErrors,
  saveBlockingIssues,
  validateProduct,
  type ProductIssue,
} from "../../../core/config/productValidation";
import {
  BINDING_BY_CODE,
  SKU_AXES,
  composeSku,
  defaultSkuParts,
  isChoiceAxis,
  parseSku,
  parseTrimCode,
  trimCode,
  type SkuAxis,
  type SkuAxisId,
  type SkuParts,
} from "../../../core/fulfillment/lulu/skuAxes";
import {
  useAppConfigStore,
  type CatalogCalibrationRun,
  type SkuMatrixEntry,
} from "../../../state/appConfigStore";
import { useAdminHealth } from "../../../state/adminHealthStore";
import { useAdminTab } from "../adminTabStore";
import {
  Disclosure,
  Grid,
  ImpactNote,
  NumberField,
  Section,
  TabIntro,
  TextField,
} from "./products/parts";
import { CostSection, PricingSection } from "./products/ProductPricing";
import { PictureButton } from "./products/Pictures";
import { PrintPicturesSection } from "./products/PicturesSection";
import { VariantsSection } from "./products/VariantsSection";

type Update = (fn: (p: ProductDefinition) => ProductDefinition) => void;

const ORIENTATIONS = ["square", "landscape", "portrait"] as const;
const SHIPPING_METHODS = ["Budget", "Standard", "StandardPlus", "Express", "Overnight"] as const;

/**
 * What each speed means to a customer, and where it's known not to run. The
 * availability notes are the load-bearing part: enabling a speed the printer
 * doesn't offer to a market makes every order from that market fail at
 * checkout, and the tier names give no hint of it.
 */
const SHIPPING_METHOD_HINTS: Record<(typeof SHIPPING_METHODS)[number], string> = {
  Budget: "Cheapest and slowest, untracked. Quotes to every country we sell to, but drops out on large orders.",
  Standard: "Ground courier. Not offered to the US or the UK — don't rely on it as your only speed.",
  StandardPlus: "Tracked priority post. The one speed available everywhere we sell; a safe default.",
  Express: "Fast courier, US only.",
  Overnight: "Fastest and dearest. Quotes to every country we sell to.",
};

const EDITOR_TABS = [
  { id: "details", label: "Details", icon: <Tag className="size-4" /> },
  { id: "format", label: "Format", icon: <Ruler className="size-4" /> },
  { id: "variants", label: "Variants", icon: <Layers className="size-4" /> },
  { id: "pricing", label: "Pricing", icon: <Sparkles className="size-4" /> },
  { id: "costs", label: "Costs", icon: <Package className="size-4" /> },
  { id: "shipping", label: "Shipping", icon: <Truck className="size-4" /> },
];

export function ProductsTab() {
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const saveProductFn = useAppConfigStore((s) => s.saveProduct);
  const deleteProductFn = useAppConfigStore((s) => s.deleteProductById);
  const seedProductsFn = useAppConfigStore((s) => s.seedProducts);
  const verifyProductsFn = useAppConfigStore((s) => s.verifyProducts);
  const calibrateProductCost = useAppConfigStore((s) => s.calibrateProductCost);
  const settings = useAppConfigStore((s) => s.pricingSettings);
  // Product pictures live outside the product record, so validation can only
  // warn about a book having none if it's handed the catalog's pictures.
  const media = useAppConfigStore((s) => s.catalogMedia);
  // Verification is per-environment, so validation needs to know which one is
  // being served before it can say whether a product is safe to offer.
  const runtime = useAdminHealth((s) => s.runtime);
  // Plans advertise a print discount that checkout clamps to break-even. Handing
  // them to validation turns a perk this price can't honour into a warning here,
  // instead of a member quietly being charged more than the plan promised.
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  const loadRuntime = useAdminHealth((s) => s.loadRuntime);
  const setConfigTab = useAdminTab((s) => s.setConfigTab);

  const [products, setProducts] = useState<ProductDefinition[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureProgress, setMeasureProgress] = useState<{
    done: number;
    total: number;
    name: string;
  } | null>(null);
  const [costRuns, setCostRuns] = useState<CatalogCalibrationRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editorTab, setEditorTab] = useState<string>("details");

  useEffect(() => {
    let live = true;
    loadAdminProducts()
      .then((cfg) => {
        if (!live) return;
        setProducts(cfg.products);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load products."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [loadAdminProducts]);

  useEffect(() => {
    if (!runtime) void loadRuntime();
  }, [runtime, loadRuntime]);

  /** Adopt a catalog the server just rewrote (verification, calibration). */
  const applyCatalog = (cfg: ProductsConfig) => {
    setProducts(cfg.products);
    const next = selectedId ? cfg.products.find((p) => p.id === selectedId) : undefined;
    // Only safe because these actions require a clean draft — nothing to lose.
    if (next) setDraft(structuredClone(next));
  };

  /**
   * Re-derive every product's cost from the provider.
   *
   * Runs ONE PRODUCT AT A TIME rather than in a single catalog request. Each
   * product now costs ~35 provider round trips (a cost line per variant, plus a
   * shipping sweep), so a whole catalog in one call would not finish inside the
   * function timeout — and measuring per product persists as it goes, so a
   * failure at product nine doesn't discard the eight that worked.
   *
   * Destructive by design: it replaces hand-entered tables, so it confirms
   * first and reports each product's before/after. A silent catalog-wide cost
   * change is exactly the kind of thing that should never be silent.
   */
  const onMeasureAll = async () => {
    const env = runtime?.env ?? "the provider";
    const targets = products.filter((p) => p.provider.id === "lulu" && p.provider.sku.trim());
    if (targets.length === 0) {
      toast.warning("No print-provider products to measure.");
      return;
    }
    if (
      !window.confirm(
        `Re-measure cost for ${targets.length} product${targets.length === 1 ? "" : "s"} against ${env}?\n\n` +
          "Each product is priced at both ends of its page range, once per variant, then shipping is " +
          "measured to five destinations. Every cost table is replaced with what the provider quotes, " +
          "including any you set by hand.\n\n" +
          `That's around a minute per product, so roughly ${Math.max(1, Math.round(targets.length * 0.75))}–${targets.length * 2} minutes. ` +
          "Progress is saved as it goes, so you can stop and resume.",
      )
    ) {
      return;
    }
    setMeasuring(true);
    setCostRuns([]);
    const runs: CatalogCalibrationRun[] = [];
    let failed = 0;
    try {
      for (const [i, product] of targets.entries()) {
        setMeasureProgress({ done: i, total: targets.length, name: product.presentation.name });
        try {
          const outcome = await calibrateProductCost(product.id, runtime?.env);
          if (outcome.run) runs.push(outcome.run);
          if (!outcome.result.ok) failed += 1;
          // Adopt each catalog as it lands, so the list reflects work already
          // banked even if a later product fails or the admin navigates away.
          applyCatalog(outcome.config);
        } catch (err) {
          failed += 1;
          runs.push({
            productId: product.id,
            name: product.presentation.name,
            sku: product.provider.sku,
            ok: false,
            message: err instanceof Error ? err.message : "Measurement failed.",
            before: {
              basePerUnit: product.cost.table.basePerUnit,
              perPage: product.cost.table.perPage,
            },
          });
        }
        setCostRuns([...runs]);
      }
      // Throttling gets its own line in the summary. It's the one outcome here
      // that isn't a problem with the catalog, and the only one whose fix is
      // simply to run this again in a minute.
      const throttled = runs.filter((r) => r.throttled).length;
      const parts = [`${runs.length - failed} measured`];
      if (failed) parts.push(`${failed} failed`);
      if (throttled) parts.push(`${throttled} rate-limited — re-run to finish`);
      const message = `${env}: ${parts.join(", ")}.`;
      if (failed || throttled) toast.warning(message);
      else toast.success(message);
    } finally {
      setMeasuring(false);
      setMeasureProgress(null);
    }
  };

  const onVerifyAll = async () => {
    setVerifying(true);
    try {
      const s = await verifyProductsFn(runtime ? { env: runtime.env } : undefined);
      applyCatalog(s.config);
      const parts = [`${s.ok} verified`];
      if (s.rejected) parts.push(`${s.rejected} rejected`);
      if (s.inconclusive) parts.push(`${s.inconclusive} unreachable`);
      const message = `${s.env}: ${parts.join(", ")}.`;
      if (s.rejected || s.inconclusive) toast.warning(message);
      else toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  const select = (p: ProductDefinition) => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setSelectedId(p.id);
    setDraft(structuredClone(p));
    setDirty(false);
    setEditorTab("details");
  };

  const update: Update = (fn) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };

  const addProduct = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    const p = createDefaultProduct({ sortOrder: products.length });
    setProducts((ps) => [...ps, p]);
    setSelectedId(p.id);
    setDraft(structuredClone(p));
    setDirty(true);
    setEditorTab("details");
  };

  const onSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await saveProductFn(draft);
      setProducts((ps) => (ps.some((p) => p.id === saved.id) ? ps.map((p) => (p.id === saved.id ? saved : p)) : [...ps, saved]));
      setDraft(structuredClone(saved));
      setDirty(false);
      toast.success("Product saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (p: ProductDefinition) => {
    if (!window.confirm(`Delete "${p.presentation.name}"? This can't be undone.`)) return;
    const existsRemotely = !dirty || selectedId !== p.id || products.some((x) => x.id === p.id);
    try {
      if (existsRemotely) {
        const cfg = await deleteProductFn(p.id);
        setProducts(cfg.products);
      } else {
        setProducts((ps) => ps.filter((x) => x.id !== p.id));
      }
      if (selectedId === p.id) {
        setSelectedId(null);
        setDraft(null);
        setDirty(false);
      }
      toast.success("Product deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    }
  };

  const onSeed = async () => {
    setSeeding(true);
    try {
      const cfg = await seedProductsFn();
      setProducts(cfg.products);
      toast.success("Seeded products from the print catalog.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not seed.");
    } finally {
      setSeeding(false);
    }
  };

  const discountPlans = useMemo(
    () =>
      publicPlans
        .filter((p) => p.status === "active" && p.entitlements.printDiscountPct > 0)
        .map((p) => ({ id: p.id, name: p.name, printDiscountPct: p.entitlements.printDiscountPct })),
    [publicPlans],
  );

  const issues = useMemo(
    () =>
      draft
        ? validateProduct(draft, settings, {
            media,
            plans: discountPlans,
            ...(runtime ? { env: runtime.env } : {}),
          })
        : [],
    [draft, settings, runtime, media, discountPlans],
  );
  // Actionable errors (verify / calibrate) don't block saving — you must save a
  // product before you can run those tools against it.
  const saveBlockers = saveBlockingIssues(issues);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-brand-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Verifying SKUs and measuring costs run against the{" "}
            <span className="font-medium">{runtime?.env ?? "active"}</span> print catalog, because
            sandbox and live are separate catalogues — the sandbox/live switch itself lives under{" "}
            <span className="font-medium">System health</span>. Currencies, payment fees and tax that
            turn these prices into margins are set once under{" "}
            <span className="font-medium">Financial settings</span>.
          </>
        }
        links={[
          { label: `Environment: ${runtime?.env ?? "…"}`, onClick: () => setConfigTab("system") },
          { label: "Financial settings", onClick: () => setConfigTab("financial") },
        ]}
      >
        <span className="font-medium">Print books</span> are the physical products customers order —
        each one binds a print spec to per-page-range prices. Only{" "}
        <span className="font-medium">active</span>, valid products are offered at checkout; the badge
        on each product tells you if it&apos;s ready.
      </TabIntro>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Master list */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="primary" size="sm" leftIcon={<Plus className="size-4" />} onClick={addProduct} className="flex-1">
              New product
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Sparkles className="size-4" />}
              loading={seeding}
              onClick={onSeed}
              title="Create one draft product per trim size and binding the printer sells, with measured page limits, costs and variant options already filled in. Existing products are left alone."
            >
              Seed
            </Button>
          </div>
          <ActionButton
            show={products.length > 0}
            icon={<BadgeCheck className="size-4" />}
            label={`Verify all against ${runtime?.env ?? "…"}`}
            explainer={`Asks the printer to price every SKU, which is the only way to find out whether it really exists. A rejected SKU fails at print time — after the customer has paid — so nothing is offered for sale until it passes here. Sandbox and live are separate catalogues, so this proves ${runtime?.env ?? "the active environment"} only.`}
            busy={verifying}
            disabledReason={dirty ? "Save your changes first — verification runs against the saved catalog." : null}
            onClick={onVerifyAll}
          />
          <ActionButton
            show={products.length > 0}
            icon={<Ruler className="size-4" />}
            label="Measure all costs"
            explainer="Prices each book at both ends of its page range to work out what the printer charges: a fixed amount per copy plus an amount per page, measured separately for every paper and print quality you offer. Then measures shipping to five countries. About a minute per book, saved as it goes. Replaces cost tables you typed in yourself."
            busy={measuring}
            progress={
              measureProgress
                ? `${measureProgress.done + 1}/${measureProgress.total} · ${measureProgress.name}`
                : null
            }
            disabledReason={dirty ? "Save your changes first — this runs against the saved catalog." : null}
            onClick={onMeasureAll}
          />
          {costRuns && costRuns.length > 0 && (
            <CalibrationRuns runs={costRuns} onDismiss={() => setCostRuns(null)} />
          )}

          {products.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-200 p-5 text-center text-xs text-ink-400">
              No products yet. Click <span className="font-medium text-ink-500">Seed</span> to import the print catalog,
              or add one.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {products.map((p) => {
                // Must match the `env` passed below for `issues` (and what the
                // server projects publicly) — otherwise this dot can show green
                // for a product whose SKU was never verified in the live
                // catalog, because an env-less check only warns about that.
                const offerable = isOfferable(p, settings, runtime ? { env: runtime.env } : {});
                const errCount = productErrors(p, settings, runtime ? { env: runtime.env } : {}).length;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => select(p)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                        selectedId === p.id ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "hover:bg-ink-50",
                      )}
                    >
                      <StatusDot status={p.status} offerable={offerable} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink-800">{p.presentation.name || "Untitled"}</span>
                        <span className="block truncate text-[11px] text-ink-400">{p.provider.sku || "no SKU"}</span>
                      </span>
                      {errCount > 0 && <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">{errCount}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Editor */}
        <div className="min-w-0">
          {!draft ? (
            <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed border-ink-200 text-sm text-ink-400">
              Select a product to edit, or create a new one.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StatusDot
                    status={draft.status}
                    offerable={isOfferable(draft, settings, runtime ? { env: runtime.env } : {})}
                  />
                  <h2 className="text-base font-semibold text-ink-900">{draft.presentation.name || "Untitled"}</h2>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-4" />} onClick={() => onDelete(draft)}>
                    Delete
                  </Button>
                  {dirty && (
                    <Button variant="ghost" size="sm" onClick={() => select(products.find((p) => p.id === draft.id) ?? draft)}>
                      Discard
                    </Button>
                  )}
                  <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty || saveBlockers.length > 0} title={saveBlockers.length ? "Fix errors before saving" : undefined}>
                    Save product
                  </Button>
                </div>
              </div>

              <ValidationBanner issues={issues} />
              <SetupChecklist product={draft} issues={issues} onGoTo={setEditorTab} />

              <Tabs items={EDITOR_TABS} value={editorTab} onChange={setEditorTab} />

              <div className="rounded-xl ring-1 ring-inset ring-ink-100 p-3">
                {editorTab === "details" && <DetailsSection product={draft} update={update} />}
                {editorTab === "format" && (
                  <FormatSection product={draft} update={update} dirty={dirty} onVerified={applyCatalog} />
                )}
                {editorTab === "variants" && <VariantsSection product={draft} update={update} />}
                {editorTab === "pricing" && <PricingSection product={draft} update={update} settings={settings} />}
                {editorTab === "costs" && (
                  <CostSection product={draft} update={update} dirty={dirty} onCalibrated={applyCatalog} />
                )}
                {editorTab === "shipping" && <ShippingSection product={draft} update={update} />}
              </div>
            </div>
          )}
        </div>
      </div>

      <PrintPicturesSection products={products} />
    </div>
  );
}

function StatusDot({ status, offerable }: { status: ProductDefinition["status"]; offerable: boolean }) {
  if (status === "active" && offerable) return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  if (status === "active") return <AlertTriangle className="size-4 shrink-0 text-amber-500" />;
  if (status === "retired") return <span className="size-2.5 shrink-0 rounded-full bg-ink-300" />;
  return <span className="size-2.5 shrink-0 rounded-full bg-amber-300" />;
}

/**
 * The route from a fresh product to a sellable one, in order.
 *
 * The error banner says what's wrong; this says what to do next. They're
 * different questions, and the second one is the hard one when six tabs each
 * hold part of the answer and two of the steps have to happen in a particular
 * order (you can't price a variant before you know what it costs).
 */
function SetupChecklist({
  product,
  issues,
  onGoTo,
}: {
  product: ProductDefinition;
  issues: ProductIssue[];
  onGoTo: (tab: string) => void;
}) {
  const verified = Object.values(product.provider.verifiedIn ?? {}).some((v) => v?.ok);
  const measured = product.cost.table.basePerUnit > 0 || product.cost.table.perPage > 0;
  const shippingMeasured = (product.shipping.fallback ?? []).length > 0;
  const priced = product.pricing.tiers.some((t) => Object.values(t.prices).some((v) => v > 0));
  const steps = [
    { tab: "format", done: verified, label: "Verify the SKU", why: "proves the printer will accept it" },
    { tab: "costs", done: measured, label: "Measure costs", why: "everything below needs to know what it costs you" },
    { tab: "shipping", done: shippingMeasured, label: "Measure shipping", why: "sets the fallback rate and which speeds reach where" },
    { tab: "pricing", done: priced, label: "Set prices", why: "per page range, per currency" },
    { tab: "variants", done: true, label: "Price the variants", why: "derive them from cost with Suggest" },
  ];
  const remaining = steps.filter((s) => !s.done);
  // Nothing to guide once it's set up and clean; the banner covers the rest.
  if (remaining.length === 0 && issues.length === 0) return null;
  if (remaining.length === 0) return null;

  return (
    <div className="space-y-1 rounded-lg bg-ink-50 px-3 py-2.5 text-xs">
      <p className="font-semibold text-ink-700">Getting this product ready</p>
      <ol className="space-y-0.5">
        {steps.map((s) => (
          <li key={s.tab} className="flex items-baseline gap-2">
            <span className={s.done ? "text-emerald-600" : "text-ink-300"}>{s.done ? "✓" : "○"}</span>
            <button
              type="button"
              onClick={() => onGoTo(s.tab)}
              className={cn(
                "text-left underline-offset-2 hover:underline",
                s.done ? "text-ink-400" : "font-medium text-ink-700",
              )}
            >
              {s.label}
            </button>
            <span className="text-ink-400">— {s.why}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What each issue's fix is CALLED, so the message can point at the tool instead
 * of leaving you to guess which tab it lives on.
 */
const FIX_HINTS: Record<NonNullable<ProductIssue["fix"]>, string> = {
  verify: "Fixed by: Verify (Details tab, or “Verify all” in the list)",
  measure: "Fixed by: Measure cost from the provider (Costs tab)",
};

function ValidationBanner({ issues }: { issues: ProductIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
        <BadgeCheck className="size-4" /> Valid configuration — ready to be offered when active.
      </div>
    );
  }
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  // Actionable errors are cleared by running a tool, not by typing, so they
  // don't stop a save — saying so up front stops the banner reading as a wall.
  const actionable = errors.filter((e) => e.actionable).length;
  return (
    <div className="space-y-1.5">
      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 ring-1 ring-inset ring-red-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" /> {errors.length} error{errors.length === 1 ? "" : "s"} —{" "}
            {actionable === errors.length
              ? "you can still save; run the tools below to clear these"
              : "fix before saving"}
          </div>
          <ul className="ml-5 list-disc space-y-1">
            {errors.map((e, i) => (
              <li key={i}>
                {e.message}
                {e.fix && <span className="mt-0.5 block text-[11px] text-red-500">{FIX_HINTS[e.fix]}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" /> {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---- Sections --------------------------------------------------------------

function DetailsSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const p = product.presentation;
  const setP = (patch: Partial<ProductDefinition["presentation"]>) =>
    update((d) => ({ ...d, presentation: { ...d.presentation, ...patch } }));
  return (
    <div className="space-y-3">
      <Section title="Presentation" hint="What customers see in the storefront.">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-3">
            <TextField label="Name" value={p.name} onChange={(v) => setP({ name: v })} />
            <TextField label="Tagline" value={p.tagline ?? ""} placeholder="Optional one-liner" onChange={(v) => setP({ tagline: v })} />
          </div>
          {/* Pictures live in the catalog-wide store, not on this record — this is
              a shortcut into the same manager as the Product pictures section. */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-ink-500">Pictures</p>
            <PictureButton mediaKey={bookMediaKey(product.id)} label={p.name || "this book"} />
          </div>
        </div>
        <Field label="Description">
          <Textarea rows={4} value={p.description} placeholder="Markdown supported" onChange={(e) => setP({ description: e.target.value })} />
        </Field>
      </Section>
      <Section title="Status & ordering" hint="Only active + valid products are offered to customers.">
        <Grid cols={2}>
          <Field label="Status">
            <Select
              value={product.status}
              options={[
                { value: "draft", label: "Draft (hidden)" },
                { value: "active", label: "Active (offered)" },
                { value: "retired", label: "Retired" },
              ]}
              onChange={(e) => update((d) => ({ ...d, status: e.target.value as ProductDefinition["status"] }))}
            />
          </Field>
          <NumberField label="Display order" value={product.sortOrder} onChange={(n) => update((d) => ({ ...d, sortOrder: n }))} />
        </Grid>
      </Section>
      <Disclosure>
        <TextField
          label="Badges (comma-separated)"
          value={p.badges.join(", ")}
          placeholder="Bestseller, Premium"
          onChange={(v) => setP({ badges: v.split(",").map((b) => b.trim()).filter(Boolean) })}
        />
      </Disclosure>
    </div>
  );
}

function FormatSection({
  product,
  update,
  dirty,
  onVerified,
}: {
  product: ProductDefinition;
  update: Update;
  dirty: boolean;
  onVerified: (config: ProductsConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <ProviderFields product={product} update={update} dirty={dirty} onVerified={onVerified} />
      <SpecFields product={product} update={update} />
      <ConditionsFields product={product} update={update} />
    </div>
  );
}

/**
 * Choice axes in the order that reads best, which is not the order they appear
 * in the code: binding leads because it's the decision everything else hangs
 * off, and the two longest lists sit side by side so the grid doesn't leave a
 * column of dead space. Fields with only one possible value are dropped.
 */
const CHOICE_AXES = (["binding", "paper", "ink", "quality", "finish", "linen", "foil"] as const)
  .map((id) => SKU_AXES.find((a) => a.id === id)!)
  .filter(isChoiceAxis);

/**
 * Trim in inches, with the provider's code derived rather than typed. The code
 * encodes hundredths of an inch as width-then-height ("0850X0850"), which is
 * unguessable — and getting it subtly wrong yields a package that doesn't exist.
 */
function TrimPicker({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const presets = SKU_AXES.find((a) => a.id === "trim")!.options;
  const trim = parseTrimCode(code);
  const isPreset = presets.some((p) => p.code === code);

  const preset = presets.find((p) => p.code === code);

  return (
    <div className="space-y-2 rounded-lg bg-ink-50/50 p-2.5">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field
            label="Trim size"
            hint={trim ? `Encodes as ${code}` : "Enter a width and height to build the code."}
          >
            <Select
              value={isPreset ? code : "custom"}
              options={[
                ...presets.map((p) => ({ value: p.code, label: p.label })),
                { value: "custom", label: "Custom size…" },
              ]}
              onChange={(e) => {
                if (e.target.value !== "custom") onChange(e.target.value);
              }}
            />
          </Field>
        </div>
        {/* Size is the hardest option to picture, so a size-guide shot earns its place. */}
        {preset && <PictureButton mediaKey={preset.mediaKey} label={preset.label} className="mb-1" />}
      </div>
      <Grid cols={2}>
        <NumberField
          label="Width"
          value={trim?.widthIn ?? 0}
          step="0.25"
          suffix="in"
          onChange={(n) => onChange(trimCode(n, trim?.heightIn ?? 0))}
        />
        <NumberField
          label="Height"
          value={trim?.heightIn ?? 0}
          step="0.25"
          suffix="in"
          onChange={(n) => onChange(trimCode(trim?.widthIn ?? 0, n))}
        />
      </Grid>
    </div>
  );
}

/**
 * One axis as a list of selectable cards, each explaining what it actually is
 * and showing a photo of it. The photo button is a sibling of the radio rather
 * than a child, so "choose this option" and "manage its photos" stay distinct
 * controls; the card reserves the space it sits in.
 */
function OptionCards({
  axis,
  value,
  onChange,
}: {
  axis: SkuAxis;
  value: string;
  onChange: (code: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-ink-700">{axis.label}</p>
      <div role="radiogroup" aria-label={axis.label} className="space-y-1.5">
        {axis.options.map((o) => {
          const selected = o.code === value;
          return (
            <div key={o.code} className="relative">
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(o.code)}
                className={cn(
                  "block w-full rounded-lg py-2 pr-2.5 text-left ring-1 ring-inset transition",
                  o.mediaKey ? "pl-16" : "pl-2.5",
                  selected ? "bg-brand-50 ring-brand-300" : "bg-white ring-ink-100 hover:bg-ink-50",
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn("text-xs font-semibold", selected ? "text-brand-800" : "text-ink-700")}>
                    {o.label}
                  </span>
                  <code className="font-mono text-[10px] text-ink-400">{o.code}</code>
                </span>
                {o.hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{o.hint}</span>}
              </button>
              <PictureButton
                mediaKey={o.mediaKey}
                label={o.label}
                hint={o.hint}
                className="absolute left-2.5 top-2"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Assemble a `pod_package_id` from choices instead of typing 27 characters.
 *
 * The provider publishes no list of valid packages, so the only way to know a
 * combination exists is to ask it to price one. That's what "Check" does — and
 * because the provider names the supported page range when it rejects an absurd
 * page count, a successful check also tells us the real page bounds, which get
 * applied along with the SKU.
 */
function SkuBuilder({ product, update }: { product: ProductDefinition; update: Update }) {
  const checkSku = useAppConfigStore((s) => s.checkSku);
  const runtime = useAdminHealth((s) => s.runtime);
  const [open, setOpen] = useState(false);
  const [parts, setParts] = useState<SkuParts>(() => parseSku(product.provider.sku) ?? defaultSkuParts());
  const [checking, setChecking] = useState(false);
  const [entry, setEntry] = useState<SkuMatrixEntry | null>(null);

  const sku = composeSku(parts);
  const trim = parseTrimCode(parts.trim);
  // Any edit invalidates the previous verdict — it belonged to a different SKU.
  const setPart = (id: SkuAxisId, code: string) => {
    setParts((p) => ({ ...p, [id]: code }));
    setEntry(null);
  };

  const run = async () => {
    setChecking(true);
    try {
      const res = await checkSku(sku, { env: runtime?.env, refresh: true });
      setEntry(res.entry);
      if (!res.entry.ok) toast.error(res.entry.message ?? "The provider doesn't offer this combination.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  };

  const applyToProduct = () => {
    if (!entry?.ok) return;
    update((d) => ({
      ...d,
      provider: { ...d.provider, sku: entry.sku },
      spec: {
        ...d.spec,
        binding: (BINDING_BY_CODE[parts.binding] ?? d.spec.binding) as ProductDefinition["spec"]["binding"],
        finish: parts.finish === "M" ? "matte" : "gloss",
        ...(trim ? { pageTrim: { width: trim.widthIn, height: trim.heightIn, unit: "in" as const } } : {}),
      },
      // The provider's own bounds beat anything hand-entered.
      conditions: entry.pages
        ? { ...d.conditions, pages: { ...d.conditions.pages, min: entry.pages.min, max: entry.pages.max } }
        : d.conditions,
    }));
    toast.success("Applied. Save, then verify.");
  };

  return (
    <div className="rounded-lg ring-1 ring-inset ring-ink-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Build a SKU</span>
        <span className="text-xs text-ink-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-ink-100 p-3">
          <p className="text-xs text-ink-500">
            The provider has no catalogue to browse, so these options are a starting point rather than a
            guarantee. Check the combination to find out whether it really exists.
          </p>
          <TrimPicker code={parts.trim} onChange={(c) => setPart("trim", c)} />
          <Grid cols={2}>
            {CHOICE_AXES.map((axis) => (
              <OptionCards
                key={axis.id}
                axis={axis}
                value={parts[axis.id]}
                onChange={(code) => setPart(axis.id, code)}
              />
            ))}
          </Grid>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-ink-50 px-2 py-1 font-mono text-xs text-ink-700">{sku}</code>
            <Button
              variant="secondary"
              size="sm"
              loading={checking}
              onClick={run}
              title="Ask the printer to price this exact combination. A price back means it's real and sellable; a refusal means this trim, binding, paper or finish combination isn't made."
            >
              Check with provider
            </Button>
            {entry?.ok && (
              <Button
                variant="primary"
                size="sm"
                onClick={applyToProduct}
                title="Make this the product's SKU. The spec and base variant above are rewritten to match it, so re-measure costs afterwards."
              >
                Use this SKU
              </Button>
            )}
          </div>
          {entry && (
            <p className={cn("text-xs", entry.ok ? "text-emerald-700" : "text-red-600")}>
              {entry.ok
                ? `Exists in ${entry.env}${entry.pages ? ` · ${entry.pages.min}–${entry.pages.max} pages` : ""}${
                    entry.unitCost ? ` · from ${entry.unitCost.toFixed(2)} ${entry.currency}/book` : ""
                  }`
                : (entry.message ?? "Not available.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** What a catalog-wide cost measurement changed, per product. */
/**
 * What the printer was measured to charge, per country and speed.
 *
 * Read-only: these are observations, not settings. Editing them would be
 * editing the answer to a question we asked the provider, and the next
 * measurement would silently discard the edit anyway.
 */
function ShippingRatesTable({ product }: { product: ProductDefinition }) {
  // Only markets this product still sells to. Rows for a withdrawn market are
  // kept (re-adding it shouldn't lose the measurement) but showing them here
  // would contradict the checkboxes directly above, which is worse than showing
  // nothing.
  const rows = (product.shipping.fallback ?? []).filter((r) =>
    isDestinationAllowed(product.shipping.destinations, { country: r.country }),
  );
  if (rows.length === 0) {
    return (
      <Section title="Measured shipping rates" hint="Filled in by “Measure cost from the provider”.">
        <p className="text-[11px] text-ink-500">
          Nothing measured yet. Until it is, an order whose live quote fails falls back to the single
          fallback amount below — and we can&apos;t tell which speeds reach which countries.
        </p>
      </Section>
    );
  }
  const countries = [...new Set(rows.map((r) => r.country))];
  // Enabled speeds are listed even with no rows at all. A speed that failed to
  // measure everywhere would otherwise vanish from the table, hiding the one
  // thing worth knowing about it — that we don't know whether it works.
  const methods = [
    ...new Set([
      ...rows.map((r) => r.method),
      ...product.shipping.methods.filter((m) => m.enabled).map((m) => m.method),
    ]),
  ];
  const measuredAt = product.shipping.fallbackMeasuredAt;
  return (
    <Section
      title="Measured shipping rates"
      hint={`What the printer quoted per destination, as a fixed amount plus an amount per copy. Used when a live quote can't be fetched.${
        measuredAt ? ` Measured ${new Date(measuredAt).toLocaleDateString()}.` : ""
      }`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-[420px] text-[11px]">
          <thead className="text-[10px] uppercase tracking-wide text-ink-400">
            <tr>
              <th className="pb-1 pr-3 text-left font-medium">Speed</th>
              {countries.map((c) => (
                <th key={c} className="pb-1 pr-3 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {methods.map((method) => (
              <tr key={method} className="border-t border-ink-100">
                <td className="py-1 pr-3 text-ink-700">{method}</td>
                {countries.map((country) => {
                  const row = rows.find((r) => r.method === method && r.country === country);
                  // No row and a refused row mean different things, and only one
                  // of them is a finding: "?" is a gap in our measurement, "—"
                  // is the printer telling us it doesn't go there.
                  if (!row) {
                    return (
                      <td
                        key={country}
                        className="py-1 pr-3 text-right text-ink-300"
                        title="Not measured yet — re-run to find out"
                      >
                        ?
                      </td>
                    );
                  }
                  if (!row.available) {
                    return (
                      <td key={country} className="py-1 pr-3 text-right text-ink-300" title="Not offered here">
                        —
                      </td>
                    );
                  }
                  return (
                    <td
                      key={country}
                      className="py-1 pr-3 text-right tabular-nums text-ink-600"
                      title={`${row.base.toFixed(2)} + ${row.perCopy.toFixed(2)} per copy`}
                    >
                      {(row.base + row.perCopy).toFixed(2)}
                      {row.perCopy > 0 && (
                        <span className="text-ink-400"> +{row.perCopy.toFixed(2)}/ea</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-ink-400">
        Shown for one copy, in {product.cost.currency}. A dash means the printer doesn&apos;t run that
        speed to that country — enabling it there fails the order at checkout. A question mark means
        we haven&apos;t found out yet; those fall back to the single amount below.
      </p>
    </Section>
  );
}

/**
 * A catalog-wide action with its explanation attached.
 *
 * These buttons each fire off dozens of provider calls and rewrite saved data,
 * and their names ("Verify", "Measure") say what they're called rather than
 * what they do. A tooltip isn't enough for something you can't undo, so the
 * sentence is always on screen.
 */
function ActionButton({
  show,
  icon,
  label,
  explainer,
  busy,
  progress,
  disabledReason,
  onClick,
}: {
  show: boolean;
  icon: React.ReactNode;
  label: string;
  explainer: string;
  busy: boolean;
  progress?: string | null;
  disabledReason: string | null;
  onClick: () => void;
}) {
  if (!show) return null;
  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        leftIcon={icon}
        loading={busy}
        disabled={disabledReason != null}
        onClick={onClick}
        title={disabledReason ?? explainer}
      >
        {label}
      </Button>
      <p className="px-0.5 text-[10px] leading-snug text-ink-400">
        {busy && progress ? progress : (disabledReason ?? explainer)}
      </p>
    </div>
  );
}

function CalibrationRuns({
  runs,
  onDismiss,
}: {
  runs: CatalogCalibrationRun[];
  onDismiss: () => void;
}) {
  return (
    <div className="space-y-1 rounded-lg p-2 ring-1 ring-inset ring-ink-100">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">Cost measurement</span>
        <button type="button" onClick={onDismiss} className="text-[10px] text-ink-400 hover:text-ink-600">
          Dismiss
        </button>
      </div>
      {runs.map((r) => (
        <div key={r.productId} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-ink-600">{r.name}</span>
            {r.ok && r.after ? (
              <span className="shrink-0 tabular-nums text-ink-500" title={r.message}>
                {r.before.basePerUnit.toFixed(2)} → {r.after.basePerUnit.toFixed(2)} + {r.after.perPage.toFixed(3)}/pg
              </span>
            ) : (
              <span className={`shrink-0 ${r.throttled ? "text-amber-700" : "text-red-600"}`} title={r.message}>
                {/* Throttled isn't failed. Colouring it red sends the admin
                    looking for a misconfiguration that doesn't exist. */}
                {r.throttled ? "rate-limited" : "failed"}
              </span>
            )}
          </div>
          {r.ok && r.variants && r.variants.measured < r.variants.offered && (
            <p className="text-[10px] text-amber-700">
              Only {r.variants.measured} of {r.variants.offered} variants priced
              {r.variantsThrottled
                ? ` — ${r.variantsThrottled} of the rest were rate-limited, not unavailable. Re-run to price them.`
                : " — the rest fall back to the base cost."}
            </p>
          )}
          {/* A cost fit that worked while shipping didn't still leaves a
              passthrough product unsellable, so it can't be reported as green. */}
          {r.shippingMessage && <p className="text-[10px] text-amber-700">{r.shippingMessage}</p>}
          {!r.ok && r.message && (
            <p className={`text-[10px] ${r.throttled ? "text-amber-700" : "text-red-500"}`}>{r.message}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Per-environment proof that the SKU can actually be printed. Verification runs
 * against the SAVED product (the backend reads the catalog, probes, and writes
 * the verdict), so unsaved edits must be committed first — otherwise you'd be
 * verifying something other than what you're looking at.
 */
function VerificationPanel({
  product,
  dirty,
  onVerified,
}: {
  product: ProductDefinition;
  dirty: boolean;
  onVerified: (config: ProductsConfig) => void;
}) {
  const verifyProducts = useAppConfigStore((s) => s.verifyProducts);
  const [busy, setBusy] = useState<ProviderEnv | null>(null);

  const run = async (env: ProviderEnv) => {
    setBusy(env);
    try {
      const summary = await verifyProducts({ env, id: product.id });
      const result = summary.results[0];
      if (!result || result.outcome === "inconclusive") {
        toast.error(`Couldn't reach a verdict: ${result?.message ?? "no response"}`);
      } else if (result.outcome === "rejected") {
        toast.error(`${env} rejected this SKU: ${result.message}`);
      } else {
        toast.success(`Verified against ${env}.`);
      }
      onVerified(summary.config);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg ring-1 ring-inset ring-ink-100">
      <div className="border-b border-ink-100 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">SKU verification</p>
        <p className="mt-0.5 text-xs text-ink-500">
          Asks the printer to price this book at the smallest and largest page count you allow. If it
          quotes both, the SKU exists and the whole range is printable; if it refuses, the SKU is wrong
          or the range is. Nothing is ordered and nothing is charged.
        </p>
        <p className="mt-1 text-xs text-ink-400">
          Sandbox and live are <span className="font-medium">separate catalogues</span> behind separate
          credentials, so a pass in one says nothing about the other — verify whichever you&apos;re
          serving. An unverified SKU fails at print time, which is after the customer has paid, so
          nothing is offered for sale until this passes.
        </p>
      </div>
      <div className="divide-y divide-ink-100">
        {PROVIDER_ENVS.map((env) => {
          const record = verificationFor(product.provider, env);
          const covers = verificationCoversPages(record, product.conditions.pages);
          return (
            <div key={env} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <span className="text-sm font-medium capitalize text-ink-800">{env}</span>
                <p className="text-xs text-ink-500">
                  {!record ? (
                    "Never verified."
                  ) : !record.ok ? (
                    <span className="text-red-600">Rejected: {record.error ?? "unknown reason"}</span>
                  ) : !covers ? (
                    <span className="text-amber-700">
                      Verified for {record.pages.min}–{record.pages.max} pages, but this product allows{" "}
                      {product.conditions.pages.min}–{product.conditions.pages.max}. Re-verify.
                    </span>
                  ) : (
                    <span className="text-emerald-700">
                      Verified {record.pages.min}–{record.pages.max} pages on{" "}
                      {new Date(record.at).toLocaleDateString()}.
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={busy === env}
                disabled={busy != null || dirty || !product.provider.sku.trim()}
                title={
                  dirty
                    ? "Save your changes first — verification runs against the saved product."
                    : `Ask the ${env} print catalogue to price this SKU at ${product.conditions.pages.min} and ${product.conditions.pages.max} pages, and record the verdict`
                }
                onClick={() => run(env)}
              >
                Verify {env}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProviderFields({
  product,
  update,
  dirty,
  onVerified,
}: {
  product: ProductDefinition;
  update: Update;
  dirty: boolean;
  onVerified: (config: ProductsConfig) => void;
}) {
  const pr = product.provider;
  const setPr = (patch: Partial<ProductDefinition["provider"]>) =>
    update((d) => ({ ...d, provider: { ...d.provider, ...patch } }));
  return (
    <Section title="Print provider" hint="Which provider prints and ships this book. Their API handles quotes and orders.">
      <Field label="Provider" className="w-full sm:w-72">
        <Select
          value={pr.id}
          options={FULFILLMENT_PROVIDERS.map((id) => ({ value: id, label: PROVIDER_LABELS[id] }))}
          onChange={(e) => setPr({ id: e.target.value as ProductDefinition["provider"]["id"] })}
        />
      </Field>
      <TextField label="Provider SKU" value={pr.sku} placeholder="e.g. 0850X0850FCPRECW080CW444GXX" onChange={(v) => setPr({ sku: v })} />
      {pr.id === "lulu" && (
        <>
          <SkuBuilder product={product} update={update} />
          <VerificationPanel product={product} dirty={dirty} onVerified={onVerified} />
        </>
      )}
      <Disclosure label="Print areas">
        <Grid cols={3}>
          <TextField label="Interior" value={pr.printAreas.interior} onChange={(v) => setPr({ printAreas: { ...pr.printAreas, interior: v } })} />
          <TextField label="Cover" value={pr.printAreas.cover ?? ""} onChange={(v) => setPr({ printAreas: { ...pr.printAreas, cover: v } })} />
          <TextField label="Spine" value={pr.printAreas.spine ?? ""} onChange={(v) => setPr({ printAreas: { ...pr.printAreas, spine: v || undefined } })} />
        </Grid>
      </Disclosure>
    </Section>
  );
}

function SpecFields({ product, update }: { product: ProductDefinition; update: Update }) {
  const s = product.spec;
  const setS = (patch: Partial<ProductDefinition["spec"]>) => update((d) => ({ ...d, spec: { ...d.spec, ...patch } }));
  const setCover = (patch: Partial<ProductDefinition["spec"]["cover"]>) =>
    update((d) => ({ ...d, spec: { ...d.spec, cover: { ...d.spec.cover, ...patch } } }));
  return (
    <Section title="Size & binding" hint="Binding and finish drive print specs and page-count rules.">
      <Grid cols={3}>
        {/* The spec's binding/finish values ARE the media keys, so the photo of
            the thing being described sits right next to the choice. */}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Binding">
              <Select value={s.binding} options={BINDINGS.map((b) => ({ value: b, label: b }))} onChange={(e) => setS({ binding: e.target.value as ProductDefinition["spec"]["binding"] })} />
            </Field>
          </div>
          <PictureButton mediaKey={optionMediaKey("binding", s.binding)} label={s.binding} className="mb-1" />
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Finish">
              <Select value={s.finish} options={FINISHES.map((f) => ({ value: f, label: f }))} onChange={(e) => setS({ finish: e.target.value as ProductDefinition["spec"]["finish"] })} />
            </Field>
          </div>
          <PictureButton mediaKey={optionMediaKey("finish", s.finish)} label={s.finish} className="mb-1" />
        </div>
        <Field label="Orientation">
          <Select value={s.orientation} options={ORIENTATIONS.map((o) => ({ value: o, label: o }))} onChange={(e) => setS({ orientation: e.target.value as ProductDefinition["spec"]["orientation"] })} />
        </Field>
      </Grid>
      <Grid cols={3}>
        <NumberField label="Page width" value={s.pageTrim.width} step="0.01" suffix={s.pageTrim.unit} onChange={(n) => setS({ pageTrim: { ...s.pageTrim, width: n } })} />
        <NumberField label="Page height" value={s.pageTrim.height} step="0.01" suffix={s.pageTrim.unit} onChange={(n) => setS({ pageTrim: { ...s.pageTrim, height: n } })} />
        <Field label="Unit">
          <Select value={s.pageTrim.unit} options={[{ value: "in", label: "inches" }, { value: "mm", label: "mm" }]} onChange={(e) => setS({ pageTrim: { ...s.pageTrim, unit: e.target.value as "in" | "mm" } })} />
        </Field>
      </Grid>
      <Disclosure label="Print spec (bleed, DPI, cover)">
        <Grid cols={3}>
          <TextField label="Paper" value={s.paperLabel ?? ""} placeholder="80# coated white" onChange={(v) => setS({ paperLabel: v })} />
          <NumberField label="Bleed" value={s.bleed.value} step="0.001" suffix={s.bleed.unit} onChange={(n) => setS({ bleed: { ...s.bleed, value: n } })} />
          <NumberField label="Interior DPI" value={s.interiorDpi} step="1" onChange={(n) => setS({ interiorDpi: n })} />
          <NumberField label="Cover DPI" value={s.coverDpi} step="1" onChange={(n) => setS({ coverDpi: n })} />
        </Grid>
        <Grid cols={3}>
          <Field label="Cover differs from page">
            <Select value={s.cover.differsFromPage ? "yes" : "no"} options={[{ value: "no", label: "Same as page" }, { value: "yes", label: "Differs" }]} onChange={(e) => setCover({ differsFromPage: e.target.value === "yes" })} />
          </Field>
          <Field label="Cover sizing">
            <Select
              value={s.cover.sizing.mode}
              options={[{ value: "providerComputed", label: "Provider-computed" }, { value: "fixed", label: "Fixed dimensions" }]}
              onChange={(e) => {
                const mode = e.target.value as "providerComputed" | "fixed";
                setCover(
                  mode === "providerComputed"
                    ? { sizing: { mode } }
                    : {
                        sizing: {
                          mode,
                          front: { ...s.pageTrim },
                          back: { ...s.pageTrim },
                          spine: { mode: "perPage", mmPerPage: 0.06, baseMm: 3 },
                        },
                      },
                );
              }}
            />
          </Field>
          {s.cover.differsFromPage && (
            <NumberField label="Wrap margin" value={s.cover.wrapMarginIn ?? 0} step="0.05" suffix="in" onChange={(n) => setCover({ wrapMarginIn: n })} />
          )}
        </Grid>
      </Disclosure>
    </Section>
  );
}

function ConditionsFields({ product, update }: { product: ProductDefinition; update: Update }) {
  const c = product.conditions;
  const plans = useAppConfigStore((s) => s.plans.plans);
  const access = productAccessOf(c);
  const setC = (patch: Partial<ProductDefinition["conditions"]>) =>
    update((d) => ({ ...d, conditions: { ...d.conditions, ...patch } }));
  const setAccess = (patch: Partial<ProductAccess>) =>
    update((d) => ({ ...d, conditions: { ...d.conditions, access: { ...productAccessOf(d.conditions), ...patch } } }));
  return (
    <div className="space-y-3">
    <Section title="Page & copy limits" hint="Allowed interior page range (step = the multiple the count must align to, e.g. 4 for saddle-stitch) and order quantity.">
      <Grid cols={3}>
        <NumberField label="Min pages" value={c.pages.min} onChange={(n) => setC({ pages: { ...c.pages, min: n } })} />
        <NumberField label="Max pages" value={c.pages.max} onChange={(n) => setC({ pages: { ...c.pages, max: n } })} />
        <NumberField label="Page step" value={c.pages.step} min={1} onChange={(n) => setC({ pages: { ...c.pages, step: n } })} />
      </Grid>
      <Grid cols={2}>
        <NumberField label="Min copies" value={c.copies.min} min={1} onChange={(n) => setC({ copies: { ...c.copies, min: n } })} />
        <NumberField label="Max copies" value={c.copies.max} min={1} onChange={(n) => setC({ copies: { ...c.copies, max: n } })} />
      </Grid>
      <Disclosure label="Custom rules">
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" leftIcon={<Plus className="size-3.5" />} onClick={() => setC({ custom: [...c.custom, { kind: "note", key: "note", message: "" }] })}>
            Add rule
          </Button>
        </div>
        {c.custom.length === 0 ? (
          <p className="text-[11px] text-ink-400">No custom rules.</p>
        ) : (
          c.custom.map((rule, i) => {
            const replace = (next: ProductDefinition["conditions"]["custom"][number]) =>
              setC({ custom: c.custom.map((x, idx) => (idx === i ? next : x)) });
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md bg-white p-2 ring-1 ring-inset ring-ink-100">
                <Field label="Kind" className="w-44">
                  <Select
                    value={rule.kind}
                    options={[
                      { value: "minOrderValue", label: "Min order value" },
                      { value: "spineTextMinPages", label: "Spine text min pages" },
                      { value: "ageGate", label: "Age gate" },
                      { value: "note", label: "Note" },
                    ]}
                    onChange={(e) => {
                      const kind = e.target.value as ProductDefinition["conditions"]["custom"][number]["kind"];
                      if (kind === "minOrderValue") replace({ kind, amount: 0, currency: "USD" });
                      else if (kind === "spineTextMinPages") replace({ kind, pages: 80 });
                      else if (kind === "ageGate") replace({ kind, minAge: 0 });
                      else replace({ kind: "note", key: "note", message: "" });
                    }}
                  />
                </Field>
                {rule.kind === "minOrderValue" && (
                  <>
                    <NumberField label="Amount" value={rule.amount} step="0.01" className="w-28" onChange={(n) => replace({ ...rule, amount: n })} />
                    <TextField label="Currency" value={rule.currency} className="w-24" onChange={(v) => replace({ ...rule, currency: v.toUpperCase() })} />
                  </>
                )}
                {rule.kind === "spineTextMinPages" && <NumberField label="Min pages" value={rule.pages} className="w-28" onChange={(n) => replace({ ...rule, pages: n })} />}
                {rule.kind === "ageGate" && <NumberField label="Min age" value={rule.minAge} className="w-28" onChange={(n) => replace({ ...rule, minAge: n })} />}
                {rule.kind === "note" && <TextField label="Message" value={rule.message} className="flex-1 min-w-40" onChange={(v) => replace({ ...rule, message: v })} />}
                <Button variant="ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setC({ custom: c.custom.filter((_, idx) => idx !== i) })} />
              </div>
            );
          })
        )}
      </Disclosure>
    </Section>

      <Section title="Subscription access" hint="Restrict who can order this product based on their subscription.">
        <Field label="Who can order" className="w-full sm:w-72">
          <Select
            value={access.mode}
            options={[
              { value: "public", label: "Anyone" },
              { value: "subscribersOnly", label: "Subscribers only (any paid plan)" },
              { value: "plans", label: "Specific plans" },
            ]}
            onChange={(e) => setAccess({ mode: e.target.value as ProductAccess["mode"] })}
          />
        </Field>
        {access.mode === "plans" && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-ink-400">Only buyers on the selected plans can order this product.</p>
            {plans.length === 0 ? (
              <p className="text-[11px] text-ink-400">No plans configured yet — add them under the Plans tab.</p>
            ) : (
              plans
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((pl) => {
                  const checked = access.planIds.includes(pl.id);
                  return (
                    <label key={pl.id} className="flex items-center gap-2 text-sm text-ink-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setAccess({
                            planIds: e.target.checked
                              ? [...access.planIds, pl.id]
                              : access.planIds.filter((x) => x !== pl.id),
                          })
                        }
                        className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                      />
                      {pl.name}
                      {pl.isFree ? " (free)" : ""}
                    </label>
                  );
                })
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

function ShippingSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const sh = product.shipping;
  const setSh = (patch: Partial<ProductDefinition["shipping"]>) => update((d) => ({ ...d, shipping: { ...d.shipping, ...patch } }));
  const dest = sh.destinations;
  const flat =
    sh.pricing.mode === "flat"
      ? sh.pricing
      : { mode: "flat" as const, default: 0, currency: "USD", overrides: [] };
  // Patch passthrough fields without dropping the sibling one.
  const pass = sh.pricing.mode === "passthrough" ? sh.pricing : { mode: "passthrough" as const };
  const rows = sh.fallback ?? [];
  return (
    <div className="space-y-3">
      <TabIntro>
        Two separate things live on this tab. <span className="font-medium">Speeds</span> are what the
        customer picks at checkout — we re-quote the printer for whichever one they choose.{" "}
        <span className="font-medium">What you charge</span> decides whether they pay that quote, a flat
        rate, or nothing. Not every speed reaches every country: the printer simply refuses one it
        doesn&apos;t run there, which fails the order after the customer has typed their address, so
        only enable speeds the grid below shows as available.
      </TabIntro>

      <Section
        title="Shipping speeds"
        hint="Delivery options offered to the customer (mapped to provider services). Measure costs to fill in which ones actually reach where you sell."
      >
        <div className="space-y-1.5">
          {SHIPPING_METHODS.map((method) => {
            const cfg = sh.methods.find((m) => m.method === method);
            const enabled = cfg?.enabled ?? false;
            const refusedIn = rows.filter((r) => r.method === method && !r.available).map((r) => r.country);
            const availableIn = rows.filter((r) => r.method === method && r.available).map((r) => r.country);
            return (
              <div key={method} className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex w-40 items-center gap-2 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        const exists = sh.methods.some((m) => m.method === method);
                        const methods = exists
                          ? sh.methods.map((m) => (m.method === method ? { ...m, enabled: e.target.checked } : m))
                          : [...sh.methods, { method, enabled: e.target.checked }];
                        setSh({ methods });
                      }}
                    />
                    {method}
                  </label>
                  <Input
                    className="h-8 flex-1 min-w-40 text-sm"
                    placeholder="Customer-facing label (optional)"
                    value={cfg?.label ?? ""}
                    onChange={(e) => {
                      const exists = sh.methods.some((m) => m.method === method);
                      const methods = exists
                        ? sh.methods.map((m) => (m.method === method ? { ...m, label: e.target.value } : m))
                        : [...sh.methods, { method, enabled: false, label: e.target.value }];
                      setSh({ methods });
                    }}
                  />
                </div>
                <p className="pl-6 text-[10px] leading-snug text-ink-400">
                  {SHIPPING_METHOD_HINTS[method]}
                  {rows.length > 0 && refusedIn.length > 0 && (
                    <span className="text-amber-600">
                      {" "}
                      Measured: not offered to {refusedIn.join(", ")}
                      {availableIn.length > 0 ? `; available to ${availableIn.join(", ")}` : ""}.
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      <ShippingRatesTable product={product} />

      <Section
        title="What you charge for shipping"
        hint="Charge the printer's cost and you never lose money on postage, but the customer sees a different number for every destination. A flat rate is predictable for them — you win on nearby orders and lose on distant ones. Free is simplest to sell, and you absorb it unless you fold it into the book price."
      >
        <Field label="Shipping charge" className="w-full sm:w-72">
          <Select
            value={sh.pricing.mode}
            options={[
              { value: "passthrough", label: "Charge the provider's cost" },
              { value: "free", label: "Free shipping" },
              { value: "flat", label: "Flat rate" },
            ]}
            onChange={(e) => {
              const mode = e.target.value as ProductDefinition["shipping"]["pricing"]["mode"];
              if (mode === "passthrough") setSh({ pricing: { mode, markupPct: 0 } });
              else if (mode === "free") setSh({ pricing: { mode, absorbInPrice: false } });
              else setSh({ pricing: { mode, default: 0, currency: "USD", overrides: [] } });
            }}
          />
        </Field>
        {sh.pricing.mode === "passthrough" && (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <NumberField label="Markup on shipping" value={sh.pricing.markupPct ?? 0} step="1" className="w-44" suffix="%" onChange={(n) => setSh({ pricing: { ...pass, markupPct: n } })} />
              <NumberField
                label="Fallback shipping cost"
                hint="Used only when a live quote can't be fetched AND the destination has no measured rate above."
                value={sh.pricing.fallbackCost ?? 0}
                step="0.5"
                className="w-56"
                suffix={product.cost.currency}
                onChange={(n) => setSh({ pricing: { ...pass, fallbackCost: n } })}
              />
            </div>
            <ImpactNote>
              This number is <span className="font-medium">charged to the customer</span>, plus your
              markup, whenever a live quote fails. Leave it empty and those orders are refused rather
              than shipped at your expense; set it too high and everyone caught by an outage is
              overcharged. Measuring costs fills it in from the dearest route it saw.
            </ImpactNote>
          </>
        )}
        {sh.pricing.mode === "free" && (
          <Field label="Cover the cost in the book price" className="w-full sm:w-64">
            <Select value={sh.pricing.absorbInPrice ? "yes" : "no"} options={[{ value: "no", label: "No (you absorb it)" }, { value: "yes", label: "Yes (build into price)" }]} onChange={(e) => setSh({ pricing: { mode: "free", absorbInPrice: e.target.value === "yes" } })} />
          </Field>
        )}
        {sh.pricing.mode === "flat" && (
          <Grid cols={2}>
            <NumberField label="Flat rate" value={flat.default} step="0.01" suffix={flat.currency} onChange={(n) => setSh({ pricing: { ...flat, default: n } })} />
            <TextField label="Currency" value={flat.currency} onChange={(v) => setSh({ pricing: { ...flat, currency: v.toUpperCase() } })} />
          </Grid>
        )}
      </Section>

      <MarketsSection dest={dest} rows={rows} onChange={(destinations) => setSh({ destinations })} />
    </div>
  );
}

/**
 * Which of our markets this product ships to.
 *
 * A checkbox per market rather than a comma-separated list of codes: the set is
 * small and fixed, and typing ISO codes into a text field is how you end up
 * selling to a country you never measured. `SUPPORTED_MARKETS` is a ceiling
 * enforced server-side, so there's deliberately no way to type in a country
 * outside it — that would render a box the order path refuses to honour.
 *
 * Each market also reports whether an enabled speed actually reaches it, because
 * "selected" and "orderable" are different things and the gap between them only
 * shows up at checkout otherwise.
 */
function MarketsSection({
  dest,
  rows,
  onChange,
}: {
  dest: GeoPolicy;
  rows: ShippingFallbackRow[];
  onChange: (dest: GeoPolicy) => void;
}) {
  const selected = SUPPORTED_MARKETS.filter((c) => isDestinationAllowed(dest, { country: c }));
  const toggle = (country: string, on: boolean) => {
    const next = on
      ? [...selected, country]
      : selected.filter((c) => c !== country);
    // Always written as an allowlist. A stored blocklist is read correctly above
    // but never produced here: two ways to express one intent is how a policy
    // ends up meaning the opposite of what it reads like.
    onChange({ ...dest, mode: "allowlist", countries: [...new Set(next)] });
  };

  return (
    <Section
      title="Where it ships"
      hint="The markets this product can be ordered to. Customers outside them can't reach checkout, and the server refuses the order regardless."
    >
      <div className="space-y-1.5">
        {SUPPORTED_MARKETS.map((country) => {
          const on = selected.includes(country);
          const measured = rows.filter((r) => r.country === country);
          const priced = measured.filter((r) => r.available).length;
          return (
            <div key={country} className="flex flex-wrap items-center gap-2">
              <label className="flex w-56 items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => toggle(country, e.target.checked)}
                  className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                />
                <span>
                  {countryFlag(country)} {countryLabel(country)}
                </span>
              </label>
              {on && measured.length === 0 && (
                <span className="text-[11px] text-amber-700">
                  No shipping measured — run “Measure cost from the provider”.
                </span>
              )}
              {on && measured.length > 0 && priced === 0 && (
                <span className="text-[11px] text-red-600">
                  The printer quotes no speed here — orders will fail.
                </span>
              )}
              {on && priced > 0 && (
                <span className="text-[11px] text-ink-400">
                  {priced} speed{priced === 1 ? "" : "s"} available
                </span>
              )}
            </div>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-[11px] text-red-600">
          No markets selected — this product can&apos;t be ordered anywhere.
        </p>
      )}
      <p className="text-[10px] text-ink-400">
        Adding a market means measuring shipping to it and checking its tax setup, so the list is
        fixed in code rather than typed here.
      </p>
    </Section>
  );
}

