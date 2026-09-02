"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { EditableText } from "./EditableText";
import type { SiteTextMap } from "./content";

/** Longest hero name we'll carry into the studio (defensive cap). */
const MAX_NAME_LENGTH = 40;

const SUGGESTIONS = ["Leo", "Maya", "Noah & Mia", "Emma"];

/**
 * The landing page's low-friction on-ramp: type the child's name, press one
 * button, and land directly in the studio with their storybook created.
 */
export function HeroOnRamp({ text }: { text: SiteTextMap }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const start = (customName?: string) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const targetName = (customName !== undefined ? customName : name).trim().slice(0, MAX_NAME_LENGTH);
    const effectiveHero = targetName || "My";
    router.push(`/studio?hero=${encodeURIComponent(effectiveHero)}`);
  };

  const trimmed = name.trim();

  return (
    <div className="w-full max-w-lg mx-auto lg:mx-0">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
        className="flex w-full flex-col gap-2 rounded-3xl bg-white p-2 shadow-lifted ring-1 ring-ink-200/60 sm:flex-row sm:items-center sm:rounded-full transition-all focus-within:ring-2 focus-within:ring-brand-400"
      >
        <div className="relative flex-1 flex items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            disabled={isSubmitting}
            placeholder={text["hero.namePlaceholder"] ?? "Who is the story about? (e.g. Maya)"}
            aria-label="The hero of your story"
            className="h-12 w-full rounded-full bg-transparent px-5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-linear-to-b from-brand-500 to-brand-600 px-6 text-base font-semibold text-(--color-brand-foreground) shadow-soft transition-all hover:from-brand-600 hover:to-brand-700 active:scale-[0.98] disabled:opacity-80"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-4.5 animate-spin" />
              <span>Opening storybook...</span>
            </>
          ) : (
            <>
              <EditableText
                slotId="hero.ctaPrimary"
                as="span"
                defaultValue={trimmed ? `Create ${trimmed}'s book` : "Create their storybook"}
                serverValue={trimmed ? `Create ${trimmed}'s book` : text["hero.ctaPrimary"]}
              />
              <ArrowRight className="size-4.5" />
            </>
          )}
        </button>
      </form>

      {/* Playful name ideas for instant inspiration */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-ink-500 lg:justify-start">
        <span className="inline-flex items-center gap-1 font-medium text-ink-400">
          <Sparkles className="size-3 text-brand-500" />
          Try:
        </span>
        {SUGGESTIONS.map((sug) => (
          <button
            key={sug}
            type="button"
            onClick={() => {
              setName(sug);
              start(sug);
            }}
            disabled={isSubmitting}
            className="rounded-full bg-brand-50/80 px-2.5 py-1 text-ink-600 ring-1 ring-brand-200/50 transition hover:bg-brand-100 hover:text-brand-800 disabled:opacity-50"
          >
            {sug}
          </button>
        ))}
      </div>
    </div>
  );
}

