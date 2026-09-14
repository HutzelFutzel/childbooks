/**
 * The admin's switch between the two studios.
 *
 * Shown only when choosing would change something — `guideToggleAvailable` hides it
 * for everyone but admins, and also for admins once the rollout is `off`, because a
 * control that does nothing is worse than no control.
 *
 * It writes a preference rather than navigating. The studio rewrites its own path as
 * the reader moves through a book, so a mode that lived in the URL would last exactly
 * one navigation — no use for authoring a whole book in the new flow. The stored
 * choice is only ever consulted for admins (see `resolveGuideMode`), so it cannot
 * become a way for anyone else to let themselves in.
 */
"use client";

import { MessageCircle, Rows3 } from "lucide-react";
import { guideToggleAvailable } from "../../core/guide/mode";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useAuthStore } from "../../state/authStore";
import { cn } from "../lib/cn";
import { useGuideMode } from "./useGuideMode";
import { useGuidePreference } from "./guidePreference";

export function GuideModeToggle({ bookId }: { bookId?: string | null }) {
  const rollout = useAppConfigStore((s) => s.guide.rollout);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const mode = useGuideMode(bookId);
  const setPreference = useGuidePreference((s) => s.set);

  if (!guideToggleAvailable(rollout, isAdmin)) return null;

  return (
    <div
      className="hidden items-center gap-0.5 rounded-xl bg-ink-100 p-0.5 sm:flex"
      role="group"
      aria-label="Studio flow"
    >
      <Option
        active={mode === "legacy"}
        onClick={() => setPreference("legacy")}
        icon={<Rows3 className="size-3.5" />}
        label="Steps"
        title="The step-by-step studio"
      />
      <Option
        active={mode === "guide"}
        onClick={() => setPreference("guide")}
        icon={<MessageCircle className="size-3.5" />}
        label="Chat"
        title="The guided studio (in development)"
      />
    </div>
  );
}

function Option({
  active,
  onClick,
  icon,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[0.625rem] px-2 py-1 text-xs font-semibold transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        active ? "bg-white text-ink-800 shadow-sm" : "text-ink-500 hover:text-ink-700",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
