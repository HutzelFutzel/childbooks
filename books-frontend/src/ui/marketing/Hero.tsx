import { Sparkles } from "lucide-react";
import { EditableImage } from "./EditableImage";
import { EditableText } from "./EditableText";
import { HeroOnRamp } from "./HeroOnRamp";
import type { SiteImagesMap, SiteTextMap } from "./content";

/** Above-the-fold hero. Text renders instantly (fast LCP); art is admin-editable. */
export function Hero({ images, text }: { images: SiteImagesMap; text: SiteTextMap }) {
  return (
    <section className="relative overflow-hidden bg-grid pt-28">
      {/* Soft brand glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-brand-200/40 blur-3xl"
      />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-4 py-1 text-sm font-semibold text-brand-700">
            <Sparkles className="size-3.5" />
            <EditableText slotId="hero.badge" as="span" defaultValue="AI-illustrated picture books" serverValue={text["hero.badge"]} />
          </span>
          <EditableText
            slotId="hero.title"
            as="h1"
            multiline
            defaultValue="Turn a story into a printed picture book."
            serverValue={text["hero.title"]}
            className="mt-6 font-display text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl lg:text-6xl"
          />
          <EditableText
            slotId="hero.subtitle"
            as="p"
            multiline
            defaultValue="Write your tale, design recurring characters and places, and let AI illustrate every page with a consistent look — then order a beautiful, print-ready book delivered to your door."
            serverValue={text["hero.subtitle"]}
            className="mx-auto mt-6 max-w-xl text-lg text-ink-600 lg:mx-0"
          />
          {/* The on-ramp: type the hero's name, land in the studio with their
              book already created. Lowest possible friction to first value. */}
          <div className="mt-9">
            <HeroOnRamp text={text} />
          </div>
          <div className="mt-4 flex flex-col items-center gap-2 sm:flex-row sm:gap-4 lg:justify-start">
            <EditableText
              slotId="hero.note"
              as="p"
              defaultValue="Free to start — no account or credit card needed."
              serverValue={text["hero.note"]}
              className="text-sm text-ink-500"
            />
            <a
              href="#how-it-works"
              className="text-sm font-semibold text-brand-700 underline-offset-4 transition hover:underline"
            >
              <EditableText slotId="hero.ctaSecondary" as="span" defaultValue="See how it works" serverValue={text["hero.ctaSecondary"]} />
            </a>
          </div>
        </div>

        {/* Hero visual. Floating page cards frame the main spread. */}
        <div className="relative">
          <EditableImage
            slotId="hero.main"
            label="Hero storybook spread"
            ratio="4/3"
            hint="1200×900 · illustrated open book / sample spread"
            serverUrl={images["hero.main"]?.imageUrl}
            alt={images["hero.main"]?.alt}
            sizes="(max-width: 1024px) 100vw, 600px"
          />
          <div className="absolute -bottom-6 -left-4 hidden w-32 -rotate-6 sm:block">
            <EditableImage
              slotId="hero.card1"
              label="Sample page"
              ratio="4/5"
              hint="400×500"
              className="shadow-lifted"
              serverUrl={images["hero.card1"]?.imageUrl}
              alt={images["hero.card1"]?.alt}
              sizes="128px"
            />
          </div>
          <div className="absolute -right-4 -top-6 hidden w-32 rotate-6 sm:block">
            <EditableImage
              slotId="hero.card2"
              label="Sample page"
              ratio="4/5"
              hint="400×500"
              className="shadow-lifted"
              serverUrl={images["hero.card2"]?.imageUrl}
              alt={images["hero.card2"]?.alt}
              sizes="128px"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
