import type { CSSProperties } from "react";

/** Immutable image-shape id -> resolved URL for one render pass. */
export type ResolvedImageMasks = Record<string, string>;

/**
 * Apply a backend-normalized alpha SVG to the whole image stack. Both standard
 * and WebKit properties are intentional: on-screen Safari and print Chrome
 * must paint the same edge.
 */
export function imageMaskStyle(url: string | undefined): CSSProperties {
  if (!url) return {};
  const image = `url("${url.replaceAll('"', '\\"')}")`;
  return {
    maskImage: image,
    maskMode: "alpha",
    maskPosition: "center",
    maskRepeat: "no-repeat",
    maskSize: "100% 100%",
    WebkitMaskImage: image,
    WebkitMaskPosition: "center",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskSize: "100% 100%",
  };
}
