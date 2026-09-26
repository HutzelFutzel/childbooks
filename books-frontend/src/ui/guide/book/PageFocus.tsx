"use client";

/**
 * Page focus: the page grows and becomes directly editable (text, crop,
 * layout). A picture change is still typed in the composer, which docks on
 * the book, so the Studio's own instruction field is switched off here. On a
 * wide window the conversation stays beside it; otherwise it is one tap away
 * as an overlay.
 */
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, MessageCircle, X } from "lucide-react";
import type { Project } from "../../../core/types";
import { BookCanvas } from "../../studio/BookCanvas";
import { useStudio } from "../../studio/StudioContext";
import { useStudioPanelStore } from "../../studio/studioPanelStore";
import { useGuideT } from "../intl";
import { dispIndexOf } from "./units";

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
  const { displays, setEditingDisp } = useStudio();
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
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-white hover:text-ink-900 hover:shadow-soft"
        >
          <ArrowLeft className="size-4" />
          {t("leaveFocus")}
        </button>
        {showConversationToggle && (
          <button
            type="button"
            onClick={() => onOverlay(!overlayOpen)}
            aria-expanded={overlayOpen}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-white hover:text-ink-900 hover:shadow-soft"
          >
            <MessageCircle className="size-4" />
            {t("conversation")}
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <BookCanvas autoPreview={false} />
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
      <div className="mx-auto w-full max-w-2xl shrink-0 px-4 pt-2 pb-4">{composer}</div>
    </div>
  );
}
