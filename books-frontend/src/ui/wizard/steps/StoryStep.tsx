"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import type { StoryBrief } from "../../../core/types";
import { ageBandLabel, type StoryMode } from "../../../core/config/storyCraftCatalog";
import { resolveStoryCraft } from "../../../core/config/storyCraft";
import { createDefaultStoryBrief, isDraftStale } from "../../../core/story/brief";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { GuidedComposer } from "../../studio/story/GuidedComposer";
import { CoWriteComposer } from "../../studio/story/CoWriteComposer";
import { AgeFitCheck } from "../../studio/story/AgeFitCheck";
import { StoryManuscript } from "../../studio/story/StoryManuscript";
import { StoryModePicker } from "../../studio/story/StoryModePicker";
import { fadeRise } from "../../lib/motion";
import type { StepProps } from "./types";

/**
 * The Story step. Three ways in — write it for me, write it together, or write
 * it myself — all landing on the same manuscript. The chosen mode and its
 * inputs live on the config (`storyBrief`), so reopening the project a week
 * later still knows how this story came to be and can rewrite it.
 */
export function StoryStep({ config, update }: StepProps) {
  const storyCraft = useAppConfigStore((s) => s.storyCraft);
  const craft = useMemo(
    () => resolveStoryCraft(config.ageRangeId, storyCraft),
    [config.ageRangeId, storyCraft],
  );

  const hasStory = config.storyText.trim().length > 0;
  // A project written before modes existed keeps its words and is treated as
  // the author's own — never offer to overwrite text we didn't write.
  const brief: StoryBrief =
    config.storyBrief ?? createDefaultStoryBrief(hasStory ? "own" : "guided");
  const chosen = Boolean(config.storyBrief) || hasStory;

  const patchBrief = (patch: Partial<StoryBrief>) =>
    update({ storyBrief: { ...brief, ...patch } });

  const setMode = (mode: StoryMode) => {
    if (mode === brief.mode && config.storyBrief) return;
    patchBrief({ mode });
  };

  const stale = isDraftStale(brief, config.storyText, config.ageRangeId, config.readingModeId);
  const ageChanged =
    hasStory && Boolean(brief.generatedForAge) && brief.generatedForAge !== config.ageRangeId;

  if (!chosen) {
    return (
      <motion.div variants={fadeRise} initial="hidden" animate="show" className="space-y-5">
        <div className="px-1">
          <h2 className="font-display text-xl font-bold tracking-tight text-ink-900">
            How would you like to write it?
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-500">
            However you start, you&apos;ll be able to edit every word — and whichever you pick, the
            story is written for {ageBandLabel(config.ageRangeId)}.
          </p>
        </div>
        <StoryModePicker value={brief.mode} onChange={setMode} />
      </motion.div>
    );
  }

  return (
    <motion.div variants={fadeRise} initial="hidden" animate="show" className="flex flex-col gap-6">
      <StoryModePicker value={brief.mode} onChange={setMode} compact />

      {brief.mode === "guided" && (
        <GuidedComposer brief={brief} craft={craft} hasStory={hasStory} onChange={patchBrief} />
      )}
      {brief.mode === "co-write" && (
        <CoWriteComposer brief={brief} craft={craft} hasStory={hasStory} onChange={patchBrief} />
      )}

      {(stale || ageChanged) && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-amber-900 ring-1 ring-amber-100">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p className="text-xs leading-relaxed">
            {ageChanged ? (
              <>
                This story was written for {ageBandLabel(brief.generatedForAge!)}, and you now have{" "}
                {ageBandLabel(config.ageRangeId)} selected.{" "}
                {brief.mode === "own"
                  ? "Check it still reads right, or edit it below."
                  : "Write it again to match, or edit it below."}
              </>
            ) : (
              <>
                You&apos;ve changed the details since this draft was written. Write it again to use
                them, or keep this version and edit it below.
              </>
            )}
          </p>
        </div>
      )}

      {brief.mode === "own" && hasStory && (
        <AgeFitCheck
          storyText={config.storyText}
          ageRangeId={config.ageRangeId}
          craft={craft}
        />
      )}

      <StoryManuscript
        storyText={config.storyText}
        onChange={(storyText) => update({ storyText })}
        placeholder={
          brief.mode === "own"
            ? "Write or paste your story here…"
            : "Your story will appear here — or start typing and write it yourself."
        }
      />

      {!hasStory && (
        <p className="px-1 text-center text-xs leading-relaxed text-ink-400">
          A sentence or two is enough to continue — you can polish every page later.
        </p>
      )}
    </motion.div>
  );
}
