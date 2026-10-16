"use client";

import { FilePlus2 } from "lucide-react";
import { PAGE_TEMPLATES, type PageTemplate } from "../../core/book/pageTemplates";
import { pageCountCopy } from "../../core/print/pageCountPlan";
import { Popover } from "../components/Popover";
import { cn } from "../lib/cn";
import { insertSpreadAt } from "./pageOps";
import { useBlankPagePlan } from "./useBlankPagePlan";

/**
 * The blank pages a printed book gets anyway, shown where they will land: at
 * the end of the page rail, as a dashed placeholder labelled "added
 * automatically".
 *
 * Nothing here needs doing — the blanks are the default and the order goes
 * through without touching them. The tile exists so the customer sees the
 * arithmetic ("18 + 2 blank = 20") before checkout, and can, if they like,
 * turn the spare pages into something: a dedication, a "belongs to" page, a
 * drawing page. Each use replaces one blank, so the count shrinks to zero and
 * the tile disappears.
 */
export function BlankPagesTile({ horizontal = false }: { horizontal?: boolean }) {
  const info = useBlankPagePlan();
  if (!info) return null;
  const { plan, binding, frontSafe, endIndex } = info;
  if (plan.blank <= 0 || plan.status === "too-long") return null;

  const { detail } = pageCountCopy(plan, binding);
  const templates = PAGE_TEMPLATES.filter((t) => t.position === "back" || frontSafe);

  function use(t: PageTemplate) {
    insertSpreadAt(t.position === "front" ? 0 : endIndex, { text: t.text });
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-ink-300 bg-ink-50/60 p-2 text-ink-600",
        horizontal && "w-44 shrink-0",
      )}
    >
      <p className="text-[11px] font-semibold text-ink-700">
        {plan.blank === 1 ? "1 blank page" : `${plan.blank} blank pages`}
        <span className="font-normal text-ink-500"> · added automatically</span>
      </p>
      <p className="mt-0.5 text-[11px] tabular-nums text-ink-600">
        {plan.story} + {plan.blank} blank = {plan.printed} printed pages
      </p>
      <p className="mt-1 text-[10px] leading-snug text-ink-500">{detail}</p>
      <Popover
        align="start"
        side="top"
        trigger={
          <span className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 rounded-md bg-white px-2 text-[11px] font-medium text-brand-700 shadow-sm ring-1 ring-inset ring-ink-200 transition hover:bg-brand-50">
            <FilePlus2 className="size-3.5" /> Use this page
          </span>
        }
        panelClassName="w-52 p-1.5"
      >
        {(close) => (
          <div className="space-y-0.5">
            <p className="px-2 pb-1 pt-0.5 text-[10px] text-ink-500">
              Turn a spare page into something. You can edit it afterwards.
            </p>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  use(t);
                  close();
                }}
                className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs font-medium text-ink-700 transition hover:bg-ink-50"
              >
                {t.label}
                <span className="text-[10px] font-normal text-ink-400">
                  {t.position === "front" ? "at the start" : "at the end"}
                </span>
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
}
