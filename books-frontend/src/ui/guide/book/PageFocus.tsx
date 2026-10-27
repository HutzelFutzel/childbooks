"use client";

/**
 * Edit mode: the page grows and becomes directly editable (text, crop,
 * layout). A picture change is still typed in the composer, which docks on
 * the book, so the Studio's own instruction field is switched off here. On a
 * wide window the conversation stays beside it; otherwise it is one tap away
 * as an overlay. The Preview | Edit switch is the way out, as it is the way in.
 */
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MessageCircle, X } from "lucide-react";
import type { Project } from "../../../core/types";
import { useStudio } from "../../studio/StudioContext";
import { useStudioPanelStore } from "../../studio/studioPanelStore";
import { useGuideT } from "../intl";
import { BusyPill } from "./BusyPill";
import { ModeSwitch } from "./ModeSwitch";
import { sameTarget } from "../../../core/guide/target";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { dispIndexOf, dispUnitIds, unitTarget } from "./units";

const BookCanvas = dynamic(
  () => import("../../studio/BookCanvas").then((m) => m.BookCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-ink-500"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-6 animate-spin text-brand-400" />
        <p className="text-sm font-medium">Loading page editor…</p>
      </div>
    ),
  },
);

export function PageFocus({
  project,
  unitId,
  onLeave,
  composer,
  conversation,
  overlayOpen,
  onOverlay,
  showConversationToggle,
}: {
  project: Project;
  unitId: string | null;
  onLeave: () => void;
  /** The composer, docked under the book. */
  composer: React.ReactNode;
  /** The transcript, shown as an overlay when the chat column is hidden. */
  conversation: React.ReactNode;
  overlayOpen: boolean;
  onOverlay: (open: boolean) => void;
  showConversationToggle: boolean;
}) {
  const t = useGuideT("chrome");
  const { displays, setEditingDisp, editingDispId } = useStudio();
  const chip = useChatStudio((st) => st.chip);
  const setChip = useChatStudio((st) => st.setChip);
  const open = displays.find((d) => d.id === editingDispId) ?? displays[Math.max(0, dispIndexOf(displays, unitId ?? ""))];
  const setInstructionsOff = useStudioPanelStore((s) => s.setInstructionsOff);

  useEffect(() => {
    setInstructionsOff(true);
    return () => setInstructionsOff(false);
  }, [setInstructionsOff]);

  useEffect(() => {
    if (!unitId) return;
    const index = dispIndexOf(displays, unitId);
    if (index >= 0) setEditingDisp(displays[index]!.id);
    // Only when the page asked for changes, not on every display rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (overlayOpen) onOverlay(false);
      else if (!(document.activeElement as HTMLElement | null)?.isContentEditable) onLeave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen, onOverlay, onLeave]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-project={project.id}>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-ink-900/10 bg-white/95 px-2.5 shadow-[0_1px_2px_rgba(20,22,58,0.03)] backdrop-blur-md sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          {showConversationToggle && (
            <>
              <button
                type="button"
                onClick={() => onOverlay(!overlayOpen)}
                aria-expanded={overlayOpen}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                  overlayOpen
                    ? "bg-ink-900 text-white shadow-2xs"
                    : "bg-white text-ink-700 ring-1 ring-ink-900/10 hover:bg-ink-50 hover:text-ink-900",
                )}
              >
                <MessageCircle className="size-3.5" />
                {t("conversation")}
              </button>
              <span aria-hidden className="h-4 w-px bg-ink-900/10" />
            </>
          )}
          <div className="flex items-center gap-1" role="group" aria-label={t("pageNumbers")}>
            {open &&
              dispUnitIds(open).map((id) => {
                const target = unitTarget(project, id);
                const active = sameTarget(chip, target);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChip(active ? null : target)}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                      active
                        ? "bg-ink-900 text-white shadow-2xs"
                        : "bg-ink-900/[0.04] text-ink-700 ring-1 ring-inset ring-ink-900/[0.07] hover:bg-ink-900/[0.08] hover:text-ink-900",
                    )}
                  >
                    {target.kind === "page" ? t("page", { n: target.page }) : t("cover")}
                  </button>
                );
              })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <BusyPill project={project} className="max-sm:hidden" />
          <ModeSwitch mode="edit" onChange={(next) => next === "preview" && onLeave()} />
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <BookCanvas />
        <AnimatePresence>
          {overlayOpen && (
            <motion.aside
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-y-3 left-3 z-30 flex w-[min(26rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl bg-canvas/95 shadow-lifted ring-1 ring-ink-900/5 backdrop-blur"
            >
              <button
                type="button"
                onClick={() => onOverlay(false)}
                aria-label={t("closeConversation")}
                className="absolute top-2 right-2 z-10 flex size-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"
              >
                <X className="size-4" />
              </button>
              {conversation}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      {composer && (
        <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pt-2 pb-4">
          {composer}
        </div>
      )}
    </div>
  );
}
