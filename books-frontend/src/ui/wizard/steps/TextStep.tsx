import { useEffect, useMemo } from "react";
import { BASE_LAYOUT_IDS, layoutsForPlacement, TEXT_HANDLING } from "../../../core/config/options";
import { entitlementsForSubscription, layoutAllowed } from "../../../core/config/entitlements";
import { activeSubscription } from "../../../platform/subscriptions";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useSubscriptionStore } from "../../../state/subscriptionStore";
import { OptionCard } from "../../components/OptionCard";
import { LayoutDiagram } from "../visuals";
import type { StepProps } from "./types";

export function TextStep({ config, update }: StepProps) {
  const layouts = layoutsForPlacement(config.textPlacement, config.spreadUsage);

  // Resolve the user's plan entitlements to gate premium layouts. Premium
  // layouts the plan doesn't unlock are shown locked (with an upsell hint).
  const publicPlans = useAppConfigStore((s) => s.plans.plans);
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const watchSubscriptions = useSubscriptionStore((s) => s.watch);
  useEffect(() => {
    watchSubscriptions();
  }, [watchSubscriptions]);
  const entitlements = useMemo(
    () => entitlementsForSubscription(activeSubscription(subscriptions)?.priceId ?? null, publicPlans),
    [subscriptions, publicPlans],
  );
  const isAllowed = (id: string) => layoutAllowed(entitlements, id, BASE_LAYOUT_IDS);

  // Keep the chosen layout valid for the current placement/spread combo AND
  // unlocked by the plan; otherwise fall back to the first available layout.
  useEffect(() => {
    const current = layouts.find((l) => l.id === config.layoutId);
    if (!current || !isAllowed(config.layoutId)) {
      const fallback = layouts.find((l) => isAllowed(l.id)) ?? layouts[0];
      if (fallback && fallback.id !== config.layoutId) update({ layoutId: fallback.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.textPlacement, config.spreadUsage, entitlements]);

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
          {layouts.map((l) => {
            const locked = !isAllowed(l.id);
            return (
              <OptionCard
                key={l.id}
                selected={config.layoutId === l.id}
                onSelect={() => {
                  if (!locked) update({ layoutId: l.id });
                }}
                disabled={locked}
                title={l.premium ? `${l.label} · Premium` : l.label}
                description={locked ? "Unlock this layout with a subscription." : l.description}
                visual={<LayoutDiagram template={l} />}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
