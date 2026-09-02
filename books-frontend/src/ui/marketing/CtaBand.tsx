"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookCheck, Loader2, Sparkles, Truck } from "lucide-react";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteTextMap } from "./content";

const MAX_NAME_LENGTH = 40;

/** Full-width closing call-to-action with instant on-ramp and reassurance perks. */
export function CtaBand({ text }: { text: SiteTextMap }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const start = () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    const target = trimmed ? `/studio?hero=${encodeURIComponent(trimmed)}` : "/studio";
    router.push(target);
  };

  const trimmed = name.trim();

  return (
    <section className="px-6 py-20 lg:py-28">
      <Reveal className="mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-4xl bg-linear-to-br from-brand-600 via-brand-700 to-brand-900 px-8 py-16 text-center shadow-lifted sm:px-12 sm:py-20">
          {/* Subtle ambient lighting */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 size-80 rounded-full bg-white/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-20 -left-20 size-80 rounded-full bg-brand-400/20 blur-3xl"
          />

          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-1 text-xs font-semibold tracking-wide text-white backdrop-blur-xs ring-1 ring-white/20">
            <Sparkles className="size-3.5 text-accent-300" />
            <span>Make bedtime magical</span>
          </span>

          <EditableText
            slotId="cta.heading"
            as="h2"
            multiline
            defaultValue="Ready to make your child's picture book?"
            serverValue={text["cta.heading"]}
            className="mx-auto mt-6 max-w-2xl font-display text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl"
          />
          <EditableText
            slotId="cta.subhead"
            as="p"
            multiline
            defaultValue="Start writing and illustrating in seconds. Free to create, design, and preview - no card required."
            serverValue={text["cta.subhead"]}
            className="mx-auto mt-4 max-w-xl text-lg text-brand-100/90"
          />

          {/* Direct bottom on-ramp */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
            className="mx-auto mt-9 flex w-full max-w-lg flex-col gap-2 rounded-3xl bg-white p-2 shadow-lifted sm:flex-row sm:items-center sm:rounded-full"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              disabled={isSubmitting}
              placeholder={text["hero.namePlaceholder"] ?? "Who is the story about? (e.g. Maya)"}
              aria-label="The hero of your story"
              className="h-12 flex-1 rounded-full bg-transparent px-5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-brand-600 px-6 text-base font-semibold text-white shadow-soft transition-all hover:bg-brand-700 active:scale-[0.98] disabled:opacity-80"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4.5 animate-spin" />
                  <span>Opening studio...</span>
                </>
              ) : (
                <>
                  <span>{trimmed ? `Create ${trimmed}'s book` : "Create their storybook"}</span>
                  <ArrowRight className="size-4.5" />
                </>
              )}
            </button>
          </form>

          {/* Bottom reassurance badges */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-brand-100/80">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-accent-300" />
              <span>Instant digital preview</span>
            </div>
            <div className="flex items-center gap-1.5">
              <BookCheck className="size-3.5 text-accent-300" />
              <span>Heirloom hardcover option</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Truck className="size-3.5 text-accent-300" />
              <span>Worldwide shipping</span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
