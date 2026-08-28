"use client";

/**
 * "Delivering to 🇩🇪 Germany" — with a way to say otherwise.
 *
 * Shown wherever the destination is quietly filtering what's on offer, which
 * happens because the printer doesn't make every binding in every facility: a
 * format it won't produce for a country is withheld rather than sold and then
 * refused after payment.
 *
 * The point of the control is honesty about a guess. We infer the country from
 * signals the browser already exposes, and that inference is often wrong for
 * exactly the people this matters to — someone travelling, or buying a gift for
 * a relative abroad. Filtering on a silent guess would leave them staring at a
 * shorter list with no idea why, so the guess is stated and made editable in the
 * same breath.
 *
 * Renders nothing when there's nothing to say: no country known, or every
 * format available anyway. A permanent country dropdown at the top of a
 * children's-book wizard is a tax on everyone to serve a minority.
 */

import { countryFlag, countryLabel } from "../../core/analytics/markets";
import { enabledMarkets } from "../../core/config/markets";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useShipCountry } from "../hooks/useShipCountry";
import { Select } from "./Select";
import { cn } from "../lib/cn";

export function ShipToNote({
  /** How many formats this destination can't receive. Zero hides the note. */
  hiddenCount,
  className,
}: {
  hiddenCount: number;
  className?: string;
}) {
  const { country, chosen, setCountry } = useShipCountry();
  const registry = useAppConfigStore((s) => s.markets);

  if (!country || hiddenCount === 0) return null;

  const options = enabledMarkets(registry).map((value) => ({
    value,
    label: `${countryFlag(value)} ${countryLabel(value)}`,
  }));

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-ink-50 px-2.5 py-2 text-xs text-ink-600",
        className,
      )}
    >
      <span>
        {/* Named differently depending on where it came from, because "we
            guessed" and "you told us" deserve different confidence. */}
        {chosen ? "Delivering to" : "Looks like you're in"}{" "}
        <span className="font-medium text-ink-800">
          {countryFlag(country)} {countryLabel(country)}
        </span>
        , where {hiddenCount === 1 ? "one shape isn't" : `${hiddenCount} shapes aren't`} printed.
      </span>
      <Select
        options={options}
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        aria-label="Delivery country"
        className="h-7 w-auto py-0 text-xs"
      />
    </div>
  );
}
