/**
 * Admin-managed **QR code library** (`appConfig/qrCodes`).
 *
 * A named, reusable set of QR codes the admin builds once in
 * Marketing → QR codes, and any feature can then point at by id (e.g. a
 * back-cover branding block, a marketing page, an order insert). Every code is
 * rendered by our OWN generator — the `qrcode` npm package for the plain
 * classic look, `qr-code-styling` (server-side, via `jsdom`) for anything
 * with rounded/dotted cells or eyes — run server-side, no third-party QR API
 * at read time, so a code baked into a printed book never breaks because some
 * free web service rate-limited, re-branded, or vanished.
 *
 * A center logo (own upload, or a copy of an existing brand asset) is
 * optional and composited over the rendered PNG by `sharp`; see
 * `functions/src/qrcode.ts` for the actual rendering, and `renderQrCode`'s
 * doc comment for why a logo forces PNG output and a higher error-correction
 * level regardless of what was requested.
 *
 * Stored at the world-readable `appConfig/qrCodes` doc; every rendered image
 * (and the logo source it was composited from) lives in public storage under
 * `public/qrcodes/{id}/...` (see `uploadQrCode`/`uploadQrLogo` in
 * `functions/src/storage.ts`).
 */
import type { BrandAssetSlot } from "./branding";
import { MAX_ASSET_HISTORY } from "./branding";

/** Mirrors the `qrcode` package's `errorCorrectionLevel` option exactly. */
export const QR_ERROR_CORRECTION_LEVELS = ["L", "M", "Q", "H"] as const;
export type QrErrorCorrectionLevel = (typeof QR_ERROR_CORRECTION_LEVELS)[number];

export const QR_FORMATS = ["svg", "png"] as const;
export type QrFormat = (typeof QR_FORMATS)[number];

/**
 * Cell (data-module) shape, straight from the `qr-code-styling` npm package's
 * own `dotsOptions.type` — see `functions/src/qrcode.ts`. `"square"` is the
 * plain classic look and is the only style still rendered by the original
 * `qrcode` package rather than `qr-code-styling`, so a code nobody has ever
 * touched these controls on renders byte-for-byte as it always has.
 */
export const QR_DOT_STYLES = ["square", "dots", "rounded", "classy", "classy-rounded", "extra-rounded"] as const;
export type QrDotStyle = (typeof QR_DOT_STYLES)[number];

/**
 * Corner ("eye") shape — the three big squares that give a scanner its
 * orientation. Shared allowed-value set for both the outer ring
 * (`cornerSquareStyle`) and the inner dot (`cornerDotStyle`); `null` for
 * either means "match `dotsStyle`", `qr-code-styling`'s own default.
 */
export const QR_CORNER_STYLES = [
  "square",
  "dot",
  "dots",
  "rounded",
  "extra-rounded",
  "classy",
  "classy-rounded",
] as const;
export type QrCornerStyle = (typeof QR_CORNER_STYLES)[number];

/** A rendered QR image — the current one, or one entry in its history. */
export interface QrRender {
  /** Public URL of the file. */
  imageUrl: string;
  /** Storage path, so the backend can delete/replace it. */
  storagePath: string;
  updatedAt: number;
}

/** Where the center logo comes from, and the resolved copy actually composited. */
export interface QrLogo {
  source: "upload" | "brandingAsset";
  /** When `source` is "brandingAsset": which slot of `BrandingConfig` it was
   *  copied from (display-only — the copy below is what's actually used, so a
   *  later change to that brand asset doesn't retroactively change this code). */
  brandingSlot?: BrandAssetSlot;
  /** The resolved source logo image (own upload, or the branding-asset copy). */
  asset: QrRender;
  /** Logo width as a fraction of the QR code's own width, clamped 0.1..0.3. */
  sizePct: number;
  /** Quiet-ring width around the logo, as a fraction of the logo's own width.
   *  Clears nearby modules without using a hard square plate. 0 = flush. */
  quietPct: number;
  /** Fill color of the quiet ring (usually matches the QR background). */
  quietColor: string;
}

/** Default quiet-ring fill — matches a typical light QR background. */
export const QR_LOGO_QUIET_COLOR_DEFAULT = "#ffffff";

export interface QrCode {
  id: string;
  /** Admin label, e.g. "Back cover CTA". */
  name: string;
  /** The URL or text actually encoded. */
  data: string;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  /** Quiet-zone size, in modules (the package's own unit). */
  margin: number;
  /** Output width, in pixels (maps to the package's `width` option). */
  scalePx: number;
  colorDark: string;
  colorLight: string;
  /** Requested output format. A logo always renders as PNG regardless — see
   *  `functions/src/qrcode.ts` — so this may not match `rendered`'s actual file. */
  format: QrFormat;
  /** QR version 1..40, or null to let the package pick the smallest that fits. */
  version: number | null;
  /** Mask pattern 0..7, or null to let the package pick the best-scoring one.
   *  Only honored on the plain (all-`"square"`) render path — `qr-code-styling`
   *  doesn't expose a mask-pattern override, so this is ignored once any
   *  styling below is turned on. */
  maskPattern: number | null;
  /** Data-module ("cell") shape. `"square"` keeps the original `qrcode`-package
   *  render path; anything else switches to `qr-code-styling`. */
  dotsStyle: QrDotStyle;
  /** Outer-ring eye shape, or null to match `dotsStyle`. */
  cornerSquareStyle: QrCornerStyle | null;
  /** Inner eye-dot shape, or null to match `dotsStyle`. */
  cornerDotStyle: QrCornerStyle | null;
  logo: QrLogo | null;
  rendered: QrRender | null;
  /** Previous renders, newest first — nothing is deleted from storage on replace. */
  history: QrRender[];
  createdAt: number;
  updatedAt: number;
}

export interface QrCodesConfig {
  version: 1;
  codes: QrCode[];
}

/** Hard cap on the library so a runaway script can't grow the doc unbounded. */
export const MAX_QR_CODES = 200;

export const QR_MARGIN_MIN = 0;
export const QR_MARGIN_MAX = 20;
export const QR_SCALE_MIN_PX = 128;
export const QR_SCALE_MAX_PX = 2048;
export const QR_LOGO_SIZE_MIN = 0.1;
export const QR_LOGO_SIZE_MAX = 0.3;
/** Quiet-ring pad around the logo, as a fraction of the logo's width. */
export const QR_LOGO_QUIET_MIN = 0;
export const QR_LOGO_QUIET_MAX = 0.35;
export const QR_LOGO_QUIET_DEFAULT = 0.22;
export const QR_VERSION_MIN = 1;
export const QR_VERSION_MAX = 40;
export const QR_MASK_PATTERN_MIN = 0;
export const QR_MASK_PATTERN_MAX = 7;

export function createDefaultQrCodesConfig(): QrCodesConfig {
  return { version: 1, codes: [] };
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** A nullable clamped int — out-of-range or missing both mean "let the package decide". */
function nullableInt(n: unknown, min: number, max: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = Math.round(n);
  return v < min || v > max ? null : v;
}

function str(v: unknown, fallback: string, max = 2000): string {
  return typeof v === "string" ? v.slice(0, max) : fallback;
}

// Up to 8 hex digits so a fully transparent background (`#ffffff00`) is valid —
// handy for a QR meant to sit on top of an illustrated back cover.
function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

/** A nullable value drawn from a fixed set — out-of-set means "unset". */
function nullableEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function normalizeRender(input: unknown): QrRender | null {
  const r = input as Partial<QrRender> | null | undefined;
  if (!r || typeof r.imageUrl !== "string" || !r.imageUrl) return null;
  if (typeof r.storagePath !== "string" || !r.storagePath) return null;
  return {
    imageUrl: r.imageUrl,
    storagePath: r.storagePath,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
  };
}

/** Drop invalid/duplicate (by storagePath) entries, cap length. */
function normalizeRenderList(input: unknown): QrRender[] {
  if (!Array.isArray(input)) return [];
  const out: QrRender[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    const r = normalizeRender(item);
    if (!r || seen.has(r.storagePath)) continue;
    seen.add(r.storagePath);
    out.push(r);
    if (out.length >= MAX_ASSET_HISTORY) break;
  }
  return out;
}

function normalizeLogo(input: unknown): QrLogo | null {
  const l = input as Partial<QrLogo> | null | undefined;
  if (!l) return null;
  const asset = normalizeRender(l.asset);
  if (!asset) return null;
  const source: QrLogo["source"] = l.source === "brandingAsset" ? "brandingAsset" : "upload";
  const logo: QrLogo = {
    source,
    asset,
    sizePct: clamp(l.sizePct, QR_LOGO_SIZE_MIN, QR_LOGO_SIZE_MAX, 0.2),
    quietPct: clamp(l.quietPct, QR_LOGO_QUIET_MIN, QR_LOGO_QUIET_MAX, QR_LOGO_QUIET_DEFAULT),
    quietColor: hex(l.quietColor, QR_LOGO_QUIET_COLOR_DEFAULT),
  };
  if (source === "brandingAsset" && typeof l.brandingSlot === "string" && l.brandingSlot) {
    logo.brandingSlot = l.brandingSlot as BrandAssetSlot;
  }
  return logo;
}

function normalizeQrCode(input: unknown, fallbackId: () => string): QrCode | null {
  const c = input as Partial<QrCode> | null | undefined;
  if (!c) return null;
  // A code with nothing to encode isn't a code — drop it rather than keep a
  // dead entry the admin can never usefully render.
  const data = str(c.data, "", 2000);
  if (!data) return null;
  return {
    id: typeof c.id === "string" && c.id ? c.id : fallbackId(),
    name: str(c.name, "Untitled QR code", 200),
    data,
    errorCorrectionLevel: (QR_ERROR_CORRECTION_LEVELS as readonly string[]).includes(
      c.errorCorrectionLevel as string,
    )
      ? (c.errorCorrectionLevel as QrErrorCorrectionLevel)
      : "M",
    margin: clampInt(c.margin, QR_MARGIN_MIN, QR_MARGIN_MAX, 4),
    scalePx: clampInt(c.scalePx, QR_SCALE_MIN_PX, QR_SCALE_MAX_PX, 512),
    colorDark: hex(c.colorDark, "#000000"),
    colorLight: hex(c.colorLight, "#ffffff"),
    format: c.format === "svg" ? "svg" : "png",
    version: nullableInt(c.version, QR_VERSION_MIN, QR_VERSION_MAX),
    maskPattern: nullableInt(c.maskPattern, QR_MASK_PATTERN_MIN, QR_MASK_PATTERN_MAX),
    dotsStyle: nullableEnum(c.dotsStyle, QR_DOT_STYLES) ?? "square",
    cornerSquareStyle: nullableEnum(c.cornerSquareStyle, QR_CORNER_STYLES),
    cornerDotStyle: nullableEnum(c.cornerDotStyle, QR_CORNER_STYLES),
    logo: normalizeLogo(c.logo),
    rendered: normalizeRender(c.rendered),
    history: normalizeRenderList(c.history),
    createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
    updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
  };
}

let fallbackCounter = 0;
/** Stand-in id for a malformed/legacy entry missing its own — collisions with
 *  a real id are astronomically unlikely, and normalize de-dupes regardless. */
function fallbackId(): string {
  fallbackCounter += 1;
  return `qr_legacy_${Date.now()}_${fallbackCounter}`;
}

export function normalizeQrCodesConfig(input: unknown): QrCodesConfig {
  const out = createDefaultQrCodesConfig();
  if (!input || typeof input !== "object") return out;
  const list = (input as Partial<QrCodesConfig>).codes;
  if (!Array.isArray(list)) return out;
  const seen = new Set<string>();
  for (const item of list) {
    const code = normalizeQrCode(item, fallbackId);
    if (!code || seen.has(code.id)) continue;
    seen.add(code.id);
    out.codes.push(code);
    if (out.codes.length >= MAX_QR_CODES) break;
  }
  return out;
}

export function findQrCode(config: QrCodesConfig, id: string): QrCode | undefined {
  return config.codes.find((c) => c.id === id);
}
