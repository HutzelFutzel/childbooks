import { Printer, ShieldCheck, Truck, Wand2 } from "lucide-react";
import { EditableText } from "./EditableText";
import type { SiteTextSlot } from "@/core/config/siteContent";
import type { SiteTextMap } from "./content";

const ITEMS = [
  { icon: Printer, slot: "trust.0" as SiteTextSlot, label: "Professional print quality" },
  { icon: Truck, slot: "trust.1" as SiteTextSlot, label: "Printed & shipped by Lulu" },
  { icon: Wand2, slot: "trust.2" as SiteTextSlot, label: "Same characters on every page" },
  { icon: ShieldCheck, slot: "trust.3" as SiteTextSlot, label: "Free to start — no credit card" },
];

/** A quiet reassurance strip under the hero. */
export function TrustStrip({ text }: { text: SiteTextMap }) {
  return (
    <section className="border-y border-ink-100 bg-white/60">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-6 py-6 md:grid-cols-4">
        {ITEMS.map(({ icon: Icon, slot, label }) => (
          <div key={label} className="flex items-center justify-center gap-2 text-center text-sm text-ink-500">
            <Icon className="size-4 shrink-0 text-brand-500" />
            <EditableText slotId={slot} as="span" defaultValue={label} serverValue={text[slot]} />
          </div>
        ))}
      </div>
    </section>
  );
}
