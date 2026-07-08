"use client";

import { HelpCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { HELP, type HelpTopicId } from "../help/registry";
import { Popover } from "./Popover";
import { cn } from "../lib/cn";

export interface InfoHintProps {
  /** Pull title/body from the central help registry. */
  topic?: HelpTopicId;
  /** Or provide ad-hoc content instead of a registry topic. */
  title?: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A small "(?)" affordance that opens a rich, tap- and keyboard-friendly
 * explanation popover. Prefer `topic` (central registry) so copy stays
 * consistent; fall back to inline `title` + `children` for one-offs.
 */
export function InfoHint({
  topic,
  title,
  children,
  icon: Icon = HelpCircle,
  side = "top",
  align = "center",
  className,
}: InfoHintProps) {
  const t = topic ? HELP[topic] : null;
  const heading = title ?? t?.title;

  return (
    <Popover
      openOnHover
      side={side}
      align={align}
      panelClassName="w-72"
      trigger={
        <span
          className={cn(
            "inline-flex size-4 items-center justify-center rounded-full text-ink-300 transition hover:text-brand-500",
            className,
          )}
          aria-label={typeof heading === "string" ? heading : "More info"}
        >
          <Icon className="size-3.5" />
        </span>
      }
    >
      <div className="space-y-1.5 text-left">
        {heading && <p className="text-sm font-semibold text-ink-800">{heading}</p>}
        {t?.body && <p className="text-xs leading-relaxed text-ink-500">{t.body}</p>}
        {children && <div className="text-xs leading-relaxed text-ink-500">{children}</div>}
        {t?.points && (
          <ul className="mt-1 space-y-1">
            {t.points.map((p, i) => (
              <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-ink-500">
                <span className="mt-1 size-1 shrink-0 rounded-full bg-brand-400" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  );
}
