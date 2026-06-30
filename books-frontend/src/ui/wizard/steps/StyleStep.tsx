import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Field, Textarea } from "../../components/Input";
import { OptionCard } from "../../components/OptionCard";
import { StyleSwatch } from "../visuals";
import type { StepProps } from "./types";

export function StyleStep({ config, update }: StepProps) {
  const { artStyle } = config;
  const examples = useAppConfigStore((s) => s.artStyles.examples);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Pick an art style</h2>
        <p className="mt-1 text-sm text-ink-500">
          Choose a base look. You can layer your own creative direction on top.
        </p>
      </div>

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
    </div>
  );
}
