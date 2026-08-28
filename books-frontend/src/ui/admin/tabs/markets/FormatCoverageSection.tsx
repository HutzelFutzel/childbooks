"use client";

/**
 * Configuration → Markets → "Formats by market".
 *
 * The country table above answers "does the printer reach this destination".
 * This one answers the question that actually decides whether an order goes
 * through: does it make THIS BOOK for that destination, and on which speeds.
 *
 * They differ more than you'd expect, because a format that isn't bound in a
 * local facility is printed elsewhere and imported — which changes the carrier,
 * roughly doubles the shipping, and changes which service levels exist at all.
 * A landscape hardcover to Germany has no Standard; a hardcover to Australia has
 * no Standard Plus. Selling a speed the printer doesn't run for that book is
 * refused at order time, after payment — so a red cell here is a real order
 * about to fail, not a tidiness warning.
 *
 * Rendered as a matrix rather than as rows on each product because the useful
 * reading is across a row: "this format is fine everywhere except Australia" is
 * a sentence you can only see when the markets are side by side.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../../components/Button";
import { useReadOnly } from "../../../components/ReadOnlyContext";
import { cn } from "../../../lib/cn";
import { countryFlag } from "../../../../core/analytics/markets";
import {
  availableMethodsFor,
  type MarketCapability,
} from "../../../../core/config/marketCapability";
import { methodOfferedIn, type ShippingSettings } from "../../../../core/config/shipping";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import { Section } from "../products/parts";

/** What one format can do in one market, reduced to the thing an admin acts on. */
type CellVerdict = "ok" | "none" | "unknown" | "unswept";

function verdictFor(
  capability: MarketCapability | undefined,
  shipping: ShippingSettings,
  country: string,
): { verdict: CellVerdict; sellable: string[] } {
  if (!capability) return { verdict: "unswept", sellable: [] };
  if (capability.status === "unknown") return { verdict: "unknown", sellable: [] };
  // What the printer runs here, intersected with what we're willing to sell.
  // Both halves matter: a speed we've switched off is as unavailable to the
  // customer as one the printer doesn't run, and a market left with neither is
  // broken for this format however healthy the coverage looks.
  const sellable = availableMethodsFor(capability).filter((m) =>
    methodOfferedIn(shipping, country, m),
  );
  return { verdict: sellable.length > 0 ? "ok" : "none", sellable };
}

export function FormatCoverageSection({ markets }: { markets: readonly string[] }) {
  const readOnly = useReadOnly();
  const capability = useAppConfigStore((s) => s.productCapability);
  const publicProducts = useAppConfigStore((s) => s.products.products);
  const shipping = useAppConfigStore((s) => s.shippingSettings);
  const sweep = useAppConfigStore((s) => s.sweepProductCapability);
  const [sweeping, setSweeping] = useState(false);

  const nameForSku = useMemo(
    () => new Map(publicProducts.map((p) => [p.sku.toUpperCase(), p.name])),
    [publicProducts],
  );

  const rows = useMemo(
    () =>
      capability.products.map((coverage) => {
        const byCountry = new Map(coverage.countries.map((c) => [c.country, c]));
        return {
          sku: coverage.sku,
          pageCount: coverage.pageCount,
          name: nameForSku.get(coverage.sku) ?? coverage.sku,
          cells: markets.map((country) => ({
            country,
            ...verdictFor(byCountry.get(country), shipping, country),
          })),
        };
      }),
    [capability.products, markets, nameForSku, shipping],
  );

  const broken = rows.reduce(
    (n, r) => n + r.cells.filter((c) => c.verdict === "none").length,
    0,
  );

  const runSweep = async (force: boolean) => {
    setSweeping(true);
    try {
      const summary = await sweep({ force });
      toast.success(
        summary.probed === 0
          ? "Nothing to re-check — every format already has a verdict in every market."
          : `Checked ${summary.probed} routes across ${summary.formats} formats: ${summary.available} available, ${summary.refused} refused, ${summary.unknown} unknown.`,
      );
      if (summary.message) toast.warning(summary.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The format sweep failed.");
    } finally {
      setSweeping(false);
    }
  };

  return (
    <Section
      title="Formats by market"
      hint="Which bindings the printer will actually make for each country, and on how many of the speeds we sell. Evidence, not a setting."
      action={
        <Button
          variant="ghost"
          size="sm"
          leftIcon={
            sweeping ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />
          }
          disabled={readOnly || sweeping}
          onClick={() => runSweep(true)}
        >
          {capability.sweptAt ? "Re-check formats" : "Check formats"}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
          No format has been checked yet. Until one is, every format is offered in every open market
          and the printer&apos;s refusal arrives at order time instead. It&apos;s a short run — one
          request per format per market.
        </p>
      ) : (
        <>
          {broken > 0 && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 ring-1 ring-inset ring-red-100">
              {broken} format/market {broken === 1 ? "pair has" : "pairs have"} no sellable speed.
              Those combinations are already withheld from the storefront, so nobody can order them —
              but the format is advertised everywhere else, so the gap is invisible until you look
              here. Either offer a speed the printer runs there, or exclude the country on the
              product&apos;s Destinations.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 font-medium text-ink-500">
                    Format
                  </th>
                  {markets.map((country) => (
                    <th key={country} className="px-2 py-1.5 text-center font-medium text-ink-500">
                      <span title={country}>
                        {countryFlag(country)} {country}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.sku} className="border-t border-ink-100">
                    <td className="sticky left-0 z-10 max-w-[18rem] truncate bg-white px-2 py-1.5 text-ink-700">
                      <span title={`${row.sku} · measured at ${row.pageCount} pages`}>
                        {row.name}
                      </span>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.country} className="px-1 py-1 text-center">
                        <CoverageCell {...cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="text-[10px] leading-relaxed text-ink-400">
        Measured at a representative page count per format, since shipping is priced by weight and
        each binding accepts a different range. A blank cell is a market opened since the last check,
        not a refusal — those fall back to the country-level coverage above until the next sweep.
      </p>
    </Section>
  );
}

function CoverageCell({
  verdict,
  sellable,
  country,
}: {
  verdict: CellVerdict;
  sellable: string[];
  country: string;
}) {
  const title =
    verdict === "ok"
      ? `${sellable.length} sellable ${sellable.length === 1 ? "speed" : "speeds"} to ${country}: ${sellable.join(", ")}`
      : verdict === "none"
        ? `The printer runs no speed we sell for this format to ${country}. An order would be refused after payment.`
        : verdict === "unknown"
          ? `The last check of ${country} failed, so nothing is known. Not the same as a refusal — re-run the sweep.`
          : `${country} hasn't been checked for this format. It falls back to the country-level coverage.`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-w-7 justify-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
        verdict === "ok" && "bg-emerald-50 text-emerald-700",
        verdict === "none" && "bg-red-50 text-red-600",
        verdict === "unknown" && "bg-amber-50 text-amber-700",
        verdict === "unswept" && "bg-ink-50 text-ink-300",
      )}
    >
      {verdict === "ok" ? sellable.length : verdict === "none" ? "0" : verdict === "unknown" ? "?" : "–"}
    </span>
  );
}
