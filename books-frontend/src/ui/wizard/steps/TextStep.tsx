import { useEffect } from "react";
import { layoutsForPlacement, TEXT_HANDLING } from "../../../core/config/options";
import { OptionCard } from "../../components/OptionCard";
import { LayoutDiagram } from "../visuals";
import type { StepProps } from "./types";

export function TextStep({ config, update }: StepProps) {
  const layouts = layoutsForPlacement(config.textPlacement, config.spreadUsage);

  // Keep the chosen layout valid for the current placement/spread combo.
  useEffect(() => {
    if (!layouts.some((l) => l.id === config.layoutId)) {
      update({ layoutId: layouts[0]?.id ?? "auto" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.textPlacement, config.spreadUsage]);

  return (
    <div className="space-y-7">
      <section>
        <h2 className="text-lg font-semibold text-ink-900">Text & wording</h2>
        <p className="mt-1 text-sm text-ink-500">Decide how faithfully to keep your words.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TEXT_HANDLING.map((t) => (
            <OptionCard
              key={t.id}
              selected={config.textHandling === t.id}
              onSelect={() => update({ textHandling: t.id })}
              title={t.label}
              description={t.description}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink-700">Page layout</h3>
        <p className="mt-1 text-xs text-ink-500">
          Text is always laid out by the app as an editable layer (never baked into
          the art). Pick a layout, or let the system choose per page.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {layouts.map((l) => (
            <OptionCard
              key={l.id}
              selected={config.layoutId === l.id}
              onSelect={() => update({ layoutId: l.id })}
              title={l.label}
              description={l.description}
              visual={<LayoutDiagram template={l} />}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
