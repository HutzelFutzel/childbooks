"use client";

import { BookOpen } from "lucide-react";
import { useAppConfigStore } from "../../state/appConfigStore";
import { BrandMark } from "./BrandMark";
import { JobThread } from "./JobProgress";

export interface TopBarProps {
  /** Optional center / breadcrumb slot. */
  center?: React.ReactNode;
  left?: React.ReactNode;
  /** Replaces marketing branding inside focused workspaces. */
  contextLabel?: string;
  /** Optional slot rendered at the far right (e.g. auth). */
  right?: React.ReactNode;
}

/**
 * Workspace bar (Studio, Account, Admin): the same paper, hairline and
 * Fredoka type as the marketing margin, but short and quiet, so the book stays
 * the subject. No ribbon here; a coral thread along the bottom edge fills
 * while generation jobs run.
 */
export function TopBar({ center, left, contextLabel, right }: TopBarProps) {
  const branding = useAppConfigStore((s) => s.branding);

  return (
    <header className="sticky top-0 z-30 flex h-13 items-center justify-between gap-2 border-b border-ink-900/12 bg-canvas/96 px-2.5 backdrop-blur-sm sm:px-4">
      <div className="flex min-w-0 shrink items-center gap-2">
        {left}
        {contextLabel ? (
          <div className="flex min-w-0 items-center gap-2 border-l border-ink-900/12 pl-2 sm:pl-3">
            <BookOpen aria-hidden className="hidden size-4 shrink-0 text-brand-600 sm:block" />
            <p className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink-900">
              {contextLabel}
            </p>
          </div>
        ) : (
          <BrandMark
            siteName={branding.brandName}
            logoUrl={branding.logo?.imageUrl}
            iconUrl={branding.icon?.imageUrl}
            tagline={branding.tagline}
            size="sm"
          />
        )}
      </div>

      <div className="hidden md:block">{center}</div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">{right}</div>

      <JobThread />
    </header>
  );
}
