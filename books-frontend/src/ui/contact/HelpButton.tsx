"use client";

import { HelpCircle } from "lucide-react";
import { useSupportUiStore } from "../../state/supportUiStore";

/** TopBar affordance that opens the in-app contact/help modal. Visible to all. */
export function HelpButton() {
  const openContact = useSupportUiStore((s) => s.openContact);
  return (
    <button
      type="button"
      onClick={openContact}
      aria-label="Help and contact"
      title="Help & contact"
      className="flex size-8 items-center justify-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
    >
      <HelpCircle className="size-[18px]" />
    </button>
  );
}
