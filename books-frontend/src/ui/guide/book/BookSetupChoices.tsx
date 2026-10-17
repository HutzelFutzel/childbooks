"use client";

import { useMemo } from "react";
import { bookProductForConfig } from "../../../core/book";
import {
  layoutAvailability,
  resolveLayoutById,
  resolvedLayouts,
} from "../../../core/book/layoutCatalog";
import { bookSizeFromAspect } from "../../../core/config/options";
import { authoringOf } from "../../../core/guide/projectState";
import { coverCardLines, coverWordsSettled } from "../../../core/guide/coverWords";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useChatStudio } from "../../../state/chatStudio";
import { useOfferableFormats, trimKey } from "../../hooks/useOfferableFormats";
import { LayoutSchematic } from "../../design/LayoutSchematic";
import { cn } from "../../lib/cn";
import { chooseBookFormat, chooseBookLayout } from "../bookActions";
import { useGuideT } from "../intl";

/** How a pick is carried out. The chat records it as the reader's answer; the book pane applies it. */
type ChooseHandler = (label: string, apply: () => Promise<void>) => void;

const applyNow: ChooseHandler = (_label, apply) => void apply();

export function BookFormatChoice({
  project,
  showPrompt = true,
  onChoose = applyNow,
}: {
  project: Project;
  showPrompt?: boolean;
  onChoose?: ChooseHandler;
}) {
  const t = useGuideT("chrome");
  const { sizes } = useOfferableFormats();
  const current = bookProductForConfig(project.config);
  const selected = trimKey(current);
  const confirmed = Boolean(authoringOf(project).bookSetup?.formatConfirmedAt);
  return (
    <section className="flex w-full flex-col gap-3">
      {showPrompt && (
        <p className="text-sm leading-relaxed text-ink-600">
          {t("chooseBookFormatPrompt")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sizes.map((size) => {
          const active = confirmed && size.key === selected;
          const keep =
            size.formats.find(
              (product) => product.binding === current.binding,
            ) ?? size.rep;
          const width =
            size.rep.aspect >= 1 ? 54 : 54 * size.rep.aspect;
          const height =
            size.rep.aspect >= 1 ? 54 / size.rep.aspect : 54;
          const shape = bookSizeFromAspect(size.rep.aspect);
          const shapeName = shape === "square" ? t("square") : shape === "landscape" ? t("landscape") : t("portrait");
          const dimensions = `${Math.round(size.rep.trim.widthIn * 10) / 10} × ${Math.round(size.rep.trim.heightIn * 10) / 10}″`;
          return (
            <button
              key={size.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChoose(`${shapeName}, ${dimensions}`, () => chooseBookFormat(keep.sku, keep.aspect))}
              className={cn(
                "flex min-h-24 items-center gap-3 rounded-xl border px-3 py-3 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2",
                active
                  ? "border-magic-500 bg-magic-50/50 text-ink-900 shadow-soft"
                  : "border-ink-200 bg-ink-50/40 text-ink-600 hover:-translate-y-0.5 hover:border-ink-400 hover:bg-white",
              )}
            >
              <span
                className="flex size-16 shrink-0 items-center justify-center"
                aria-hidden
              >
                <span
                  className={cn(
                    "block rounded-xs border-2 bg-white shadow-sm",
                    active ? "border-magic-600" : "border-ink-400",
                  )}
                  style={{ width, height }}
                />
              </span>
              <span>
                <span className="block font-display text-sm font-semibold text-ink-900">
                  {shapeName}
                </span>
                <span className="mt-1 block whitespace-nowrap text-xs text-ink-500">
                  {dimensions}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PageLayoutChoice({
  project,
  showPrompt = true,
  onChoose = applyNow,
}: {
  project: Project;
  showPrompt?: boolean;
  onChoose?: ChooseHandler;
}) {
  const t = useGuideT("chrome");
  const layoutsConfig = useAppConfigStore((state) => state.layouts);
  const product = bookProductForConfig(project.config);
  const shape = bookSizeFromAspect(product.aspect);
  const options = useMemo(
    () => resolvedLayouts(layoutsConfig, shape),
    [layoutsConfig, shape],
  );
  const confirmed = Boolean(authoringOf(project).bookSetup?.layoutConfirmedAt);
  return (
    <section className="flex w-full flex-col gap-3">
      {showPrompt && (
        <p className="text-sm leading-relaxed text-ink-600">
          {t("choosePageLayoutPrompt")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const availability = layoutAvailability(option, {
            product,
            config: layoutsConfig,
          });
          const selected =
            confirmed && project.config.layoutId === option.id;
          const example = option.examples[0];
          return (
            <button
              key={option.id}
              type="button"
              disabled={!availability.ok}
              aria-pressed={selected}
              onClick={() =>
                onChoose(option.label, () => chooseBookLayout(option.id, option.defaultMode))
              }
              className={cn(
                "overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45",
                selected
                  ? "border-magic-500 bg-magic-50/40 shadow-soft"
                  : "border-ink-200 bg-white hover:-translate-y-0.5 hover:border-ink-400",
              )}
            >
              <span className="block h-32 overflow-hidden border-b border-ink-100 bg-ink-50">
                {example ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={example.imageUrl}
                    alt={example.alt ?? ""}
                    className="size-full object-cover"
                  />
                ) : (
                  <LayoutSchematic
                    layout={option.layout}
                    product={product}
                    mode={option.defaultMode}
                    className="size-full rounded-none p-3"
                  />
                )}
              </span>
              <span className="block p-3">
                <span className="block font-display text-sm font-semibold text-ink-900">
                  {option.label}
                </span>
                <span className="mt-1 line-clamp-2 block text-[11px] leading-relaxed text-ink-500">
                  {availability.ok
                    ? option.description
                    : (availability as { reason: string }).reason}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The chosen shape and layout. Each can be asked again until the pages start. */
export function BookSetupSummary({ project }: { project: Project }) {
  const t = useGuideT("chrome");
  const layoutsConfig = useAppConfigStore((state) => state.layouts);
  const tap = useChatStudio((s) => s.tap);
  const runSkill = useChatStudio((s) => s.runSkill);
  const product = bookProductForConfig(project.config);
  const layout = resolveLayoutById(project.config.layoutId, layoutsConfig);
  const editable = !project.authoringState?.lockedAt;
  const change = (part: "format" | "layout", text: string) =>
    void tap(text, () => runSkill({ id: "changeBookSetup", args: { part } }));
  const words = coverCardLines(project);
  const settled = coverWordsSettled(project);
  return (
    <div className="w-full divide-y divide-ink-100/90">
      <div className="grid w-full grid-cols-1 divide-y divide-ink-100/90 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <SetupRow
          label={t("bookFormat")}
          value={`${Math.round(product.trim.widthIn * 10) / 10} × ${Math.round(product.trim.heightIn * 10) / 10}″`}
          change={editable ? t("changeFormat") : null}
          onChange={() => change("format", t("changeBookFormat"))}
        />
        <SetupRow
          label={t("pageLayout")}
          value={layout.label}
          change={editable ? t("changeFormat") : null}
          onChange={() => change("layout", t("changePageLayout"))}
        />
      </div>
      {settled && words.title && (
        <SetupRow
          label={t("coverWords")}
          value={[words.title, words.subtitle, words.author].filter(Boolean).join(" · ")}
          change={editable ? t("changeFormat") : null}
          onChange={() => void tap(t("changeCoverWords"), () => runSkill({ id: "changeCoverWords", args: {} }))}
        />
      )}
    </div>
  );
}

function SetupRow({
  label,
  value,
  change,
  onChange,
  className,
}: {
  label: string;
  value: string;
  change: string | null;
  onChange: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-2 px-3 py-2", className)}>
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold tracking-wide text-ink-400 uppercase">{label}</span>
        <span className="mt-0.5 block truncate text-[13px] font-medium text-ink-900">{value}</span>
      </span>
      {change && (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-full bg-ink-50 px-2.5 py-1 text-xs font-medium text-ink-700 ring-1 ring-ink-200/80 transition hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
        >
          {change}
        </button>
      )}
    </div>
  );
}
