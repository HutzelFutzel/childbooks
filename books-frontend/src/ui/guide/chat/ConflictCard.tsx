"use client";

/**
 * Two devices changed the same part of the book. One plain choice; the
 * version not chosen is kept in the book's history. Saving waits until then.
 */
import { motion } from "framer-motion";
import { useProjectsStore } from "../../../state/projectsStore";
import { useGuideT } from "../intl";
import { wellIn } from "../motion";

const FIELD_NAMES: [prefix: string, name: string][] = [
  ["config.storyText", "story"],
  ["config.artStyle", "style"],
  ["config.styleReady", "style"],
  ["authoringState.styleSourceArt", "style"],
  ["authoringState.styleSourceOnly", "style"],
  ["config.storyBrief", "people"],
  ["title", "title"],
  ["screenplay", "pages"],
  ["design", "pages"],
  ["illustrations", "pictures"],
  ["anchors", "pictures"],
  ["authoringState.cover", "cover"],
];

function fieldName(path: string): string {
  return FIELD_NAMES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}.`))?.[1] ?? "settings";
}

export function ConflictCard() {
  const t = useGuideT("conflict");
  const conflict = useProjectsStore((s) => s.bookConflict);
  const settle = useProjectsStore((s) => s.settleBookConflict);
  if (!conflict) return null;
  const names = [...new Set(conflict.conflicts.map(fieldName))].map((key) => t(`fields.${key}`));
  return (
    <motion.div
      variants={wellIn}
      initial="hidden"
      animate="show"
      exit="exit"
      role="alertdialog"
      aria-label={t("title")}
      className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-soft ring-1 ring-amber-200"
    >
      <div className="flex flex-col gap-1">
        <p className="font-display text-[15px] font-medium text-ink-900">{t("title")}</p>
        <p className="text-sm text-ink-600">{t("body", { fields: names.join(", ") })}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void settle("mine")}
          className="inline-flex min-h-10 items-center rounded-full bg-ink-900 px-4 text-sm font-medium text-white transition hover:bg-ink-800"
        >
          {t("mine")}
        </button>
        <button
          type="button"
          onClick={() => void settle("theirs")}
          className="inline-flex min-h-10 items-center rounded-full bg-white px-4 text-sm font-medium text-ink-900 ring-1 ring-ink-200 transition hover:ring-ink-400"
        >
          {t("theirs")}
        </button>
      </div>
    </motion.div>
  );
}
