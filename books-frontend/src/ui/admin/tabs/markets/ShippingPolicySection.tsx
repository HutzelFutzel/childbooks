"use client";

/**
 * Configuration → Markets → Shipping policy. How shipping is SOLD, for the
 * whole catalog.
 *
 * This used to be five copies of the same decision, one per product, and the
 * copies drifted — a speed enabled on three books and forgotten on the fourth
 * is invisible in the admin and surfaces as a customer who can't pick it. What
 * stays on the product is the measurement, which genuinely differs by weight.
 *
 * Two things this screen deliberately does not let you do. It can't declare
 * that a speed reaches a country: coverage is discovered by the sweep, and a
 * hand-typed claim about a carrier goes stale silently. And it can't be saved
 * blind — the diff below runs the real projection against the candidate policy,
 * because "untick Budget" reads as one checkbox and lands as ninety
 * withdrawals.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Select } from "../../../components/Select";
import { useReadOnly } from "../../../components/ReadOnlyContext";
import { cn } from "../../../lib/cn";
import { countryLabel } from "../../../../core/analytics/markets";
import {
  METHOD_HINTS,
  SHIPPING_METHODS,
  methodLabel,
  withPricingMode,
  type ShippingPricingMode,
  type ShippingSettings,
} from "../../../../core/config/shipping";
import type { ShippingPreview } from "../../../../core/config/shippingPreview";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Section } from "../products/parts";

const MODES: { value: ShippingPricingMode; label: string; hint: string }[] = [
  {
    value: "passthrough",
    label: "Charge what it costs",
    hint: "The provider's rate for the actual route, plus whatever markup and handling you set below. The only mode where offering every speed is safe, because the price follows the speed.",
  },
  {
    value: "flat",
    label: "Flat rate per speed",
    hint: "One published amount per speed, whatever the destination. You absorb the difference on long routes — so each speed has to be priced and ticked deliberately.",
  },
  {
    value: "free",
    label: "Free shipping",
    hint: "The customer pays nothing and the cost comes out of margin. Fold it into the book price unless you mean to give it away.",
  },
];

/**
 * @param loading The tab fetches this policy alongside the market table, so
 * this section is told when that's done rather than fetching it again. It also
 * has to be told: the country rows above offer per-country speed toggles that
 * write the same document, and letting either surface act on the seeded default
 * before the real one arrives would overwrite it.
 */
export function ShippingPolicySection({ loading }: { loading: boolean }) {
  const readOnly = useReadOnly();
  const save = useAppConfigStore((s) => s.saveShippingSettings);
  const preview = useAppConfigStore((s) => s.previewShippingSettings);
  const stored = useAppConfigStore((s) => s.shippingSettings);
  const currencies = useAppConfigStore((s) => s.pricingSettings.currencies);

  const [draft, setDraft] = useState<ShippingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [diff, setDiff] = useState<ShippingPreview | null>(null);
  const [checking, setChecking] = useState(false);

  // Null until the admin touches something, so a change made elsewhere — the
  // per-country toggles above write this same document — shows up here instead
  // of being masked by a draft taken at mount.
  const config = draft ?? stored;
  const dirty = useMemo(
    () => JSON.stringify(comparable(config)) !== JSON.stringify(comparable(stored)),
    [config, stored],
  );

  // Any edit invalidates the diff. Leaving a stale one on screen would be worse
  // than showing none: it describes a policy that is no longer the one the save
  // button would write.
  const patch = (next: ShippingSettings) => {
    setDraft(next);
    setDiff(null);
  };

  const runPreview = async () => {
    setChecking(true);
    try {
      setDiff(await preview(config));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not preview the change.");
    } finally {
      setChecking(false);
    }
  };

  const commit = async () => {
    setSaving(true);
    try {
      await save(config);
      setDraft(null);
      setDiff(null);
      toast.success("Shipping policy saved and the catalog republished.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the shipping policy.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Section title="Shipping policy">
        <div className="flex items-center gap-2 py-4 text-sm text-ink-400">
          <Loader2 className="size-4 animate-spin" /> Loading shipping policy…
        </div>
      </Section>
    );
  }

  const { pricing } = config;

  return (
    <Section
      title="Shipping policy"
      hint="One policy for every book. Which speeds you're willing to sell, and what you charge for them — availability per country is discovered, not declared here."
      action={
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={readOnly || !dirty || checking} onClick={runPreview}>
            {checking ? "Checking…" : "Preview changes"}
          </Button>
          <Button size="sm" disabled={readOnly || !dirty || saving} onClick={commit}>
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="How shipping is priced" hint={MODES.find((m) => m.value === pricing.mode)?.hint}>
          <Select
            value={pricing.mode}
            options={MODES.map((m) => ({ value: m.value, label: m.label }))}
            onChange={(e) => patch(withPricingMode(config, e.target.value as ShippingPricingMode))}
          />
        </Field>

        {pricing.mode === "passthrough" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Markup" hint="Percent on the provider's rate.">
              <Input
                type="number"
                min={0}
                step={1}
                value={pricing.markupPct}
                onChange={(e) =>
                  patch({
                    ...config,
                    pricing: { ...pricing, markupPct: Math.max(0, Number(e.target.value) || 0) },
                  })
                }
              />
            </Field>
            <Field label="Handling fee" hint="A flat amount on top, after markup.">
              <Input
                type="number"
                min={0}
                step={0.5}
                value={pricing.fixedAdd}
                onChange={(e) =>
                  patch({
                    ...config,
                    pricing: { ...pricing, fixedAdd: Math.max(0, Number(e.target.value) || 0) },
                  })
                }
              />
            </Field>
            <Field label="Charged" hint="Per order, or once for every copy in it.">
              <Select
                value={pricing.fixedAddKind}
                options={[
                  { value: "perOrder", label: "Once per order" },
                  { value: "perCopy", label: "Per copy" },
                ]}
                onChange={(e) =>
                  patch({
                    ...config,
                    pricing: {
                      ...pricing,
                      fixedAddKind: e.target.value as "perOrder" | "perCopy",
                    },
                  })
                }
              />
            </Field>
            <Field
              label="Handling fee currency"
              hint="It's a price, so it converts at the plain rate rather than the FX-buffered one used for costs."
              className="sm:col-span-3"
            >
              <Select
                value={pricing.fixedAddCurrency}
                options={currencies.map((c) => ({ value: c, label: c }))}
                onChange={(e) =>
                  patch({ ...config, pricing: { ...pricing, fixedAddCurrency: e.target.value } })
                }
              />
            </Field>
          </div>
        )}

        {pricing.mode === "free" && (
          <label className="flex items-start gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={pricing.absorbInPrice}
              onChange={(e) =>
                patch({ ...config, pricing: { ...pricing, absorbInPrice: e.target.checked } })
              }
              className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
            />
            <span>
              Fold the shipping cost into the book price. Off means it comes straight out of margin,
              which is a real per-order loss on long routes.
            </span>
          </label>
        )}

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Speeds we sell
          </div>
          <p className="text-[11px] leading-relaxed text-ink-400">
            {pricing.mode === "passthrough"
              ? "Ticked means “sell it wherever the printer runs it”. Opening a new market needs no work here — coverage decides what actually appears at checkout."
              : "Each speed needs its own rate below. Under this mode a ticked speed with no rate can't be sold, because there'd be no price to charge for it."}
          </p>
          <ul className="divide-y divide-ink-100 rounded-lg bg-white ring-1 ring-inset ring-ink-100">
            {SHIPPING_METHODS.map((method) => {
              const setting = config.methods[method];
              return (
                <li key={method} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <label className="flex w-48 min-w-0 items-center gap-2 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      disabled={readOnly}
                      checked={setting.offered}
                      onChange={(e) =>
                        patch({
                          ...config,
                          methods: {
                            ...config.methods,
                            [method]: { ...setting, offered: e.target.checked },
                          },
                        })
                      }
                      className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                    />
                    <span className="truncate">{methodLabel(config, method)}</span>
                  </label>
                  <span className="flex-1 text-[11px] text-ink-400">{METHOD_HINTS[method]}</span>
                  {pricing.mode === "flat" && setting.offered && (
                    <span className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={pricing.flatPerMethod[method] ?? ""}
                        placeholder="rate"
                        className="h-8 w-24 text-xs"
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          const next = { ...pricing.flatPerMethod };
                          if (raw === "") delete next[method];
                          else next[method] = Math.max(0, Number(raw) || 0);
                          patch({ ...config, pricing: { ...pricing, flatPerMethod: next } });
                        }}
                      />
                      <span className="text-[11px] text-ink-400">{pricing.flatCurrency}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {diff && <PreviewPanel diff={diff} />}
      </div>
    </Section>
  );
}

/**
 * The diff, read as consequences rather than as a field-by-field changelog.
 *
 * Withdrawals come first and are the only rows tinted: gaining a speed is a
 * pleasant surprise, losing one is a customer who could order yesterday and
 * can't today, and those two do not deserve equal weight on the screen.
 */
function PreviewPanel({ diff }: { diff: ShippingPreview }) {
  const { totals } = diff;
  const nothing =
    totals.gained + totals.lost + totals.repriced + totals.unpriceable === 0;

  if (nothing) {
    return (
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-[11px] text-ink-500 ring-1 ring-inset ring-ink-100">
        Nothing the storefront shows would change. The edit affects settings that don&apos;t reach
        the published rates — labels, or a mode&apos;s unused fields.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap gap-2 text-[11px]">
        {totals.lost > 0 && (
          <Pill tone="bad">{totals.lost} routes withdrawn</Pill>
        )}
        {totals.gained > 0 && <Pill tone="ok">{totals.gained} routes opened</Pill>}
        {totals.repriced > 0 && <Pill>{totals.repriced} rates change</Pill>}
        {totals.unpriceable > 0 && (
          <Pill tone="bad">{totals.unpriceable} lose their published price</Pill>
        )}
      </div>

      {diff.availability.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
          {diff.availability.map((c, i) => (
            <li
              key={`${c.productSku}-${c.country}-${c.method}-${i}`}
              className={cn(c.kind === "lost" ? "text-red-600" : "text-emerald-700")}
            >
              {c.kind === "lost" ? "−" : "+"} {countryLabel(c.country)} · {c.method} ·{" "}
              <span className="text-ink-400">{c.productSku}</span>
            </li>
          ))}
        </ul>
      )}

      {diff.prices.length > 0 && (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-ink-600">
          {diff.prices.map((c, i) => (
            <li key={`${c.productSku}-${c.country}-${c.method}-${i}`}>
              {countryLabel(c.country)} · {c.method}: {c.before.toFixed(2)} →{" "}
              <span className="font-medium">{c.after.toFixed(2)}</span> {c.currency}{" "}
              <span className="text-ink-400">{c.productSku}</span>
            </li>
          ))}
        </ul>
      )}

      {diff.truncated && (
        <p className="text-[10px] text-ink-400">
          Only the first rows are listed; the counts above cover the whole change.
        </p>
      )}
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "bad" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        tone === "ok" && "bg-emerald-50 text-emerald-700",
        tone === "bad" && "bg-red-50 text-red-600",
        !tone && "bg-ink-100 text-ink-600",
      )}
    >
      {children}
    </span>
  );
}

/** Compare only what an admin can change, so timestamps don't read as edits. */
function comparable(config: ShippingSettings) {
  const { updatedAt: _updatedAt, updatedBy: _updatedBy, ...rest } = config;
  return rest;
}
