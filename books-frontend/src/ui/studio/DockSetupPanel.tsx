/**
 * Narrow-dock book setup: hub of topics → detail picker with Back, instead of
 * an accordion. Smooth slide between levels; compact pickers from designQuestions.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, LayoutTemplate, Ruler } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { parseColor, toHex } from "../design/color";
import { springSoft } from "../lib/motion";
import {
  LayoutQuestion,
  SizeQuestion,
  layoutSummary,
  sizeSummary,
} from "../wizard/designQuestions";
import { PageColorControl } from "./PageColorControl";
import { pageColorAppliedToAll, pageColorOf } from "./pageBackground";
import { useStudio } from "./StudioContext";

type SectionId = "size" | "layout" | "pageColor";

const BOOK_TOPICS: {
  id: Exclude<SectionId, "pageColor">;
  title: string;
  icon: React.ReactNode;
  summary: (config: BookConfig) => string;
}[] = [
  {
    id: "size",
    title: "Book size",
    icon: <Ruler className="size-4" />,
    summary: sizeSummary,
  },
  {
    id: "layout",
    title: "Layout",
    icon: <LayoutTemplate className="size-4" />,
    summary: layoutSummary,
  },
];

function pageColorSummary(color: string, appliedToAll: boolean): string {
  const hex = toHex(parseColor(color)).toUpperCase();
  const name = hex === "#FFFFFF" ? "White" : hex;
  return appliedToAll ? `${name} · all story pages` : name;
}

export function DockSetupPanel({ pageId }: { pageId?: string }) {
  const { design } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const [section, setSection] = useState<SectionId | null>(null);

  if (!config) return null;
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);
  const stepProps = { config, update };
  const color = pageColorOf(pageId ? design.pages[pageId] : undefined);
  const applied = pageColorAppliedToAll(design, color);
  const topicTitle =
    section === "pageColor"
      ? "Page color"
      : BOOK_TOPICS.find((t) => t.id === section)?.title;

  return (
    <div className="relative min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {section == null || !topicTitle ? (
          <motion.div
            key="hub"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={springSoft}
            className="p-2"
          >
            <ul className="flex flex-col gap-1">
              {BOOK_TOPICS.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSection(t.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-3 text-left transition hover:bg-ink-50"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      {t.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-800">{t.title}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {t.summary(config)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-300" />
                  </button>
                </li>
              ))}
              {pageId && (
                <li>
                  <button
                    type="button"
                    onClick={() => setSection("pageColor")}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-3 text-left transition hover:bg-ink-50"
                  >
                    <span
                      className="size-9 shrink-0 rounded-lg ring-1 ring-inset ring-black/10"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-800">Page color</span>
                      <span className="block truncate text-xs text-ink-500">
                        {pageColorSummary(color, applied)}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-300" />
                  </button>
                </li>
              )}
            </ul>
          </motion.div>
        ) : (
          <motion.div
            key={section}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={springSoft}
            className="flex flex-col"
          >
            <div className="flex items-center gap-1 border-b border-ink-100 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setSection(null)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
              >
                <ArrowLeft className="size-4" />
                Back
              </button>
              <span className="min-w-0 truncate text-sm font-semibold text-ink-800">
                {topicTitle}
              </span>
            </div>
            <div className="p-3">
              {section === "size" ? (
                <SizeQuestion {...stepProps} compact />
              ) : section === "layout" ? (
                <LayoutQuestion {...stepProps} compact />
              ) : pageId ? (
                <PageColorControl pageId={pageId} />
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
