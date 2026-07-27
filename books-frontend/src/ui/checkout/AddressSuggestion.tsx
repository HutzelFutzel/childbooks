/**
 * The carrier's opinion on the shipping address, offered while it's still free
 * to act on.
 *
 * Print carriers normalize addresses against their own database — "Road" → "Rd",
 * ZIP+4, unit prefixes — and a mismatch can park a print job awaiting manual
 * confirmation *after* the customer has been charged. The price quote already
 * carries that verdict (see `mapAddressValidation`), so this asks the question
 * at the only point where answering it costs nothing.
 *
 * Deliberately a choice and not an auto-correct: the customer knows their own
 * address, and a carrier database that has never heard of a new street is wrong
 * often enough that silently overwriting them would ship books to the wrong
 * place. Either answer unblocks checkout; refusing to answer does not.
 */
import { MapPin, TriangleAlert } from "lucide-react";
import type { AddressValidation, SuggestedAddress } from "../../core/fulfillment/types";
import { Button } from "../components/Button";

/** The form's current address, in the shape the comparison needs. */
export interface EnteredAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}

export type AddressChoice = "unreviewed" | "suggested" | "entered";

/** One address as a single readable line, the way a label would print it. */
function formatLines(a: EnteredAddress): string[] {
  const street = [a.line1.trim(), a.line2.trim()].filter(Boolean).join(", ");
  const locality = [a.city.trim(), a.region.trim(), a.postal.trim()].filter(Boolean).join(", ");
  return [street, locality, a.country.trim()].filter(Boolean);
}

/** The entered address with the suggestion's changes applied on top. */
export function applySuggestion(
  entered: EnteredAddress,
  suggested: SuggestedAddress,
): EnteredAddress {
  return {
    line1: suggested.line1 ?? entered.line1,
    line2: suggested.line2 ?? entered.line2,
    city: suggested.townOrCity ?? entered.city,
    region: suggested.stateOrCounty ?? entered.region,
    postal: suggested.postalOrZipCode ?? entered.postal,
    country: suggested.countryCode ?? entered.country,
  };
}

/**
 * A stable identity for a suggestion, so the dialog can tell "the customer
 * already answered this" from "the address changed and there's a new question".
 */
export function suggestionKey(validation: AddressValidation | null): string {
  if (!validation?.suggested) return "";
  return JSON.stringify(validation.suggested);
}

export function AddressSuggestion({
  validation,
  entered,
  choice,
  onUseSuggested,
  onKeepEntered,
}: {
  validation: AddressValidation;
  entered: EnteredAddress;
  choice: AddressChoice;
  onUseSuggested: (next: EnteredAddress) => void;
  onKeepEntered: () => void;
}) {
  const { suggested, warnings } = validation;

  // The provider can't validate this address at all, which means it will refuse
  // the print job. There's nothing to accept — only an address to fix — so this
  // reads as an error and checkout stays blocked behind it.
  if (validation.severity === "error") {
    return (
      <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-900">
          <TriangleAlert className="size-4 shrink-0" />
          We couldn&apos;t verify this address
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-rose-800">
          Our print partner won&apos;t accept an address it can&apos;t confirm, so please double-check
          the street, city and postal code before paying.
        </p>
        {warnings.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-rose-800">
            {warnings.map((w, i) => (
              <li key={i} className="list-disc">
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // No alternative to offer — the carrier only had remarks. Worth showing (it
  // explains what it changed) but there's nothing to decide.
  if (!suggested) {
    if (warnings.length === 0) return null;
    return (
      <div className="rounded-xl border border-ink-200 bg-ink-50 px-3.5 py-3 text-xs text-ink-600">
        <p className="flex items-center gap-1.5 font-medium text-ink-700">
          <MapPin className="size-3.5" /> The carrier adjusted your address slightly
        </p>
        <ul className="mt-1 space-y-0.5 pl-5">
          {warnings.map((w, i) => (
            <li key={i} className="list-disc">
              {w.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const corrected = applySuggestion(entered, suggested);
  const decided = choice !== "unreviewed";

  return (
    <div
      className={
        decided
          ? "rounded-xl border border-ink-200 bg-white px-3.5 py-3"
          : "rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3"
      }
    >
      <p
        className={
          decided
            ? "flex items-center gap-1.5 text-sm font-semibold text-ink-800"
            : "flex items-center gap-1.5 text-sm font-semibold text-amber-900"
        }
      >
        <MapPin className="size-4 shrink-0" />
        {decided ? "Shipping address confirmed" : "Check your shipping address"}
      </p>
      {!decided && (
        <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
          The delivery carrier suggests a slightly different version. Picking theirs is the
          safest way to make sure your book arrives.
        </p>
      )}

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <Option
          label="You entered"
          lines={formatLines(entered)}
          selected={choice === "entered"}
          onSelect={onKeepEntered}
        />
        <Option
          label="Carrier suggests"
          lines={formatLines(corrected)}
          recommended
          selected={choice === "suggested"}
          onSelect={() => onUseSuggested(corrected)}
        />
      </div>

      {!decided && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onUseSuggested(corrected)}>
            Use suggested address
          </Button>
          <Button size="sm" variant="ghost" onClick={onKeepEntered}>
            Keep mine as entered
          </Button>
        </div>
      )}
    </div>
  );
}

function Option({
  label,
  lines,
  selected,
  recommended,
  onSelect,
}: {
  label: string;
  lines: string[];
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        selected
          ? "rounded-lg border-2 border-brand-500 bg-white px-3 py-2 text-left transition"
          : "rounded-lg border border-ink-200 bg-white px-3 py-2 text-left transition hover:border-ink-300"
      }
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
        {label}
        {recommended && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-emerald-700">
            Recommended
          </span>
        )}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-700">
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </span>
    </button>
  );
}
