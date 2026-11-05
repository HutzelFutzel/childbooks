/**
 * Where the book's look shows up on a page's own controls.
 *
 * The look belongs to the whole book: it is chosen once, and no page can have
 * a different one. These two pieces say so wherever a page is described, so
 * nobody wonders why "make this page watercolor" does nothing, and nobody
 * finds out by getting a picture in a different style.
 */
import { Lock } from "lucide-react";
import { resolveArtStyleDisplayName } from "../../core/prompts/style";
import { styleRequestIn } from "../../core/book/styleRequest";
import type { Project } from "../../core/types";
import { useAppConfigStore } from "../../state/appConfigStore";
import { cn } from "../lib/cn";

/** The book's look as a name a reader would use. */
export function useBookStyleName(project: Pick<Project, "config">): string {
  const artStyles = useAppConfigStore((s) => s.artStyles);
  return resolveArtStyleDisplayName(project.config.artStyle, artStyles);
}

/** A small label with the look this page will be drawn in. It is not a control. */
export function StyleLockBadge({
  project,
  className,
}: {
  project: Pick<Project, "config">;
  className?: string;
}) {
  const name = useBookStyleName(project);
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-600 ring-1 ring-inset ring-ink-200",
        className,
      )}
      title="Every page is drawn in the book's look. Change it for the whole book from the Style step before drawing starts."
    >
      <Lock className="size-3 shrink-0 text-ink-400" aria-hidden />
      <span className="truncate">Book look: {name}</span>
    </span>
  );
}

/**
 * The line under a description field. It always says the look is the book's;
 * when what was typed asks for another one, it says that part will be left out,
 * before the reader draws, not after.
 */
export function StyleLockNote({
  project,
  text,
  className,
}: {
  project: Pick<Project, "config">;
  /** What the reader has typed in the field, as it stands. */
  text: string;
  className?: string;
}) {
  const name = useBookStyleName(project);
  const asked = text.trim() ? styleRequestIn(text).phrases.length > 0 : false;
  return (
    <p
      className={cn(
        "text-[11px] leading-snug",
        asked ? "rounded-md bg-amber-50 px-2 py-1 text-amber-800 ring-1 ring-inset ring-amber-200" : "text-ink-400",
        className,
      )}
      role={asked ? "status" : undefined}
    >
      {asked
        ? `The whole book keeps one look (${name}), so the style part is left out and the rest is kept.`
        : `Drawn in the book's look (${name}), the same on every page.`}
    </p>
  );
}
