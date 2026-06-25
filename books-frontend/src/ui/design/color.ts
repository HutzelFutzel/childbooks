export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Parse a CSS color string (hex, rgb, rgba) into RGBA. Falls back to black. */
export function parseColor(input: string | undefined): RGBA {
  const fallback: RGBA = { r: 0, g: 0, b: 0, a: 1 };
  if (!input) return fallback;
  const s = input.trim();
  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 4) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb = s.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    return {
      r: clamp(parseFloat(parts[0]) || 0, 0, 255),
      g: clamp(parseFloat(parts[1]) || 0, 0, 255),
      b: clamp(parseFloat(parts[2]) || 0, 0, 255),
      a: parts[3] !== undefined ? clamp(parseFloat(parts[3]), 0, 1) : 1,
    };
  }
  return fallback;
}

export function toRgbaString({ r, g, b, a }: RGBA): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(a.toFixed(3))})`;
}

export function toHex({ r, g, b }: RGBA): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
