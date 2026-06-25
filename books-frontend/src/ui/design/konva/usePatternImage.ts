import { useEffect, useState } from "react";
import type { PatternConfig } from "../../../core/types";
import { getPattern } from "../patterns";

/**
 * Rasterize one pattern tile (motif + background) into an image that Konva can
 * tile via `fillPatternImage`. The motif's `currentColor` is resolved to the
 * configured foreground color. Scale/rotation/opacity are applied by the
 * consumer through Konva's `fillPattern*` props so the tile stays crisp.
 */
export function usePatternImage(
  config: PatternConfig | undefined,
): { image: HTMLImageElement; tile: number } | null {
  const [result, setResult] = useState<{ image: HTMLImageElement; tile: number } | null>(null);

  const def = config ? getPattern(config.patternId) : undefined;
  const color = config?.color;
  const background = config?.background;

  useEffect(() => {
    if (!config || !def) {
      setResult(null);
      return;
    }
    const tile = def.tile;
    const bg =
      background && background !== "transparent"
        ? `<rect width="${tile}" height="${tile}" fill="${background}"/>`
        : "";
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">` +
      bg +
      `<g style="color:${color}">${def.motif(tile)}</g>` +
      `</svg>`;
    const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setResult({ image: img, tile });
    };
    img.onerror = () => {
      if (active) setResult(null);
    };
    img.src = url;
    return () => {
      active = false;
    };
  }, [config, def, color, background]);

  return result;
}
