"use client";

import { BookOpen } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";

export interface TopBarProps {
  /** Optional center / breadcrumb slot. */
  center?: React.ReactNode;
  left?: React.ReactNode;
  /** Optional slot rendered at the far right (e.g. auth). */
  right?: React.ReactNode;
}

export function TopBar({ center, left, right }: TopBarProps) {
  const branding = useAppConfigStore((s) => s.branding);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-ink-100 bg-white/80 px-3 backdrop-blur-md sm:px-5">
      <div className="flex min-w-0 shrink items-center gap-3">
        {left}
        <div className="flex min-w-0 items-center gap-2">
          {branding.logo?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo.imageUrl} alt={branding.brandName} className="h-9 w-auto shrink-0" />
          ) : (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-(--color-brand-foreground) shadow-soft">
                {branding.icon?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={branding.icon.imageUrl} alt="" className="size-6 object-contain" />
                ) : (
                  <BookOpen className="size-5" />
                )}
              </span>
              {/* Tagline drops out first on narrow screens — the brand name
                  alone still identifies the app without crowding the Sparks
                  badge / auth menu on the right. */}
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-bold text-ink-900">{branding.brandName}</p>
                <p className="hidden truncate text-[11px] text-ink-400 sm:block">{branding.tagline}</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="hidden md:block">{center}</div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{right}</div>
    </header>
  );
}
