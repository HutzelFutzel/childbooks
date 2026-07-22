import { Lock } from "lucide-react";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useFeatureAllowed } from "../../../state/subscriptionStore";
import { useBillingUiStore } from "../../../state/billingUiStore";
import { Field, Textarea } from "../../components/Input";
import { OptionCard } from "../../components/OptionCard";
import { StyleSwatch } from "../visuals";
import type { StepProps } from "./types";

export function StyleStep({ config, update }: StepProps) {
  const { artStyle } = config;
  const examples = useAppConfigStore((s) => s.artStyles.examples);
  // Data-driven gate: free for everyone until an admin lists "customArtStyle"
  // on a plan, then only those plans may add free-text style directions.
  const customAllowed = useFeatureAllowed("customArtStyle");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ART_STYLE_PRESETS.map((style) => (
          <OptionCard
            key={style.id}
            selected={artStyle.presetId === style.id}
            onSelect={() => update({ artStyle: { ...artStyle, presetId: style.id } })}
            title={style.label}
            description={style.description}
            visual={<StyleSwatch swatch={style.swatch} imageUrl={examples[style.id]?.imageUrl} />}
          />
        ))}
      </div>

      {customAllowed ? (
        <Field
          label="Creative additions (optional)"
          hint="Describe extra direction, e.g. 'muted autumn palette, cozy lighting, friendly round characters'."
        >
          <Textarea
            value={artStyle.customDescription ?? ""}
            onChange={(e) =>
              update({ artStyle: { ...artStyle, customDescription: e.target.value } })
            }
            placeholder="Add your own twist to the selected style…"
            rows={3}
          />
        </Field>
      ) : (
        <UpgradeNudge />
      )}
    </div>
  );
}

/** Locked custom-style teaser shown when the feature is gated to other plans. */
function UpgradeNudge() {
  const openPlans = useBillingUiStore((s) => s.openPlans);
  return (
    <button
      type="button"
      onClick={openPlans}
      className="flex w-full items-start gap-3 rounded-2xl border border-dashed border-ink-200 bg-ink-50/60 p-4 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
        <Lock className="size-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-800">
          Custom style directions are a subscriber perk
        </span>
        <span className="mt-0.5 block text-xs text-ink-500">
          Upgrade to add your own creative twist on top of the preset styles — palettes, lighting,
          character shapes and more.
        </span>
      </span>
    </button>
  );
}
