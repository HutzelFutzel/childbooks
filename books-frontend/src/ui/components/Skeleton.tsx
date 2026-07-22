import { cn } from "../lib/cn";

export interface SkeletonProps {
  className?: string;
  /** Rounded pill vs. the default rounded-lg block. */
  rounded?: "lg" | "xl" | "2xl" | "full";
}

/**
 * A shimmering placeholder block. Uses the `.shimmer` utility (brand-tinted
 * sweep, disabled under prefers-reduced-motion). Compose several to skeleton a
 * layout, or wrap a fixed aspect box for image placeholders.
 */
export function Skeleton({ className, rounded = "xl" }: SkeletonProps) {
  const radius =
    rounded === "full"
      ? "rounded-full"
      : rounded === "2xl"
        ? "rounded-2xl"
        : rounded === "xl"
          ? "rounded-xl"
          : "rounded-lg";
  return <div className={cn("shimmer", radius, className)} aria-hidden />;
}
