"use client";

/**
 * "‹ 2 / 3 ›" on a picture that has been drawn more than once. Stepping shows
 * that version in place and makes it the book's, for free: nothing is drawn and
 * nothing is deleted. A picture with a single version shows nothing at all.
 *
 * It sits beside the picture's own button (never inside it), so tapping the
 * picture still selects it and the pager is a control of its own.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { neighbourVersion, pictureHistory } from "../../../core/guide/history";
import type { GuideTarget } from "../../../core/guide/target";
import type { Project } from "../../../core/types";
import { cn } from "../../lib/cn";
import { stepPicture } from "../bookActions";
import { useGuideT } from "../intl";

export function VersionPager({
  project,
  target,
  className,
}: {
  project: Project;
  target: GuideTarget;
  className?: string;
}) {
  const t = useGuideT("chrome");
  const history = pictureHistory(project, target);
  if (!history) return null;
  const earlier = neighbourVersion(history, -1);
  const later = neighbourVersion(history, 1);
  return (
    <span
      role="group"
      aria-label={t("pictureOf", { n: history.at + 1, total: history.count })}
      className={cn(
        "inline-flex items-center rounded-full bg-white/90 text-ink-700 shadow-soft ring-1 ring-ink-900/5",
        className,
      )}
    >
      <Step label={t("earlierPicture")} disabled={!earlier} onClick={() => void stepPicture(target, -1)}>
        <ChevronLeft className="size-3.5" />
      </Step>
      <span className="min-w-8 text-center text-[11px] font-medium tabular-nums" aria-hidden>
        {history.at + 1} / {history.count}
      </span>
      <Step label={t("laterPicture")} disabled={!later} onClick={() => void stepPicture(target, 1)}>
        <ChevronRight className="size-3.5" />
      </Step>
    </span>
  );
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-full transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-500 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
