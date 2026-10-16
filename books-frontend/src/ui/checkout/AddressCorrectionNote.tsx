"use client";

/**
 * What the carrier said about a placed order's address, and what the customer
 * decided about it — one wording for every place an order is shown.
 *
 * Two things the previous inline copies got wrong:
 *
 *   1. They printed only the fields the carrier CHANGED ("1234 Main St, 94304"),
 *      which reads as a whole address that has lost its city. The suggestion is a
 *      diff; what the customer needs to compare is the full address it produces.
 *   2. They told everyone "the carrier adjusted this address", including a
 *      customer who was shown exactly that correction at checkout and chose to
 *      keep their own. For them the honest line is "you kept yours", with what
 *      the carrier would have used for comparison.
 */
import { MapPin } from "lucide-react";
import type { OrderRecord } from "../../core/fulfillment/types";
import { useSupportUiStore } from "../../state/supportUiStore";
import { applySuggestion } from "./AddressSuggestion";
import { cn } from "../lib/cn";

/** Stages at which the order can still be stopped, so offering that is truthful. */
const STOPPABLE: ReadonlySet<OrderRecord["stage"]> = new Set(["draft", "onHold"]);

function oneLine(parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function AddressCorrectionNote({
  order,
  className,
}: {
  order: OrderRecord;
  className?: string;
}) {
  const openContact = useSupportUiStore((s) => s.openContact);
  const suggested = order.addressValidation?.suggested ?? null;
  if (!suggested) return null;

  const { address } = order.recipient;
  const entered = {
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.townOrCity,
    region: address.stateOrCounty ?? "",
    postal: address.postalOrZipCode,
    country: address.countryCode,
  };
  const merged = applySuggestion(entered, suggested);
  const full = oneLine([merged.line1, merged.line2, merged.city, merged.region, merged.postal, merged.country]);
  const keptOwn = order.addressChoice === "entered";
  const canStop = STOPPABLE.has(order.stage);

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
        keptOwn
          ? "border-ink-200 bg-ink-50 text-ink-700"
          : "border-amber-200 bg-amber-50 text-amber-800",
        className,
      )}
    >
      <MapPin className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {keptOwn ? (
          <p>
            You chose to keep this address as you entered it. The carrier would have used{" "}
            <span className="font-medium">{full}</span>.
          </p>
        ) : (
          <p>
            The delivery carrier adjusted this address to <span className="font-medium">{full}</span>.
          </p>
        )}
        <p>
          {keptOwn ? "If the parcel can't be delivered as addressed, " : "If that isn't right, "}
          <button
            type="button"
            onClick={openContact}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            contact us
          </button>
          {keptOwn || !canStop ? " and we'll help sort it out." : " straight away — we can still stop the order."}
        </p>
      </div>
    </div>
  );
}
