"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { EditableText } from "./EditableText";
import type { SiteTextMap } from "./content";

/** Longest hero name we'll carry into the studio (defensive cap). */
const MAX_NAME_LENGTH = 40;

/**
 * The landing page's low-friction on-ramp: type the child's name, press one
 * button, and land in the studio with a storybook already created for them
 * (`/studio?hero=Name` — the studio picks the name up and opens the new
 * project). Works without a name too; then it's just a fancy "start" button.
 */
export function HeroOnRamp({ text }: { text: SiteTextMap }) {
  const router = useRouter();
  const [name, setName] = useState("");

  const start = () => {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    router.push(trimmed ? `/studio?hero=${encodeURIComponent(trimmed)}` : "/studio");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
      className="mx-auto flex w-full max-w-lg flex-col gap-2 rounded-3xl bg-white p-2 shadow-lifted ring-1 ring-ink-200/60 sm:flex-row sm:items-center sm:rounded-full lg:mx-0"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={MAX_NAME_LENGTH}
        placeholder={text["hero.namePlaceholder"] ?? "Who is the story about?"}
        aria-label="The hero of your story"
        className="h-12 min-w-0 flex-1 rounded-full bg-transparent px-5 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none"
      />
      <button
        type="submit"
        className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-linear-to-b from-brand-500 to-brand-600 px-6 text-base font-semibold text-(--color-brand-foreground) shadow-soft transition hover:from-brand-600 hover:to-brand-700"
      >
        <EditableText
          slotId="hero.ctaPrimary"
          as="span"
          defaultValue="Create their storybook"
          serverValue={text["hero.ctaPrimary"]}
        />
        <ArrowRight className="size-4.5" />
      </button>
    </form>
  );
}
