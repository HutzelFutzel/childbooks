import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import {
  AGE_RANGES,
  ART_STYLE_PRESETS,
  GRAPHICS_DENSITY,
  LAYOUT_TEMPLATES,
  SPREAD_USAGE,
  TEXT_HANDLING,
  TEXT_PLACEMENT,
} from "../../../core/config/options";
import { ageBandHasReadingModes, readingModeLabel } from "../../../core/config/ageWritingCatalog";
import { bookProductForConfig } from "../../../core/book";
import { selectModels } from "../../../core/models/registry";
import { useSettingsStore } from "../../../state/settingsStore";
import type { StepProps } from "./types";

function find<T extends { id: string; label: string }>(list: T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink-800">{value}</dd>
    </div>
  );
}

export function ReviewStep({ config }: StepProps) {
  const providerAvailable = useSettingsStore((s) => s.providerAvailable);
  const discovery = useSettingsStore((s) => s.discovery);
  const models = useMemo(
    () => selectModels(discovery, (p) => providerAvailable[p]),
    [discovery, providerAvailable],
  );

  const style = config.artStyle.presetId
    ? find(ART_STYLE_PRESETS, config.artStyle.presetId)
    : "Custom";
  const styleExtra = config.artStyle.customDescription?.trim();

  const product = bookProductForConfig(config);
  const r = (n: number) => Math.round(n * 10) / 10;
  const sizeValue = `${product.label} · ${r(product.trim.widthIn)} × ${r(product.trim.heightIn)} in`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Review & start</h2>
        <p className="mt-1 text-sm text-ink-500">
          Confirm your setup. Next, the studio analyzes your story to build consistent characters &amp; places.
        </p>
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <dl className="divide-y divide-ink-100">
          <Row
            label="AI models"
            value={models ? "Chosen automatically" : "Being set up on the server"}
          />
          <Row label="Art style" value={styleExtra ? `${style} + custom` : style} />
          <Row label="Age range" value={find(AGE_RANGES, config.ageRangeId)} />
          {ageBandHasReadingModes(config.ageRangeId) && config.readingModeId && (
            <Row label="Reading mode" value={readingModeLabel(config.readingModeId)} />
          )}
          <Row label="Book size" value={sizeValue} />
          <Row label="Graphics" value={find(GRAPHICS_DENSITY, config.graphicsDensity)} />
          <Row label="Spreads" value={find(SPREAD_USAGE, config.spreadUsage)} />
          <Row label="Text handling" value={find(TEXT_HANDLING, config.textHandling)} />
          <Row label="Text placement" value={find(TEXT_PLACEMENT, config.textPlacement)} />
          <Row label="Layout" value={find(LAYOUT_TEMPLATES, config.layoutId)} />
        </dl>
      </div>

      <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800">
        <Sparkles className="mt-0.5 size-4 shrink-0" />
        <p>
          When you continue, your story moves to the <strong>Analysis</strong> stage where
          characters, places, and key objects are detected to build visual references.
        </p>
      </div>
    </div>
  );
}
