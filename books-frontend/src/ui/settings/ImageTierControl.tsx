"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Sparkles, Zap } from "lucide-react";
import {
  DEFAULT_IMAGE_TIER_LABELS,
  type ImageTier,
} from "../../core/config/modelConfig";
import { useAppConfigStore } from "../../state/appConfigStore";
import { setPreferredImageTier, usePreferredImageTier } from "../../state/imageTier";
import { useProfileStore } from "../../state/profileStore";
import { InfoHint } from "../components/InfoHint";
import { Skeleton } from "../components/Skeleton";
import { ImageTierPicker } from "./ImageTierPicker";

/**
 * The always-visible image-quality control for the studio top bar. Shows which
 * tier ("Fast" / "High-Quality") is active and opens a popover to switch it —
 * so the choice is one click away from every generate button. When the user
 * hasn't chosen yet it draws attention (amber) and, on first mount, opens itself
 * once so the setting is discovered.
 */
export function ImageTierControl() {
  const labels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const tier = usePreferredImageTier();
  const profileLoaded = useProfileStore((s) => s.profileLoaded);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = (t: ImageTier) => labels?.[t]?.trim() || DEFAULT_IMAGE_TIER_LABELS[t];
  // Only treat as unset once the profile has loaded — otherwise a saved tier
  // flashes as "Choose quality" while preferences are still in flight.
  const unset = profileLoaded && tier === null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Image quality for generation"
        className={
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition " +
          (unset
            ? "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100"
            : "bg-ink-50 text-ink-700 ring-ink-100 hover:bg-ink-100")
        }
      >
        {!profileLoaded ? (
          <Skeleton className="size-4" rounded="full" />
        ) : tier === "premium" ? (
          <Sparkles className="size-4 text-brand-500" />
        ) : (
          <Zap className="size-4 text-amber-500" />
        )}
        <span className="hidden sm:inline">
          {!profileLoaded ? (
            <Skeleton className="inline-block h-4 w-16 align-middle" rounded="full" />
          ) : tier ? (
            label(tier)
          ) : (
            "Choose quality"
          )}
        </span>
        <ChevronDown className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {/* Outside the button (not nested inside it) so hovering to read the
          warning doesn't also toggle the quality popover open. Only shown once
          Fast is the active choice — this is a heads-up about the tier
          they're about to spend Sparks on, not a reason to avoid picking it. */}
      {tier === "quick" && (
        <InfoHint
          topic="fastTierConsistency"
          icon={AlertTriangle}
          className="absolute -right-1 -top-1 size-3.5 rounded-full bg-white text-amber-500 shadow-sm ring-1 ring-amber-200 hover:text-amber-600"
        />
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 w-80 rounded-xl bg-white p-3 shadow-lg ring-1 ring-ink-100"
        >
          <div className="mb-2">
            <p className="text-sm font-semibold text-ink-800">Image quality</p>
            <p className="text-xs text-ink-500">
              Used for every image you generate. Switch anytime — this is also in Settings.
            </p>
          </div>
          <ImageTierPicker
            value={tier}
            onChange={(t) => {
              void setPreferredImageTier(t);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
