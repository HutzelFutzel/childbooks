import { Quote } from "lucide-react";
import { EditableImage } from "./EditableImage";
import { EditableText } from "./EditableText";
import { Reveal } from "./Reveal";
import type { SiteImagesMap, SiteTextMap } from "./content";

/**
 * The personal "why" behind the product — a short founder's note with a
 * portrait, sitting right before Pricing. Rational features are already made
 * by this point; this section is the emotional case for why the product is
 * trustworthy and real, not a content mill.
 */
export function FounderStory({ images, text }: { images: SiteImagesMap; text: SiteTextMap }) {
  return (
    <section id="founder-story" aria-label="From our founder" className="scroll-mt-20 bg-brand-50/40 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-6">
        <Reveal>
          <figure className="rounded-3xl border border-ink-200 bg-white p-8 shadow-soft sm:p-12">
            <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start">
              <div className="w-28 shrink-0 sm:w-32">
                <EditableImage
                  slotId="founder.photo"
                  label="Founder photo"
                  ratio="1/1"
                  hint="800×800 · portrait, plain background"
                  className="rounded-full"
                  serverUrl={images["founder.photo"]?.imageUrl}
                  alt={images["founder.photo"]?.alt}
                  sizes="128px"
                  fit="cover"
                />
              </div>
              <div className="text-center sm:text-left">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-4 py-1 text-sm font-semibold text-brand-700">
                  <EditableText
                    slotId="founder.eyebrow"
                    as="span"
                    defaultValue="Why we started"
                    serverValue={text["founder.eyebrow"]}
                  />
                </span>
                <Quote aria-hidden className="mx-auto mt-4 hidden size-8 text-brand-200 sm:mx-0 sm:block" />
                <blockquote>
                  <EditableText
                    slotId="founder.quote"
                    as="p"
                    multiline
                    defaultValue="When my toddler needed surgery, I couldn't find a single picture book gentle enough to help him understand what was about to happen. So I made one myself — and that book became Childbook Studio."
                    serverValue={text["founder.quote"]}
                    className="mt-4 font-display text-xl font-semibold leading-snug text-ink-900 sm:text-2xl"
                  />
                </blockquote>
                <figcaption className="mt-6 flex items-center justify-center gap-2 text-sm text-ink-500 sm:justify-start">
                  <EditableText
                    slotId="founder.name"
                    as="span"
                    defaultValue="Founder"
                    serverValue={text["founder.name"]}
                    className="font-semibold text-ink-800"
                  />
                  <span aria-hidden>·</span>
                  <EditableText
                    slotId="founder.role"
                    as="span"
                    defaultValue="Childbook Studio"
                    serverValue={text["founder.role"]}
                  />
                </figcaption>
              </div>
            </div>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
