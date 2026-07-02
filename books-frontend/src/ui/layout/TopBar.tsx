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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-100 bg-white/80 px-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {left}
        <div className="flex items-center gap-2">
          {branding.logo?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logo.imageUrl} alt={branding.brandName} className="h-9 w-auto" />
          ) : (
            <>
              <span className="flex size-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft">
                {branding.icon?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={branding.icon.imageUrl} alt="" className="size-6 object-contain" />
                ) : (
                  <BookOpen className="size-5" />
                )}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold text-ink-900">{branding.brandName}</p>
                <p className="text-[11px] text-ink-400">{branding.tagline}</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="hidden md:block">{center}</div>

      <div className="flex items-center gap-2">{right}</div>
    </header>
  );
}
