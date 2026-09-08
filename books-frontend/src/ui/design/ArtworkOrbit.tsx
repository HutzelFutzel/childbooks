import { Sparkles } from "lucide-react";
import { cn } from "../lib/cn";

/** Compositor-friendly DOM twin of the canvas artwork orbit. */
export function ArtworkOrbit({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative block size-4 shrink-0", className)}>
      <span className="absolute inset-0 animate-spin motion-reduce:animate-none [animation-duration:1.8s]">
        <span className="absolute left-1/2 top-0 size-1 -translate-x-1/2 rounded-full bg-[#D97745]" />
        <span className="absolute bottom-0 right-0 size-1 rounded-full bg-[#B8956A]" />
        <span className="absolute bottom-0 left-0 size-0.5 rounded-full bg-[#7C6CF2]" />
      </span>
      <Sparkles className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 text-[#D97745]" />
    </span>
  );
}
