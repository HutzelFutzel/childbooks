"use client";

import { motion } from "framer-motion";
import { Languages, Sparkles, Users } from "lucide-react";
import { getBookLanguage, type BookLanguageId } from "../../../core/config/bookLanguages";
import { ageBandLabel } from "../../../core/config/storyCraftCatalog";
import { Button } from "../../components/Button";
import { fadeRise } from "../../lib/motion";

export interface StoryAdaptCardProps {
  languageChanged: boolean;
  ageChanged: boolean;
  originLocale: BookLanguageId;
  currentLocale: BookLanguageId;
  originAge?: string;
  targetAge: string;
  translating: boolean;
  writing: boolean;
  onConfirm: () => void;
  onAdapt: () => void;
}

/**
 * Unified contextual CTA card displayed when language, audience/age, or both
 * have changed since the story was written. Provides a single clear action to
 * adapt/translate with AI or keep existing words.
 */
export function StoryAdaptCard({
  languageChanged,
  ageChanged,
  originLocale,
  currentLocale,
  originAge,
  targetAge,
  translating,
  writing,
  onConfirm,
  onAdapt,
}: StoryAdaptCardProps) {
  if (!languageChanged && !ageChanged) return null;

  const originLang = getBookLanguage(originLocale);
  const targetLang = getBookLanguage(currentLocale);
  const originAgeLabel = ageBandLabel(originAge ?? "0-2");
  const targetAgeLabel = ageBandLabel(targetAge);

  let title = `Translate to ${targetLang.endonym}?`;
  let description = (
    <>
      Story words are in <strong>{originLang.englishName}</strong> while book is set to{" "}
      <strong>{targetLang.englishName}</strong>.
    </>
  );
  let actionLabel = "Translate with AI";
  let Icon = Languages;

  if (languageChanged && ageChanged) {
    title = `Translate to ${targetLang.endonym} & adapt for ${targetAgeLabel}?`;
    description = (
      <>
        Story was written in <strong>{originLang.englishName}</strong> for{" "}
        <strong>{originAgeLabel}</strong>; book is now set to{" "}
        <strong>{targetLang.englishName}</strong> for <strong>{targetAgeLabel}</strong>.
      </>
    );
    actionLabel = "Translate & adapt with AI";
    Icon = Sparkles;
  } else if (ageChanged) {
    title = `Adapt story for ${targetAgeLabel}?`;
    description = (
      <>
        Originally written for <strong>{originAgeLabel}</strong>; book is now set to{" "}
        <strong>{targetAgeLabel}</strong>.
      </>
    );
    actionLabel = "Adapt with AI";
    Icon = Users;
  }

  return (
    <motion.div
      variants={fadeRise}
      initial="hidden"
      animate="show"
      className="relative overflow-hidden rounded-3xl border border-brand-200 bg-linear-to-br from-brand-50/90 via-white to-sky-50/50 p-4 shadow-soft ring-1 ring-brand-200/60"
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-2xs ring-1 ring-brand-200">
            <Icon className="size-4.5 text-brand-600" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-xs font-bold text-ink-900">{title}</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-600">{description}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={onConfirm}
            disabled={translating || writing}
            className="text-xs"
          >
            Keep current text
          </Button>
          <Button
            size="sm"
            variant="magic"
            leftIcon={<Sparkles className="size-3" />}
            loading={translating}
            disabled={translating || writing}
            onClick={onAdapt}
            className="text-xs"
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
