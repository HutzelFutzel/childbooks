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
import { CircleCheck, MapPin, TriangleAlert } from "lucide-react";
import { subdivisionsFor } from "../../core/config/subdivisions";
import type { AddressValidation, AddressWarning, SuggestedAddress } from "../../core/fulfillment/types";
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

/**
 * The region field holds a CODE wherever the carrier wants one ("CA", not
 * "California"). A carrier's suggestion may spell it out in full, and dropping
 * that into a picker that only knows codes leaves the field showing "not
 * recognized" — which then blocks the very checkout the suggestion was meant to
 * unblock. So: keep it if it is already a valid code, translate a full name to
 * its code, and otherwise leave the customer's own entry rather than put
 * something the form can't display.
 */
function regionFrom(suggestedRegion: string | undefined, entered: string, country: string): string {
  if (suggestedRegion === undefined) return entered;
  const subs = subdivisionsFor(country.trim().toUpperCase());
  // No picker for this country: free text, so whatever the carrier wrote is fine.
  if (subs.length === 0) return suggestedRegion;
  const wanted = suggestedRegion.trim().toLowerCase();
  const hit = subs.find((s) => s.code.toLowerCase() === wanted || s.name.toLowerCase() === wanted);
  return hit ? hit.code : entered;
}

/** The entered address with the suggestion's changes applied on top. */
export function applySuggestion(
  entered: EnteredAddress,
  suggested: SuggestedAddress,
): EnteredAddress {
  const country = suggested.countryCode ?? entered.country;
  return {
    line1: suggested.line1 ?? entered.line1,
    line2: suggested.line2 ?? entered.line2,
    city: suggested.townOrCity ?? entered.city,
    region: regionFrom(suggested.stateOrCounty, entered.region, country),
    postal: suggested.postalOrZipCode ?? entered.postal,
    country,
  };
}

/** The address fields as one comparable string — what a carrier verdict was a verdict ON. */
export function addressSignature(a: EnteredAddress): string {
  return JSON.stringify([a.line1, a.line2, a.city, a.region, a.postal, a.country]);
}

/**
 * A stable identity for a suggestion, so the dialog can tell "the customer
 * already answered this" from "the address changed and there's a new question".
 */
export function suggestionKey(validation: AddressValidation | null): string {
  if (!validation?.suggested) return "";
  return JSON.stringify(validation.suggested);
}

const FIELD_LABELS: Record<string, string> = {
  street1: "Street",
  street2: "Apartment or unit",
  city: "City",
  state_code: "State or region",
  postcode: "Postal code",
  country_code: "Country",
};

/**
 * A carrier remark in the customer's words. They arrive as
 * "street1: Holstenstr. 40 -> Holstenstraße 40" — field codes and arrows meant
 * for an operator. Anything we can't read is summarised rather than shown raw.
 */
export function friendlyAddressWarnings(warnings: AddressWarning[], mode: "changed" | "invalid"): string[] {
  const lines = warnings.map((w) => {
    const label = w.field ? FIELD_LABELS[w.field.toLowerCase()] : undefined;
    if (!label) return mode === "invalid" ? "Part of this address couldn't be matched." : "Part of this address was reformatted.";
    if (mode === "invalid") return `Check the ${label.toLowerCase()}.`;
    const to = w.message.includes("->") ? w.message.slice(w.message.lastIndexOf("->") + 2).trim() : "";
    return to ? `${label} will be printed as “${to}”.` : `${label} was reformatted.`;
  });
  return [...new Set(lines)];
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
            {friendlyAddressWarnings(warnings, "invalid").map((line) => (
              <li key={line} className="list-disc">
                {line}
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
          {friendlyAddressWarnings(warnings, "changed").map((line) => (
            <li key={line} className="list-disc">
              {line}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const corrected = applySuggestion(entered, suggested);

  // Already answered: one quiet line with the address that will be used, and the
  // way back to the other one. Not a second form to fill in.
  if (choice !== "unreviewed") {
    return (
      <div className="rounded-2xl border border-ink-200 bg-white px-3.5 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <CircleCheck className="size-4 shrink-0 text-emerald-600" />
          Shipping address confirmed
        </p>
        <div className="mt-1.5 text-xs leading-relaxed text-ink-600">
          <AddressLines current={entered} compareTo={entered} />
        </div>
        {choice === "entered" && (
          <button
            type="button"
            onClick={() => onUseSuggested(corrected)}
            className="mt-2 text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-700"
          >
            Use the carrier&apos;s version instead
          </button>
        )}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Confirm your shipping address" className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
        <MapPin className="size-4 shrink-0" />
        Is this the right address?
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
        The delivery carrier would write it slightly differently. We recommend their version — it&apos;s
        the one their system can deliver to.
      </p>

      <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
          Recommended
          <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-emerald-700">
            Changes highlighted
          </span>
        </p>
        <div className="text-sm leading-relaxed text-ink-800">
          <AddressLines current={corrected} compareTo={entered} highlight />
        </div>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-amber-800/90">
        <span className="font-medium">You typed:</span> {formatLines(entered).join(" · ")}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button size="sm" onClick={() => onUseSuggested(corrected)}>
          Use this address
        </Button>
        <button
          type="button"
          onClick={onKeepEntered}
          className="text-xs font-medium text-amber-900 underline decoration-amber-400 underline-offset-2 transition hover:text-amber-950"
        >
          Keep what I typed
        </button>
      </div>
    </div>
  );
}

/**
 * An address as a label would print it, with the parts that differ from
 * `compareTo` marked. Compared field by field and exactly (not loosely like the
 * server does): what's shown is what changed on the page, however small.
 */
function AddressLines({
  current,
  compareTo,
  highlight = false,
}: {
  current: EnteredAddress;
  compareTo: EnteredAddress;
  highlight?: boolean;
}) {
  const seg = (value: string, other: string) => {
    const text = value.trim();
    if (!text) return null;
    const changed = highlight && text !== other.trim();
    return changed ? (
      <mark className="rounded bg-emerald-100 px-0.5 font-medium text-emerald-900">{text}</mark>
    ) : (
      <span>{text}</span>
    );
  };
  const street = [seg(current.line1, compareTo.line1), seg(current.line2, compareTo.line2)].filter(Boolean);
  const locality = [
    seg(current.city, compareTo.city),
    seg(current.region, compareTo.region),
    seg(current.postal, compareTo.postal),
  ].filter(Boolean);
  const country = seg(current.country, compareTo.country);
  const join = (items: React.ReactNode[]) =>
    items.map((item, i) => (
      <span key={i}>
        {i > 0 && ", "}
        {item}
      </span>
    ));
  return (
    <>
      {street.length > 0 && <span className="block">{join(street)}</span>}
      {locality.length > 0 && <span className="block">{join(locality)}</span>}
      {country && <span className="block">{country}</span>}
    </>
  );
}
