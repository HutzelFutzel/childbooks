"use client";

/**
 * The story check's answer, in the thread under the guide's line.
 *
 * Deliberately no red and no warning triangle: the gentlest verdict gets the
 * quietest treatment. This is a friendly second opinion, not a grade. The
 * words are the checker's own; the labels around them are trusted UI copy.
 * Only the newest card about the current text offers to act on it, so an old
 * card never holds a live button.
 */
import { CheckCircle2, Feather, Lightbulb, Wand2 } from "lucide-react";
import type { StoryFitCard as FitCard } from "../../../core/guide/session";
import { storyTextHash } from "../../../core/story/revision";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { useGuideT } from "../intl";

const VERDICTS = {
  good: { icon: CheckCircle2, tone: "bg-emerald-50/80 text-emerald-900 ring-emerald-100", iconTone: "text-emerald-600" },
  minor: { icon: Lightbulb, tone: "bg-amber-50/80 text-amber-900 ring-amber-100", iconTone: "text-amber-600" },
  mismatch: { icon: Feather, tone: "bg-sky-50/80 text-sky-900 ring-sky-100", iconTone: "text-sky-600" },
} as const;

export function StoryFitCard({
  fit,
  storyText,
  actionable,
}: {
  fit: FitCard;
  storyText: string;
  /** The newest card, in a book that can still be changed. */
  actionable: boolean;
}) {
  const t = useGuideT("storyTools");
  const tap = useChatStudio((s) => s.tap);
  const runSkill = useChatStudio((s) => s.runSkill);
  const sending = useChatStudio((s) => s.sending);
  const verdict = VERDICTS[fit.verdict];
  const Icon = verdict.icon;
  const current = storyTextHash(storyText) === fit.textHash;
  const canAdjust = actionable && current && fit.verdict !== "good" && fit.band !== "";
  const hasBody = fit.notes.length > 0 || fit.dimensions.length > 0;

  return (
    <div className={cn("flex max-w-[58ch] flex-col gap-2 rounded-2xl px-4 py-3 ring-1", verdict.tone, !current && "opacity-70")}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-4 shrink-0", verdict.iconTone)} aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold">{t(`verdict_${fit.verdict}`)}</p>
          {hasBody && (
            <>
              {fit.notes.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4 text-[13px] leading-relaxed opacity-90">
                  {fit.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
              {fit.dimensions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {fit.dimensions.map((d) => (
                    <span key={d.label} className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">
                      {d.label}: {d.fit === "lighter" ? t("lighterThanUsual") : t("richerThanUsual")}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="text-[11px] font-medium opacity-70">
            {current ? t("friendlyTake") : t("noteEarlierVersion")}
          </p>
        </div>
      </div>
      {canAdjust && (
        <button
          type="button"
          disabled={sending}
          onClick={() =>
            void tap(t("fitAdjust", { band: fit.band }), () =>
              runSkill({ id: "reviseStory", args: { instruction: t("fitAdjustInstruction", { band: fit.band }) } }),
            )
          }
          className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-medium text-ink-900 ring-1 ring-ink-200 shadow-soft transition hover:ring-ink-400 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:opacity-60"
        >
          <Wand2 className="size-3.5 text-magic-600" aria-hidden />
          {t("fitAdjust", { band: fit.band })}
        </button>
      )}
    </div>
  );
}
