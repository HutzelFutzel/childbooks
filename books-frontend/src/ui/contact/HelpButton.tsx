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
      className="flex size-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-900/[0.05] hover:text-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
    >
      <HelpCircle className="size-[18px]" />
    </button>
  );
}
