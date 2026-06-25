import { useId } from "react";
import type { PatternConfig } from "../../core/types";

export interface PatternDef {
  id: string;
  label: string;
  /** Base tile size in px (before scale). */
  tile: number;
  /** SVG markup for the motif inside one tile, using `currentColor`. */
  motif: (tile: number) => string;
}

/** 15 procedural, tileable patterns. Motifs use currentColor for theming. */
export const PATTERNS: PatternDef[] = [
  { id: "dots", label: "Dots", tile: 24, motif: (t) => `<circle cx="${t / 2}" cy="${t / 2}" r="${t * 0.14}" fill="currentColor"/>` },
  { id: "grid", label: "Grid", tile: 24, motif: (t) => `<path d="M0 0H${t}M0 0V${t}" stroke="currentColor" stroke-width="1.5" fill="none"/>` },
  { id: "stripes", label: "Stripes", tile: 20, motif: (t) => `<rect x="0" y="0" width="${t / 2}" height="${t}" fill="currentColor"/>` },
  { id: "diagonal", label: "Diagonal", tile: 16, motif: (t) => `<path d="M-2 2L2 -2M0 ${t}L${t} 0M${t - 2} ${t + 2}L${t + 2} ${t - 2}" stroke="currentColor" stroke-width="3" fill="none"/>` },
  { id: "chevron", label: "Chevron", tile: 24, motif: (t) => `<path d="M0 ${t * 0.6}L${t / 2} ${t * 0.2}L${t} ${t * 0.6}" stroke="currentColor" stroke-width="3" fill="none"/>` },
  { id: "zigzag", label: "Zigzag", tile: 24, motif: (t) => `<path d="M0 ${t * 0.7}L${t / 4} ${t * 0.3}L${t / 2} ${t * 0.7}L${(t * 3) / 4} ${t * 0.3}L${t} ${t * 0.7}" stroke="currentColor" stroke-width="2.5" fill="none"/>` },
  { id: "triangles", label: "Triangles", tile: 24, motif: (t) => `<path d="M${t / 2} ${t * 0.2}L${t * 0.8} ${t * 0.8}L${t * 0.2} ${t * 0.8}Z" fill="currentColor"/>` },
  { id: "scallop", label: "Scallop", tile: 28, motif: (t) => `<path d="M0 ${t} A${t / 2} ${t / 2} 0 0 1 ${t} ${t}" fill="currentColor"/>` },
  { id: "waves", label: "Waves", tile: 32, motif: (t) => `<path d="M0 ${t / 2} Q${t / 4} ${t * 0.2} ${t / 2} ${t / 2} T${t} ${t / 2}" stroke="currentColor" stroke-width="2.5" fill="none"/>` },
  { id: "stars", label: "Stars", tile: 28, motif: (t) => star(t / 2, t / 2, t * 0.22, t * 0.1) },
  { id: "hearts", label: "Hearts", tile: 26, motif: (t) => heart(t) },
  { id: "crosshatch", label: "Crosshatch", tile: 16, motif: (t) => `<path d="M0 0L${t} ${t}M${t} 0L0 ${t}" stroke="currentColor" stroke-width="1.2" fill="none"/>` },
  { id: "confetti", label: "Confetti", tile: 32, motif: (t) => `<rect x="${t * 0.1}" y="${t * 0.2}" width="4" height="4" fill="currentColor" transform="rotate(20 ${t * 0.1} ${t * 0.2})"/><rect x="${t * 0.6}" y="${t * 0.55}" width="4" height="4" fill="currentColor" transform="rotate(-30 ${t * 0.6} ${t * 0.55})"/><circle cx="${t * 0.8}" cy="${t * 0.2}" r="2.4" fill="currentColor"/>` },
  { id: "circles", label: "Rings", tile: 28, motif: (t) => `<circle cx="${t / 2}" cy="${t / 2}" r="${t * 0.3}" stroke="currentColor" stroke-width="2" fill="none"/>` },
  { id: "checkers", label: "Checkers", tile: 24, motif: (t) => `<rect x="0" y="0" width="${t / 2}" height="${t / 2}" fill="currentColor"/><rect x="${t / 2}" y="${t / 2}" width="${t / 2}" height="${t / 2}" fill="currentColor"/>` },
];

function star(cx: number, cy: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    d += `${i === 0 ? "M" : "L"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  }
  return `<path d="${d}Z" fill="currentColor"/>`;
}

function heart(t: number): string {
  const s = t * 0.42;
  const cx = t / 2;
  const cy = t * 0.42;
  return `<path d="M${cx} ${cy + s * 0.7} C${cx} ${cy} ${cx - s} ${cy - s * 0.3} ${cx - s} ${cy - s * 0.7} C${cx - s} ${cy - s} ${cx} ${cy - s} ${cx} ${cy - s * 0.4} C${cx} ${cy - s} ${cx + s} ${cy - s} ${cx + s} ${cy - s * 0.7} C${cx + s} ${cy - s * 0.3} ${cx} ${cy} ${cx} ${cy + s * 0.7}Z" fill="currentColor"/>`;
}

export function getPattern(id: string): PatternDef | undefined {
  return PATTERNS.find((p) => p.id === id);
}

export function defaultPatternConfig(patternId: string): PatternConfig {
  return {
    patternId,
    color: "rgba(99, 102, 241, 0.5)",
    background: "rgba(255, 255, 255, 1)",
    scale: 1,
    rotation: 0,
    opacity: 1,
  };
}

/** Renders a tiling pattern as an absolutely-positioned SVG filling its parent. */
export function PatternFill({ config }: { config: PatternConfig }) {
  const uid = useId().replace(/:/g, "");
  const def = getPattern(config.patternId);
  if (!def) return null;
  const tile = def.tile * (config.scale || 1);

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      style={{ opacity: config.opacity }}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <pattern
          id={`pat-${uid}`}
          width={tile}
          height={tile}
          patternUnits="userSpaceOnUse"
          patternTransform={`rotate(${config.rotation || 0})`}
        >
          <g
            style={{ color: config.color }}
            dangerouslySetInnerHTML={{ __html: def.motif(def.tile * (config.scale || 1)) }}
          />
        </pattern>
      </defs>
      {config.background && config.background !== "transparent" && (
        <rect width="100%" height="100%" fill={config.background} />
      )}
      <rect width="100%" height="100%" fill={`url(#pat-${uid})`} />
    </svg>
  );
}
