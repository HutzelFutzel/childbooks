"use client";

/**
 * Where one person's look comes from. Letting the story decide comes first and
 * asks nothing of the reader; a photo, a drawing or a few words sit below it.
 * Asked in the chat, one person at a time, before the book's style: the first
 * drawing can become the whole book's style, so the style picker never asks
 * what a drawing is about to answer.
 *
 * Every choice is the reader's reply (a tap echo with undo). Once the book has
 * a style, a choice also starts the portraits it makes possible, at no more
 * than the price the card shows.
 *
 * Quiet mode is the same choices on a person who was selected from the cast.
 * It only saves the source. A portrait that no longer matches offers its own
 * redraw, and it does not take the place of the button that creates the book.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Camera, ImagePlus, PencilLine, Sparkles } from "lucide-react";
import { describeError, ProviderError } from "../../../core/errors";
import {
  lookFocusOf,
  lookSourceOf,
  looksToDecide,
  portraitStatus,
  type LookChoice,
} from "../../../core/guide/portrait";
import { briefOf } from "../../../core/story/brief";
import { missingDetails } from "../../../core/story/castKinds";
import type { Project } from "../../../core/types";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { redrawUnits, startRedraw } from "../../../state/chatGeneration";
import { useChatStudio } from "../../../state/chatStudio";
import { useJobsStore } from "../../../state/jobsStore";
import {
  chooseAndStartPortraits,
  lookChoiceStartEstimate,
  storyLooksStartEstimate,
} from "../../../state/portraitAutoStart";
import { cn } from "../../lib/cn";
import { decideLooksFromStory, updateCastMember } from "../bookActions";
import { useGuideLabel, useGuideT } from "../intl";
import { PaidAction } from "./PaidAction";
import { DrawingPanel, PanelShell, PhotoPanel, photoWasUsedUp, StartNote, type StartEstimate } from "./LookPickers";
import { PortraitAgeRow } from "./PortraitAgeRow";

type Panel = LookChoice | null;

/** Recomputed when prices, the running jobs, or the book change. */
function useStartEstimates(project: Project, castId: string, storyIds: readonly string[]) {
  const stats = useAppConfigStore((s) => s.imageCostStats);
  const sparks = useAppConfigStore((s) => s.sparks);
  const active = useJobsStore((s) => s.activeUnitIds);
  const storyKey = storyIds.join(",");
  const own = useMemo(
    () => lookChoiceStartEstimate(project, castId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, castId, stats, sparks, active],
  );
  const story = useMemo(
    () => storyLooksStartEstimate(project, storyIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, storyKey, stats, sparks, active],
  );
  return { own, story };
}

export function CastLooksWell({
  project,
  castId,
  name,
  onDefault,
  quiet = false,
  onClose,
  showTitle = false,
}: {
  project: Project;
  castId: string;
  name: string;
  onDefault: (run: (() => void) | null) => void;
  /** Save the source only. Do not start a portrait or take the chat's default action. */
  quiet?: boolean;
  onClose?: () => void;
  /** The surrounding card does not already name this person. */
  showTitle?: boolean;
}) {
  const t = useGuideT("looks");
  const chrome = useGuideT("chrome");
  const label = useGuideLabel();
  const sheet = useGuideT("sheet");
  const tap = useChatStudio((s) => s.tap);
  const focus = lookFocusOf(project);
  const [panel, setPanel] = useState<Panel>(() =>
    focus?.castId === castId ? focus.source : quiet ? currentSourcePanel(project, castId) : null,
  );
  useEffect(() => {
    if (focus?.castId === castId) setPanel(focus.source);
  }, [focus?.castId, focus?.source, castId]);

  const styled = project.config.styleReady !== false;
  const open = looksToDecide(project);
  const many = open.length > 1;
  const storyIds = useMemo(() => (many ? open.map((m) => m.id) : [castId]), [many, open, castId]);
  const estimates = useStartEstimates(project, castId, storyIds);
  const member = (briefOf(project.config).cast ?? []).find((m) => m.id === castId);

  const surprise = (ids: readonly string[]) => {
    if (quiet) {
      void decideLooksFromStory([...ids]);
      return;
    }
    const cap = estimates.story?.maxSparks ?? null;
    const all = ids.length > 1;
    void tap(
      all ? t("surpriseAll") : t("surprise"),
      () => chooseAndStartPortraits(() => decideLooksFromStory([...ids]), cap),
      {
        undoable: true,
        reply: all
          ? [{ key: "looksFromStory", priority: "result" }]
          : [{ key: "lookFromStory", priority: "result", vars: { names: name } }],
      },
    );
  };
  const surpriseDefault = useRef(() => surprise(storyIds));
  surpriseDefault.current = () => surprise(storyIds);
  useEffect(() => {
    if (quiet) return;
    onDefault(() => surpriseDefault.current());
    return () => onDefault(null);
  }, [onDefault, quiet]);

  if (!member) return null;
  const needsAge = missingDetails(member).includes("age");
  const stale = quiet && portraitStatus(project, castId) === "stale";
  const photoUsedUp = photoWasUsedUp(project, member);

  const options: { id: LookChoice; icon: typeof Camera; title: string; hint: string }[] = [
    { id: "photo", icon: Camera, title: t("photo", { name }), hint: t("photoHint", { name }) },
    {
      id: "drawing",
      icon: ImagePlus,
      title: t("drawing", { name }),
      hint: t(styled ? "drawingHint" : "drawingHintStyle", { name }),
    },
    { id: "describe", icon: PencilLine, title: t("describe", { name }), hint: t("describeHint") },
  ];

  return (
    <div className="flex w-full flex-col gap-3">
      {quiet && (showTitle || onClose) && (
        <div className={cn("flex items-center gap-3", showTitle ? "justify-between" : "justify-end")}>
          {showTitle && <p className="text-sm font-medium text-ink-900">{t("title", { name })}</p>}
          {onClose && <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-ink-600 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            {sheet("close")}
          </button>}
        </div>
      )}
      <PortraitFailed castId={castId} name={name} onAddPhoto={() => setPanel("photo")} />
      {needsAge && <PortraitAgeRow project={project} member={member} label={t("age", { name })} />}

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => surprise(quiet ? [castId] : storyIds)}
          className="group flex w-full items-start gap-3 rounded-xl bg-magic-50 px-3.5 py-3 text-left ring-1 ring-magic-200 transition hover:ring-magic-400 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magic-500"
        >
          <Sparkles className="mt-0.5 size-4 shrink-0 text-magic-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink-900">{many && !quiet ? t("surpriseAll") : t("surprise")}</span>
              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-magic-700 ring-1 ring-magic-200">
                {t("recommended")}
              </span>
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-600">
              {many && !quiet ? t("surpriseAllHint") : t("surpriseHint", { name })}
            </span>
            {!quiet && <StartNote estimate={estimates.story} className="mt-1" />}
          </span>
        </button>
        {many && !quiet && (
          <button
            type="button"
            onClick={() => surprise([castId])}
            className="self-start rounded-full px-2 py-1 text-xs font-medium text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400"
          >
            {t("surpriseOnly", { name })}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="px-0.5 text-xs font-medium text-ink-500">{t("ownRow")}</p>
        <div className="grid w-full grid-cols-1 gap-1.5 sm:grid-cols-3">
          {options.map((option) => {
            const active = panel === option.id;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                aria-expanded={active}
                onClick={() => setPanel(active ? null : option.id)}
                className={cn(
                  "flex items-start gap-2 rounded-lg px-2.5 py-2 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
                  active ? "bg-ink-50 ring-ink-500" : "bg-white ring-ink-200 hover:ring-ink-400",
                )}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-500" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-tight text-ink-800">{option.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-500">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {styled && !quiet && <StartNote estimate={estimates.own} className="px-0.5" />}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {panel && (
          <motion.div
            key={panel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.15 }}
          >
            {panel === "photo" && (
              <PhotoPanel
                project={project}
                member={member}
                name={name}
                cap={styled ? estimates.own : null}
                quiet={quiet}
              />
            )}
            {panel === "drawing" && (
              <DrawingPanel member={member} name={name} styled={styled} estimate={estimates.own} quiet={quiet} />
            )}
            {panel === "describe" && (
              <DescribePanel
                castId={castId}
                name={name}
                initial={member.appearanceFromStory ? "" : member.appearance ?? ""}
                cap={styled ? estimates.own : null}
                quiet={quiet}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {stale && (
        <PaidAction
          purpose="redraw"
          units={redrawUnits(project, castId, "portrait")}
          extraKey={castId}
          label={label("redrawTarget", { names: [name] })}
          start={(quote) => startRedraw(quote, "")}
        />
      )}
      {stale && (
        <p className="px-0.5 text-xs leading-snug text-ink-500">
          {chrome("portraitOutOfDate", { names: name })}
          {photoUsedUp && panel !== "photo" && (
            <>
              {" "}
              {t("photoUsedUp", { name })}{" "}
              <button
                type="button"
                onClick={() => setPanel("photo")}
                className="font-medium text-ink-800 underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
              >
                {t("addPhotoAgain")}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** The option a person already uses, so the card opens on it with what was chosen showing. */
function currentSourcePanel(project: Project, castId: string): Panel {
  const member = (briefOf(project.config).cast ?? []).find((m) => m.id === castId);
  if (!member) return null;
  const source = lookSourceOf(member);
  if (source === "photo" || source === "drawing") return source;
  if (source === "describe" && !member.appearanceFromStory) return "describe";
  return null;
}

/** Provider classes worth naming to a parent; the rest read as "try again". */
function failureReason(failure: { errorKind?: ProviderError["kind"] }): string | null {
  const kind = failure.errorKind;
  if (!kind || kind === "invalid_request" || kind === "not_found" || kind === "unknown") return null;
  return describeError(new ProviderError("", { kind }));
}

function PortraitFailed({ castId, name, onAddPhoto }: { castId: string; name: string; onAddPhoto: () => void }) {
  const t = useGuideT("looks");
  const failure = useJobsStore((s) => s.failedUnits[castId]);
  const active = useJobsStore((s) => s.activeUnitIds.has(castId));
  if (!failure || active || failure.kind !== "portrait") return null;
  const photoGone = failure.error.startsWith("The photo has expired");
  const reason = photoGone ? t("portraitFailedPhoto") : failureReason(failure);
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-snug text-amber-900 ring-1 ring-amber-200"
    >
      <AlertCircle className="mt-px size-3.5 shrink-0 text-amber-600" aria-hidden />
      <span>
        <span className="font-medium">{t("portraitFailed", { name })}</span>
        {reason && <> {reason}</>}
        {photoGone && (
          <>
            {" "}
            <button
              type="button"
              onClick={onAddPhoto}
              className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
            >
              {t("addPhotoAgain")}
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function DescribePanel({
  castId,
  name,
  initial,
  cap,
  quiet,
}: {
  castId: string;
  name: string;
  initial: string;
  cap: StartEstimate;
  quiet: boolean;
}) {
  const t = useGuideT("looks");
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  const save = () => {
    const look = text.trim().slice(0, 600);
    if (!look) return;
    if (quiet) {
      void updateCastMember(castId, { appearance: look, lookSource: "describe", appearanceFromStory: false });
      return;
    }
    void useChatStudio.getState().tap(
      look,
      () =>
        chooseAndStartPortraits(
          () => updateCastMember(castId, { appearance: look, lookSource: "describe", appearanceFromStory: false }),
          cap?.maxSparks ?? null,
        ),
      { undoable: true, reply: [{ key: "lookNoted", priority: "result", vars: { names: name } }] },
    );
  };
  return (
    <PanelShell>
      <label className="text-xs font-medium text-ink-700" htmlFor={`look-${castId}`}>
        {t("describeLabel", { name })}
      </label>
      <textarea
        id={`look-${castId}`}
        ref={field}
        rows={2}
        value={text}
        maxLength={600}
        placeholder={t("describePlaceholder")}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            save();
          }
        }}
        className="w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-ink-200 outline-none placeholder:text-ink-400 focus:ring-2 focus:ring-ink-400"
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={save}
        className="inline-flex min-h-10 items-center self-start rounded-full bg-ink-900 px-4 text-sm font-semibold text-white shadow-soft transition hover:bg-ink-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 focus-visible:ring-offset-2 disabled:opacity-40"
      >
        {t("save")}
      </button>
    </PanelShell>
  );
}
