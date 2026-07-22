"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Package,
  Plus,
  Ruler,
  Sparkles,
  Tag,
  Trash2,
  Truck,
  Upload,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Select } from "../../components/Select";
import { Tabs } from "../../components/Tabs";
import { cn } from "../../lib/cn";
import {
  FULFILLMENT_PROVIDERS,
  PROVIDER_LABELS,
  createDefaultProduct,
  productAccessOf,
  type ProductAccess,
  type ProductDefinition,
  type ProductImage,
} from "../../../core/config/products";
import { isOfferable, productErrors, validateProduct, type ProductIssue } from "../../../core/config/productValidation";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Disclosure, Grid, NumberField, Section, TabIntro, TextField } from "./products/parts";
import { CostSection, PricingSection } from "./products/ProductPricing";

type Update = (fn: (p: ProductDefinition) => ProductDefinition) => void;

const BINDINGS = ["saddle-stitch", "perfect-bound", "coil-bound", "casewrap", "linen-wrap"] as const;
const FINISHES = ["matte", "gloss"] as const;
const ORIENTATIONS = ["square", "landscape", "portrait"] as const;
const SHIPPING_METHODS = ["Budget", "Standard", "StandardPlus", "Express", "Overnight"] as const;

const EDITOR_TABS = [
  { id: "details", label: "Details", icon: <Tag className="size-4" /> },
  { id: "format", label: "Format", icon: <Ruler className="size-4" /> },
  { id: "pricing", label: "Pricing", icon: <Sparkles className="size-4" /> },
  { id: "costs", label: "Costs", icon: <Package className="size-4" /> },
  { id: "shipping", label: "Shipping", icon: <Truck className="size-4" /> },
  { id: "images", label: "Images", icon: <ImageIcon className="size-4" /> },
];

export function ProductsTab() {
  const loadAdminProducts = useAppConfigStore((s) => s.loadAdminProducts);
  const saveProductFn = useAppConfigStore((s) => s.saveProduct);
  const deleteProductFn = useAppConfigStore((s) => s.deleteProductById);
  const seedProductsFn = useAppConfigStore((s) => s.seedProducts);
  const settings = useAppConfigStore((s) => s.pricingSettings);

  const [products, setProducts] = useState<ProductDefinition[]>([]);
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

  const issues = useMemo(() => (draft ? validateProduct(draft, settings) : []), [draft, settings]);
  const errors = issues.filter((i) => i.level === "error");

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
            Currencies, payment fees and tax that turn these prices into margins are set once under{" "}
            <span className="font-medium">Financial settings</span>.
          </>
        }
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
            <Button variant="secondary" size="sm" leftIcon={<Sparkles className="size-4" />} loading={seeding} onClick={onSeed} title="Seed from the print catalog">
              Seed
            </Button>
          </div>

          {products.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-200 p-5 text-center text-xs text-ink-400">
              No products yet. Click <span className="font-medium text-ink-500">Seed</span> to import the print catalog,
              or add one.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {products.map((p) => {
                const offerable = isOfferable(p, settings);
                const errCount = productErrors(p, settings).length;
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
                  <StatusDot status={draft.status} offerable={isOfferable(draft, settings)} />
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
                  <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty || errors.length > 0} title={errors.length ? "Fix errors before saving" : undefined}>
                    Save product
                  </Button>
                </div>
              </div>

              <ValidationBanner issues={issues} />

              <Tabs items={EDITOR_TABS} value={editorTab} onChange={setEditorTab} />

              <div className="rounded-xl ring-1 ring-inset ring-ink-100 p-3">
                {editorTab === "details" && <DetailsSection product={draft} update={update} />}
                {editorTab === "format" && <FormatSection product={draft} update={update} />}
                {editorTab === "pricing" && <PricingSection product={draft} update={update} settings={settings} />}
                {editorTab === "costs" && <CostSection product={draft} update={update} />}
                {editorTab === "shipping" && <ShippingSection product={draft} update={update} />}
                {editorTab === "images" && <ImagesSection product={draft} update={update} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status, offerable }: { status: ProductDefinition["status"]; offerable: boolean }) {
  if (status === "active" && offerable) return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />;
  if (status === "active") return <AlertTriangle className="size-4 shrink-0 text-amber-500" />;
  if (status === "retired") return <span className="size-2.5 shrink-0 rounded-full bg-ink-300" />;
  return <span className="size-2.5 shrink-0 rounded-full bg-amber-300" />;
}

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
  return (
    <div className="space-y-1.5">
      {errors.length > 0 && (
        <div className="space-y-1 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 ring-1 ring-inset ring-red-200">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-4" /> {errors.length} error{errors.length === 1 ? "" : "s"} — fix before saving
          </div>
          <ul className="ml-5 list-disc space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
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
        <TextField label="Name" value={p.name} onChange={(v) => setP({ name: v })} />
        <TextField label="Tagline" value={p.tagline ?? ""} placeholder="Optional one-liner" onChange={(v) => setP({ tagline: v })} />
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

function FormatSection({ product, update }: { product: ProductDefinition; update: Update }) {
  return (
    <div className="space-y-3">
      <ProviderFields product={product} update={update} />
      <SpecFields product={product} update={update} />
      <ConditionsFields product={product} update={update} />
    </div>
  );
}

function ProviderFields({ product, update }: { product: ProductDefinition; update: Update }) {
  const pr = product.provider;
  const setPr = (patch: Partial<ProductDefinition["provider"]>) =>
    update((d) => ({ ...d, provider: { ...d.provider, ...patch } }));
  return (
    <Section title="Print provider" hint="Which provider prints and ships this book. Their API handles quotes and orders.">
      <Grid cols={2}>
        <Field label="Provider">
          <Select
            value={pr.id}
            options={FULFILLMENT_PROVIDERS.map((id) => ({ value: id, label: PROVIDER_LABELS[id] }))}
            onChange={(e) => setPr({ id: e.target.value as ProductDefinition["provider"]["id"] })}
          />
        </Field>
        <Field label="Verified against catalog">
          <Select
            value={pr.verified ? "yes" : "no"}
            options={[
              { value: "no", label: "Not verified" },
              { value: "yes", label: "Verified" },
            ]}
            onChange={(e) => setPr({ verified: e.target.value === "yes" })}
          />
        </Field>
      </Grid>
      <TextField label="Provider SKU" value={pr.sku} placeholder="e.g. 0850X0850.FC.STD.CW.080CW444.GXX" onChange={(v) => setPr({ sku: v })} />
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
        <Field label="Binding">
          <Select value={s.binding} options={BINDINGS.map((b) => ({ value: b, label: b }))} onChange={(e) => setS({ binding: e.target.value as ProductDefinition["spec"]["binding"] })} />
        </Field>
        <Field label="Finish">
          <Select value={s.finish} options={FINISHES.map((f) => ({ value: f, label: f }))} onChange={(e) => setS({ finish: e.target.value as ProductDefinition["spec"]["finish"] })} />
        </Field>
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
  return (
    <div className="space-y-3">
      <Section title="Shipping speeds" hint="Delivery options offered to the customer (mapped to provider services).">
        <div className="space-y-1.5">
          {SHIPPING_METHODS.map((method) => {
            const cfg = sh.methods.find((m) => m.method === method);
            const enabled = cfg?.enabled ?? false;
            return (
              <div key={method} className="flex flex-wrap items-center gap-2">
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
            );
          })}
        </div>
      </Section>

      <Section title="What you charge for shipping" hint="How shipping cost is passed on to the customer.">
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
          <NumberField label="Markup on shipping" value={sh.pricing.markupPct ?? 0} step="1" className="w-44" suffix="%" onChange={(n) => setSh({ pricing: { mode: "passthrough", markupPct: n } })} />
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

      <Section title="Where it ships" hint="Restrict where this product can ship by country.">
        <Field label="Policy" className="w-full sm:w-72">
          <Select
            value={dest.mode}
            options={[
              { value: "all", label: "Ship anywhere" },
              { value: "allowlist", label: "Only these countries" },
              { value: "blocklist", label: "Everywhere except these countries" },
            ]}
            onChange={(e) => setSh({ destinations: { ...dest, mode: e.target.value as typeof dest.mode } })}
          />
        </Field>
        {dest.mode !== "all" && (
          <TextField
            label="Countries (ISO-2, comma-separated)"
            value={dest.countries.join(", ")}
            placeholder="US, CA, GB, DE"
            onChange={(v) => setSh({ destinations: { ...dest, countries: v.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) } })}
          />
        )}
      </Section>
    </div>
  );
}

function ImagesSection({ product, update }: { product: ProductDefinition; update: Update }) {
  const uploadProductImage = useAppConfigStore((s) => s.uploadProductImage);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<ProductImage["role"]>("hero");

  const images = product.presentation.images;
  const setImages = (next: ProductImage[]) =>
    update((d) => ({ ...d, presentation: { ...d.presentation, images: next } }));

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const img = await uploadProductImage(product.id, base64, file.type, role);
      setImages([...images, img]);
      toast.success("Image uploaded — Save the product to keep it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <Section
        title="Product images"
        hint="A hero image and gallery shots. Uploaded immediately; remember to Save the product to keep the reference."
        action={
          <div className="flex items-end gap-1.5">
            <Select
              className="h-8 w-32 text-sm"
              value={role}
              options={[
                { value: "hero", label: "Hero" },
                { value: "gallery", label: "Gallery" },
                { value: "sizeGuide", label: "Size guide" },
              ]}
              onChange={(e) => setRole(e.target.value as ProductImage["role"])}
            />
            <Button variant="secondary" size="sm" leftIcon={<Upload className="size-4" />} loading={uploading} onClick={() => fileRef.current?.click()}>
              Upload
            </Button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </div>
        }
      >
        {images.length === 0 ? (
          <p className="text-[11px] text-ink-400">No images yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((img, i) => (
              <div key={i} className="group relative overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt ?? ""} className="aspect-square w-full object-cover" />
                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{img.role}</span>
                <button
                  onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                  className="absolute right-1.5 top-1.5 rounded bg-white/90 p-1 text-red-600 opacity-0 transition group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
