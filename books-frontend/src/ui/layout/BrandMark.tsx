import Link from "next/link";
import { cn } from "../lib/cn";

export interface BrandMarkProps {
  siteName: string;
  logoUrl?: string | null;
  iconUrl?: string | null;
  tagline?: string | null;
  href?: string;
  size?: "sm" | "md";
  className?: string;
  onClick?: () => void;
}

function monogramChar(siteName: string): string {
  const trimmed = siteName.trim();
  if (!trimmed) return "B";
  return trimmed[0]!.toUpperCase();
}

/**
 * Shared publisher imprint mark used in both the marketing margin (`Nav`,
 * `Footer`) and the workspace header (`TopBar`).
 *
 * When no custom logo image is uploaded, renders a coral bookplate stamp with
 * a fine inset rule and the brand monogram in `font-display` (`Fredoka`),
 * paired with the wordmark in `Fredoka`. Deliberately avoids the `Sparkles`
 * glyph so violet/spark iconography stays reserved for Sparks and live AI
 * generation moments.
 */
export function BrandMark({
  siteName,
  logoUrl,
  iconUrl,
  tagline,
  href = "/",
  size = "md",
  className,
  onClick,
}: BrandMarkProps) {
  const stampDim = size === "sm" ? "size-7 text-sm" : "size-8 text-[15px]";
  const wordSize = size === "sm" ? "text-[15px]" : "text-[17px]";

  const content = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={siteName}
      className={cn(size === "sm" ? "h-7 w-auto shrink-0" : "h-8 w-auto shrink-0")}
    />
  ) : (
    <>
      <span
        aria-hidden
        className={cn(
          stampDim,
          "relative flex shrink-0 items-center justify-center rounded-[9px] bg-brand-600 font-display font-semibold leading-none text-(--color-brand-foreground) [text-shadow:0_1px_1.5px_rgba(20,22,58,0.22)] shadow-2xs transition-transform duration-200 group-hover:scale-[1.03]",
          "after:pointer-events-none after:absolute after:inset-[2.5px] after:rounded-[6.5px] after:border after:border-white/25",
        )}
      >
        {iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={iconUrl} alt="" className="size-4.5 object-contain" />
        ) : (
          <span>{monogramChar(siteName)}</span>
        )}
      </span>
      <span className="min-w-0 leading-tight">
        <span
          className={cn(
            wordSize,
            "block truncate font-display font-medium tracking-[-0.01em] text-ink-900",
          )}
        >
          {siteName}
        </span>
        {tagline && (
          <span className="hidden truncate text-[11px] font-normal text-ink-400 sm:block">
            {tagline}
          </span>
        )}
      </span>
    </>
  );

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={siteName}
      className={cn(
        "group inline-flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-900",
        className,
      )}
    >
      {content}
    </Link>
  );
}
