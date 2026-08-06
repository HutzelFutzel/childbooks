"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { useAdminProjects } from "../../../state/adminProjectsStore";
import { AGE_RANGES, ART_STYLE_PRESETS } from "../../../core/config/options";
import { BOOK_PRODUCTS } from "../../../core/fulfillment";
import { MILESTONES } from "./milestones";

/**
 * The slicers for the books report.
 *
 * Every control here narrows the same server-side set, so the table, the
 * per-user cut and the distributions all describe the same population — "premium
 * tier books that never reached a cover" is one selection, not three queries.
 */
export function ProjectFilterBar() {
  const filters = useAdminProjects((s) => s.filters);
  const setFilters = useAdminProjects((s) => s.setFilters);
  const clearFilters = useAdminProjects((s) => s.clearFilters);
  const stats = useAdminProjects((s) => s.stats);
  const [open, setOpen] = useState(false);

  const active = useMemo(
    () => Object.values(filters).filter((v) => v !== "").length,
    [filters],
  );

  // Model options come from the data: the catalog holds every model we *could*
  // route to, but only a handful ever drew a book, and a filter listing models
  // with no rows behind them is just noise.
  const modelOptions = useMemo(() => {
    const seen = new Set(Object.keys(stats?.imagesByModel ?? {}));
    if (filters.imageModel) seen.add(filters.imageModel);
    return [
      { value: "", label: "Any model" },
      ...[...seen].sort().map((m) => ({ value: m, label: m })),
    ];
  }, [stats, filters.imageModel]);

  const milestoneOptions = (placeholder: string) => [
    { value: "", label: placeholder },
    ...MILESTONES.map((m) => ({ value: m.key, label: m.label })),
  ];

  return (
    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-ink-100 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<SlidersHorizontal className="size-4" />}
          onClick={() => setOpen(!open)}
        >
          Filters
          {active > 0 && (
            <span className="ml-1.5 rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700">
              {active}
            </span>
          )}
        </Button>

        {/* The two most-used slicers stay out where they can be reached. */}
        <Select
          aria-label="Reached milestone"
          value={filters.milestoneReached}
          onChange={(e) => setFilters({ milestoneReached: e.target.value })}
          className="h-9 w-44"
          options={milestoneOptions("Reached any stage")}
        />
        <Select
          aria-label="Did not reach milestone"
          value={filters.milestoneMissing}
          onChange={(e) => setFilters({ milestoneMissing: e.target.value })}
          className="h-9 w-44"
          options={milestoneOptions("Died before…")}
        />
        <Select
          aria-label="Image tier"
          value={filters.tier}
          onChange={(e) => setFilters({ tier: e.target.value })}
          className="h-9 w-36"
          options={[
            { value: "", label: "Any tier" },
            { value: "quick", label: "Quick" },
            { value: "premium", label: "Premium" },
          ]}
        />

        {active > 0 && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<X className="size-4" />}
            onClick={clearFilters}
          >
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 grid gap-3 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Image model">
            <Select
              value={filters.imageModel}
              onChange={(e) => setFilters({ imageModel: e.target.value })}
              className="h-9"
              options={modelOptions}
            />
          </Field>
          <Field label="Art style">
            <Select
              value={filters.artStyleKey}
              onChange={(e) => setFilters({ artStyleKey: e.target.value })}
              className="h-9"
              options={[
                { value: "", label: "Any style" },
                ...ART_STYLE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
          </Field>
          <Field label="Age band">
            <Select
              value={filters.ageRangeId}
              onChange={(e) => setFilters({ ageRangeId: e.target.value })}
              className="h-9"
              options={[
                { value: "", label: "Any age" },
                ...AGE_RANGES.map((a) => ({ value: a.id, label: a.label })),
              ]}
            />
          </Field>
          <Field label="Product">
            <Select
              value={filters.productSku}
              onChange={(e) => setFilters({ productSku: e.target.value })}
              className="h-9"
              options={[
                { value: "", label: "Any product" },
                ...BOOK_PRODUCTS.map((p) => ({ value: p.sku, label: p.label })),
              ]}
            />
          </Field>
          <RangeField
            label="Pages"
            min={filters.minPages}
            max={filters.maxPages}
            onMin={(v) => setFilters({ minPages: v })}
            onMax={(v) => setFilters({ maxPages: v })}
          />
          <RangeField
            label="Cast"
            min={filters.minCast}
            max={filters.maxCast}
            onMin={(v) => setFilters({ minCast: v })}
            onMax={(v) => setFilters({ maxCast: v })}
          />
          <RangeField
            label="Images"
            min={filters.minImages}
            max={filters.maxImages}
            onMin={(v) => setFilters({ minImages: v })}
            onMax={(v) => setFilters({ maxImages: v })}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-400">{label}</span>
      {children}
    </label>
  );
}

/** A min/max pair. Committed on blur/Enter so each keystroke isn't a request. */
function RangeField({
  label,
  min,
  max,
  onMin,
  onMax,
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <NumberInput value={min} onCommit={onMin} placeholder="min" />
        <span className="text-xs text-ink-400">–</span>
        <NumberInput value={max} onCommit={onMax} placeholder="max" />
      </div>
    </Field>
  );
}

function NumberInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  // Follow the store when it's reset from outside (e.g. Clear).
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === "Enter" && onCommit(draft)}
      className="h-9 w-full text-xs"
    />
  );
}
