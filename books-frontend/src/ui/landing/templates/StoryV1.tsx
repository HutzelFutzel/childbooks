import Image from "next/image";
import { Check, ChevronRight } from "lucide-react";
import {
  imageAlt,
  type LandingImage,
  type LandingPage,
} from "../../../core/config/landingPages";
import { LandingCta } from "../LandingCta";
import type { LandingTemplateProps } from "./types";

/**
 * "story-v1" — the first landing template.
 *
 *   Hero → three steps → three-image showcase → benefits band (+ testimonial)
 *   → FAQ → closing call-to-action.
 *
 * Purely presentational: it reads semantic content from the page and decides
 * nothing about SEO, routing or links. A section with no content is omitted
 * rather than rendered empty, so a half-filled draft previews honestly and a
 * published page never shows a blank heading.
 *
 * Heading order is fixed for accessibility and search: one `<h1>` (the hero),
 * an `<h2>` per section, `<h3>` for the cards inside them.
 *
 * Restyle through the variables in `../landing.css`; change the layout here.
 */
export function StoryV1({ page, ctaHref, embedded = false }: LandingTemplateProps) {
  return (
    <div className="lp">
      <Hero page={page} ctaHref={ctaHref} embedded={embedded} />
      <Steps page={page} />
      <Showcase page={page} />
      <Benefits page={page} />
      <Faq page={page} />
      <Closing page={page} ctaHref={ctaHref} />
    </div>
  );
}

/** `next/image` fill inside an aspect-ratio frame — no layout shift, any source size. */
function Picture({
  image,
  alt,
  sizes,
  priority = false,
}: {
  image: LandingImage;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={image.imageUrl}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className="object-cover"
    />
  );
}

function Hero({
  page,
  ctaHref,
  embedded,
}: {
  page: LandingPage;
  ctaHref: string;
  embedded: boolean;
}) {
  const { hero } = page;
  const hasImage = Boolean(hero.image);
  return (
    <section className={embedded ? "pt-10" : "pt-28 sm:pt-32"}>
      <div
        className={`mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 lg:pb-24 ${
          hasImage ? "lg:grid-cols-2" : ""
        }`}
      >
        <div>
          {hero.eyebrow && (
            <p className="lp-eyebrow text-sm font-semibold">{hero.eyebrow}</p>
          )}
          <h1 className="lp-heading mt-4 text-4xl font-semibold leading-[1.1] sm:text-5xl lg:text-6xl">
            {hero.title || page.title}
          </h1>
          {hero.subtitle && (
            <p className="lp-body mt-6 max-w-xl text-lg leading-relaxed">{hero.subtitle}</p>
          )}
          {hero.ctaLabel && (
            <div className="mt-8">
              <LandingCta href={ctaHref}>{hero.ctaLabel}</LandingCta>
            </div>
          )}
          {hero.bullets.length > 0 && (
            <ul className="lp-muted mt-6 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-sm">
              {hero.bullets.map((b) => (
                <li key={b} className="inline-flex items-center gap-1.5">
                  <Check aria-hidden className="size-3.5 shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>

        {hero.image && (
          <div className="lp-media relative aspect-4/3 w-full">
            <Picture
              image={hero.image}
              alt={imageAlt(hero.image, hero.title, page.title)}
              sizes="(max-width: 1024px) 100vw, 560px"
              priority
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Steps({ page }: { page: LandingPage }) {
  const { steps } = page;
  const items = steps.items.filter((s) => s.title || s.body);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="lp-steps" className="pb-16 lg:pb-24">
      <div className="mx-auto max-w-6xl px-6">
        {steps.heading && (
          <h2
            id="lp-steps"
            className="lp-heading mx-auto max-w-3xl text-center text-3xl font-semibold sm:text-4xl"
          >
            {steps.heading}
          </h2>
        )}
        <ol className="mt-10 grid list-none gap-6 p-0 md:grid-cols-3">
          {items.map((step, i) => (
            <li key={i} className="lp-card p-7">
              <span
                aria-hidden
                className="lp-step-number flex size-9 items-center justify-center rounded-full text-sm font-semibold"
              >
                {i + 1}
              </span>
              <h3 className="lp-heading mt-4 text-xl font-semibold">{step.title}</h3>
              <p className="lp-body mt-2 text-base leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Showcase({ page }: { page: LandingPage }) {
  const items = page.showcase.items.filter((i) => i.image);
  if (items.length === 0) return null;
  return (
    <section aria-label="Examples" className="pb-16 lg:pb-24">
      <div className="mx-auto max-w-6xl px-6">
        <ul className="grid list-none gap-6 p-0 sm:grid-cols-3">
          {items.map((item, i) => (
            <li key={i}>
              <figure className="m-0">
                <div className="lp-media relative aspect-4/5 w-full">
                  {item.image && (
                    <Picture
                      image={item.image}
                      alt={imageAlt(item.image, item.caption, page.title)}
                      sizes="(max-width: 640px) 100vw, 360px"
                    />
                  )}
                </div>
                {item.caption && (
                  <figcaption className="lp-muted mt-3 text-center text-sm">{item.caption}</figcaption>
                )}
              </figure>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Benefits({ page }: { page: LandingPage }) {
  const { benefits } = page;
  const items = benefits.items.filter((b) => b.title || b.body);
  const quote = benefits.quote.text ? benefits.quote : null;
  if (items.length === 0 && !quote) return null;
  return (
    <section aria-labelledby="lp-benefits" className="lp-band py-16 lg:py-20">
      <div className="mx-auto max-w-6xl px-6">
        {benefits.heading && (
          <h2 id="lp-benefits" className="lp-heading text-3xl font-semibold sm:text-4xl">
            {benefits.heading}
          </h2>
        )}
        {items.length > 0 && (
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {items.map((item, i) => (
              <div key={i}>
                <h3 className="lp-band-title text-xl font-semibold">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        )}
        {quote && (
          <figure className="m-0 mt-12 max-w-3xl">
            <blockquote className="lp-heading m-0 text-2xl italic leading-snug sm:text-3xl">
              &ldquo;{quote.text}&rdquo;
            </blockquote>
            {quote.attribution && (
              <figcaption className="lp-band-muted mt-3 text-sm">{quote.attribution}</figcaption>
            )}
          </figure>
        )}
      </div>
    </section>
  );
}

function Faq({ page }: { page: LandingPage }) {
  const { faq } = page;
  if (faq.items.length === 0) return null;
  return (
    <section aria-labelledby="lp-faq" className="py-16 lg:py-24">
      <div className="mx-auto max-w-3xl px-6">
        {faq.heading && (
          <h2 id="lp-faq" className="lp-heading text-3xl font-semibold">
            {faq.heading}
          </h2>
        )}
        <div className="lp-rule mt-6 divide-y border-y">
          {faq.items.map((item, i) => (
            <details key={i} className="lp-rule group">
              <summary className="flex cursor-pointer items-center gap-3 py-4 text-base font-semibold lp-heading">
                <ChevronRight aria-hidden className="lp-chevron size-4 shrink-0" />
                {item.question}
              </summary>
              <p className="lp-body pb-5 pl-7 text-base leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ page, ctaHref }: { page: LandingPage; ctaHref: string }) {
  const { closing } = page;
  if (!closing.heading && !closing.ctaLabel) return null;
  return (
    <section aria-labelledby="lp-closing" className="pb-20 pt-4 lg:pb-28">
      <div className="mx-auto max-w-4xl px-6 text-center">
        {closing.heading && (
          <h2 id="lp-closing" className="lp-heading text-3xl font-semibold sm:text-4xl">
            {closing.heading}
          </h2>
        )}
        {closing.ctaLabel && (
          <div className="mt-8">
            <LandingCta href={ctaHref}>{closing.ctaLabel}</LandingCta>
          </div>
        )}
      </div>
    </section>
  );
}
