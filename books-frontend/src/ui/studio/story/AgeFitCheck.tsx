"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Feather, Lightbulb, Loader2, SearchCheck, X } from "lucide-react";
import { storyFitRemote, type StoryFitResult } from "../../../platform/aiClient";
import { useProjectsStore } from "../../../state/projectsStore";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { dimensionDef } from "../../../core/config/audienceCatalog";
import { resolveAudienceProfile } from "../../../core/config/audience";
import type { AgeBandStoryCraft } from "../../../core/config/storyCraftCatalog";
import { wordCount } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { useGuideT } from "../../guide/intl";
import { cn } from "../../lib/cn";
import { fadeRise } from "../../lib/motion";
import { notify } from "../../lib/notify";

/**
 * Deliberately no red, no warning triangle, anywhere here. The gentlest
 * verdict just gets the quietest treatment — this is a friendly second
 * opinion, not a pass/fail grade, and every tone here should read that way.
 */
const VERDICTS = {
  good: {
    icon: CheckCircle2,
    tone: "bg-emerald-50/80 text-emerald-800 ring-emerald-100",
    iconTone: "text-emerald-600",
  },
  minor: {
    icon: Lightbulb,
    tone: "bg-amber-50/80 text-amber-900 ring-amber-100",
    iconTone: "text-amber-600",
  },
  mismatch: {
    icon: Feather,
    tone: "bg-sky-50/80 text-sky-900 ring-sky-100",
    iconTone: "text-sky-600",
  },
} as const;

/**
 * A friendly, entirely optional second opinion on a story the author wrote
 * themselves. It never blocks anything, never rewrites a word, and can be
 * dismissed the moment it appears — the whole point is a warm perspective the
 * author can take or leave, not a gate to get past.
 */
export function AgeFitCheck({
  storyText,
  ageRangeId,
  craft,
}: {
  storyText: string;
  ageRangeId: string;
  craft: AgeBandStoryCraft;
}) {
  const t = useGuideT("storyTools");
  const [result, setResult] = useState<StoryFitResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The text the current read describes, so an edit visibly outdates it. */
  const checkedText = useRef<string>("");

  const audience = useAppConfigStore((s) => s.audience);
  const ageWriting = useAppConfigStore((s) => s.ageWriting);
  const storyCraftConfig = useAppConfigStore((s) => s.storyCraft);
  const profile = resolveAudienceProfile(ageRangeId, {
    audience,
    ageWriting,
    storyCraft: storyCraftConfig,
  });
  const bandLabel = profile.label;

  const words = wordCount(storyText);
  const ready = words > 0 && storyText.trim().length >= 20;
  // Two ways a read goes out of date: the author edited the story, or an admin
  // changed what this age band means. Both are shown the same gentle way.
  const textStale = result !== null && checkedText.current !== storyText;
  const bandStale =
    result !== null &&
    result.profileRevision !== undefined &&
    result.profileRevision !== (audience.revision ?? 0);
  const stale = textStale || bandStale;

  /** Qualities the read found notably lighter or heavier than usual. */
  const offTarget = (result?.dimensions ?? [])
    .filter((d) => d.fit !== "typical")
    .map((d) => ({ label: dimensionDef(d.id)?.label ?? d.id, fit: d.fit }));

  // A read about a different age band is meaningless; drop it on a change.
  useEffect(() => {
    setResult(null);
    setDismissed(false);
  }, [ageRangeId]);

  const lengthHint =
    words === 0
      ? null
      : words < craft.structure.minWords
        ? t("shortLengthHint", {
            band: bandLabel,
            min: craft.structure.minWords,
            max: craft.structure.maxWords,
          })
        : words > craft.structure.maxWords
          ? t("longLengthHint", {
              band: bandLabel,
              min: craft.structure.minWords,
              max: craft.structure.maxWords,
            })
          : null;

  async function check() {
    const project = useProjectsStore.getState().current();
    if (!project || checking) return;
    setChecking(true);
    try {
      const storyProject = {
        ...project,
        config: { ...project.config, storyText },
      };
      const fit = await storyFitRemote(storyProject);
      checkedText.current = storyText;
      setResult(fit);
      setDismissed(false);
    } catch (err) {
      notify.error(err);
    } finally {
      setChecking(false);
    }
  }

  if (!ready) return null;

  const verdict = result ? VERDICTS[result.verdict] : null;
  const verdictLabel = result ? t(`verdict_${result.verdict}`) : "";
  const VerdictIcon = verdict?.icon;
  const showResult = result && verdict && VerdictIcon && !dismissed;

  return (
    <div className="space-y-2.5">
      {lengthHint && <p className="px-1 text-xs leading-relaxed text-ink-400">{lengthHint}</p>}

      <AnimatePresence initial={false}>
        {showResult && (
          <motion.div
            variants={fadeRise}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -4 }}
            className={cn("relative rounded-2xl px-4 py-3 pr-9 ring-1", verdict.tone, stale && "opacity-60")}
          >
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label={t("dismissNote")}
              className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-full text-current opacity-50 transition hover:opacity-100 hover:bg-black/5"
            >
              <X className="size-3.5" />
            </button>
            <div className="flex items-start gap-2.5">
              <VerdictIcon className={cn("mt-0.5 size-4 shrink-0", verdict.iconTone)} />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold">{verdictLabel}</p>
                {result.headline && (
                  <p className="text-xs leading-relaxed opacity-90">{result.headline}</p>
                )}
                {result.notes.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-xs leading-relaxed opacity-90">
                    {result.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {offTarget.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {offTarget.map((d) => (
                      <span
                        key={d.label}
                        className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium"
                      >
                        {d.label}: {d.fit === "lighter" ? t("lighterThanUsual") : t("richerThanUsual")}
                      </span>
                    ))}
                  </div>
                )}
                <p className="pt-0.5 text-[11px] font-medium opacity-70">
                  {textStale
                    ? t("noteEarlierVersion")
                    : bandStale
                      ? t("bandUpdated", { band: bandLabel })
                      : t("friendlyTake")}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button
          variant="secondary"
          size="sm"
          loading={checking}
          leftIcon={!checking ? <SearchCheck className="size-4" /> : undefined}
          onClick={() => void check()}
        >
          {result && !stale ? t("freshTake") : t("readerFit", { band: bandLabel })}
        </Button>
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          {checking ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("havingRead")}
            </>
          ) : (
            t("optionalPerspective")
          )}
        </span>
      </div>
    </div>
  );
}
