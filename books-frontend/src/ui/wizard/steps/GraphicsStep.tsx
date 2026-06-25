import { useEffect } from "react";
import { GRAPHICS_DENSITY, spreadOptionsForSize } from "../../../core/config/options";
import { OptionCard } from "../../components/OptionCard";
import { DensityDiagram, SpreadDiagram } from "../visuals";
import type { StepProps } from "./types";

export function GraphicsStep({ config, update }: StepProps) {
  const spreadOptions = spreadOptionsForSize(config.bookSize);

  // Keep spreadUsage valid for the chosen size.
  useEffect(() => {
    if (!spreadOptions.some((o) => o.id === config.spreadUsage)) {
      update({ spreadUsage: spreadOptions[0]?.id ?? "single" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.bookSize]);

  return (
    <div className="space-y-7">
      <section>
        <h2 className="text-lg font-semibold text-ink-900">Graphics layout</h2>
        <p className="mt-1 text-sm text-ink-500">
          How many illustrations should appear on a page?
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {GRAPHICS_DENSITY.map((d) => (
            <OptionCard
              key={d.id}
              selected={config.graphicsDensity === d.id}
              onSelect={() => update({ graphicsDensity: d.id })}
              title={d.label}
              description={d.description}
              visual={<DensityDiagram density={d.id} />}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink-700">Page spreads</h3>
        <p className="mt-1 text-xs text-ink-500">
          Options are tailored to your {config.bookSize} book size.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {spreadOptions.map((s) => (
            <OptionCard
              key={s.id}
              selected={config.spreadUsage === s.id}
              onSelect={() => update({ spreadUsage: s.id })}
              title={s.label}
              description={s.description}
              visual={<SpreadDiagram usage={s.id} />}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
