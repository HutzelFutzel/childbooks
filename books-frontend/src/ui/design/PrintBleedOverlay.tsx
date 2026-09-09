import { useState, type CSSProperties } from "react";
import { Tooltip } from "../components/Tooltip";

type BleedSides = { top: boolean; right: boolean; bottom: boolean; left: boolean };

function formatBleedInches(sizeIn: number): string {
  const rounded = Math.round(sizeIn * 1000) / 1000;
  return `${rounded}″`;
}

function bleedTooltip(sizeIn: number, cover: boolean): string {
  const size = formatBleedInches(sizeIn);
  if (cover) {
    return `Print bleed — this ${size} edge is trimmed off the cover. Keep faces and titles on the page. The spine has no bleed.`;
  }
  return `Print bleed — this ${size} edge is trimmed off. Keep faces and titles inside the cut line.`;
}

/**
 * Hatched print-bleed ring around trim. Hovering a strip highlights it and
 * explains what will be cut away. Cover panels omit the spine edge.
 */
export function PrintBleedOverlay({
  W,
  H,
  bleedX,
  bleedY,
  sides,
  sizeIn,
}: {
  W: number;
  H: number;
  bleedX: number;
  bleedY: number;
  sides: BleedSides;
  sizeIn: number;
}) {
  const [hot, setHot] = useState(false);
  const cover = sides.left !== sides.right;
  const copy = bleedTooltip(sizeIn, cover);
  const left = sides.left ? bleedX : 0;
  const right = sides.right ? bleedX : 0;
  const top = sides.top ? bleedY : 0;
  const bottom = sides.bottom ? bleedY : 0;

  const strips: { id: string; style: CSSProperties }[] = [];
  if (sides.top) {
    strips.push({
      id: "top",
      style: { left: -left, top: -bleedY, width: W + left + right, height: bleedY },
    });
  }
  if (sides.bottom) {
    strips.push({
      id: "bottom",
      style: { left: -left, top: H, width: W + left + right, height: bleedY },
    });
  }
  if (sides.left) {
    strips.push({
      id: "left",
      style: { left: -bleedX, top: 0, width: bleedX, height: H },
    });
  }
  if (sides.right) {
    strips.push({
      id: "right",
      style: { left: W, top: 0, width: bleedX, height: H },
    });
  }

  return (
    <>
      <div
        data-print-bleed=""
        aria-hidden="true"
        className="pointer-events-none absolute z-0"
        style={{
          left: -left,
          top: -top,
          width: W + left + right,
          height: H + top + bottom,
          background: hot
            ? "repeating-linear-gradient(135deg, rgba(8,145,178,0.34) 0 5px, rgba(8,145,178,0.12) 5px 10px)"
            : "repeating-linear-gradient(135deg, rgba(8,145,178,0.17) 0 5px, rgba(8,145,178,0.06) 5px 10px)",
          boxShadow: hot ? "0 0 0 1px rgba(8,145,178,0.72)" : "0 0 0 1px rgba(8,145,178,0.42)",
        }}
      />
      {strips.map((strip) => (
        <div key={strip.id} className="absolute z-5" style={strip.style}>
          <Tooltip className="flex size-full" content={copy} delayMs={140} side="top">
            <button
              type="button"
              tabIndex={-1}
              aria-label={copy}
              className="block size-full cursor-help"
              onMouseEnter={() => setHot(true)}
              onMouseLeave={() => setHot(false)}
              onFocus={() => setHot(true)}
              onBlur={() => setHot(false)}
            />
          </Tooltip>
        </div>
      ))}
    </>
  );
}
