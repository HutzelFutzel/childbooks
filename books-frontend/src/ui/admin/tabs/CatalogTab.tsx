"use client";

import { BookOpen, Sparkles, Tablet } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAdminTab, type CatalogSegment } from "../adminTabStore";
import { ProductsTab } from "./ProductsTab";
import { EbookTab } from "./EbookTab";
import { PacksTab } from "./PacksTab";

const SEGMENTS: { id: CatalogSegment; label: string; icon: React.ReactNode }[] = [
  { id: "print", label: "Print books", icon: <BookOpen className="size-4" /> },
  { id: "ebook", label: "Digital edition", icon: <Tablet className="size-4" /> },
  { id: "packs", label: "Spark packs", icon: <Sparkles className="size-4" /> },
];

/**
 * The Catalog: everything a customer can buy once (as opposed to a recurring
 * membership). Co-locating the three one-time products — the printed book, the
 * digital edition and Spark top-up packs — in one place removes the old scatter
 * where the ebook hid in "Pricing settings" and packs hid in the Sparks tab.
 */
export function CatalogTab() {
  const segment = useAdminTab((s) => s.catalogSegment);
  const setSegment = useAdminTab((s) => s.setCatalogSegment);

  return (
    <div className="space-y-5">
      <div className="inline-flex flex-wrap gap-1 rounded-xl bg-ink-100/70 p-1">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSegment(s.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              segment === s.id
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-700",
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {segment === "print" && <ProductsTab />}
      {segment === "ebook" && <EbookTab />}
      {segment === "packs" && <PacksTab />}
    </div>
  );
}
