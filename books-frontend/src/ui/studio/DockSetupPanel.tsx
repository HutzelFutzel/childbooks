/**
 * Narrow-dock book setup: hub of topics → detail picker with Back, instead of
 * an accordion. Smooth slide between levels; compact pickers from designQuestions.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ChevronRight, LayoutTemplate, Ruler } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { springSoft } from "../lib/motion";
import {
  LayoutQuestion,
  SizeQuestion,
  layoutSummary,
  sizeSummary,
} from "../wizard/designQuestions";

type SectionId = "size" | "layout";

const TOPICS: {
  id: SectionId;
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

export function DockSetupPanel() {
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const [section, setSection] = useState<SectionId | null>(null);

  if (!config) return null;
  const update = (patch: Partial<BookConfig>) => void updateConfig(patch);
  const stepProps = { config, update };
  const topic = TOPICS.find((t) => t.id === section);

  return (
    <div className="relative min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {section == null || !topic ? (
          <motion.div
            key="hub"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={springSoft}
            className="p-2"
          >
            <ul className="flex flex-col gap-1">
              {TOPICS.map((t) => (
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
                {topic.title}
              </span>
            </div>
            <div className="p-3">
              {section === "size" ? (
                <SizeQuestion {...stepProps} compact />
              ) : (
                <LayoutQuestion {...stepProps} compact />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
