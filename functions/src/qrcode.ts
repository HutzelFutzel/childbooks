/**
 * Renders one QR code image: our own generator with every knob it exposes
 * wired through, plus an optional center logo composited by `sharp`. No
 * network calls, no third-party QR API — a code baked into a printed book
 * must not depend on some free web service staying up, unbranded, and
 * rate-limit-free forever.
 *
 * Two generators, picked per code:
 *   - The plain classic look (`dotsStyle: "square"`, no corner overrides) is
 *     still rendered by the `qrcode` npm package exactly as before — a code
 *     nobody has ever touched the style controls on renders byte-for-byte as
 *     it always has.
 *   - Anything with rounded/dotted cells or eyes is rendered by
 *     `qr-code-styling`, run server-side against a `jsdom` window (it's a
 *     browser-oriented library; `jsdom` stands in for the DOM it wants to
 *     build the SVG with). We only ever ask it for `type: "svg"` — never
 *     `"canvas"` — so it never touches the `canvas` npm package's native
 *     addon, which we deliberately don't install.
 *
 * Neither generator is asked to composite the logo itself: `qrcode` has no
 * concept of one, and `qr-code-styling`'s own image support goes through
 * jsdom's flaky `Image`/`XMLHttpRequest` loading, which is a known source of
 * blank/broken output in Node. Instead both paths converge on a plain PNG (or
 * SVG, rasterized by `sharp` when a logo is present) and `compositeLogo`
 * stamps the logo on ourselves, below. Two things follow from doing it this
 * way rather than trusting the uploaded image:
 *   - A logo forces PNG output regardless of the requested format: compositing
 *     a bitmap over vector SVG isn't something either generator does for us,
 *     so vector output with a logo just isn't offered.
 *   - A logo forces at least "Q" error correction: standard QR error
 *     correction tolerates a fixed fraction of the code being unreadable, and
 *     "L"/"M" don't leave enough of that budget for a logo-sized hole in the
 *     middle to still scan reliably. "H" (30%) is left alone if requested.
 */
import QRCode from "qrcode";
import sharp from "sharp";
import { JSDOM } from "jsdom";
import { QRCodeStyling } from "qr-code-styling/lib/qr-code-styling.common.js";
import type {
  QrCornerStyle,
  QrDotStyle,
  QrErrorCorrectionLevel,
} from "../../books-frontend/src/core/config/qrCodes";

export interface RenderQrCodeInput {
  data: string;
  format: "svg" | "png";
  errorCorrectionLevel: QrErrorCorrectionLevel;
  /** Quiet-zone size in modules — passed straight through as `margin`. */
  margin: number;
  /** Desired output width in pixels — passed through as the package's `width`. */
  scalePx: number;
  colorDark: string;
  colorLight: string;
  /** QR version 1..40, or undefined/null to auto-select the smallest that fits. */
  version?: number | null;
  /** Mask pattern 0..7, or undefined/null to auto-select the best-scoring one.
   *  Ignored once any styling below takes this to the `qr-code-styling` path —
   *  it doesn't expose a mask-pattern override. */
  maskPattern?: number | null;
  /** Data-module ("cell") shape. `"square"` (with no corner override either)
   *  keeps the original `qrcode`-package render path. */
  dotsStyle: QrDotStyle;
  /** Outer-ring eye shape, or null/undefined to match `dotsStyle`. */
  cornerSquareStyle?: QrCornerStyle | null;
  /** Inner eye-dot shape, or null/undefined to match `dotsStyle`. */
  cornerDotStyle?: QrCornerStyle | null;
  /** Pre-resolved logo bytes to composite over the center, if any. */
  logoBuffer?: Buffer;
  /** Logo width as a fraction of `scalePx`, 0.1..0.3. */
  logoSizePct?: number;
  /** Quiet-ring pad around the logo as a fraction of the logo's width (0..0.35). */
  logoQuietPct?: number;
  /** Quiet-ring fill color (hex). Defaults to white. */
  logoQuietColor?: string;
}

export interface RenderedQrCode {
  buffer: Buffer;
  contentType: string;
  /** What was actually produced — may differ from the request; see above. */
  format: "svg" | "png";
  errorCorrectionLevel: QrErrorCorrectionLevel;
}

/** A logo needs headroom in the error-correction budget "L"/"M" don't have. */
function errorLevelForRender(
  requested: QrErrorCorrectionLevel,
  hasLogo: boolean,
): QrErrorCorrectionLevel {
  if (!hasLogo) return requested;
  return requested === "H" ? "H" : "Q";
}

/** Anything beyond the plain classic look needs `qr-code-styling` instead of `qrcode`. */
function isStyled(input: Pick<RenderQrCodeInput, "dotsStyle" | "cornerSquareStyle" | "cornerDotStyle">): boolean {
  return input.dotsStyle !== "square" || Boolean(input.cornerSquareStyle) || Boolean(input.cornerDotStyle);
}

/** Options shared by every `qrcode`-package output path, mapped 1:1 onto its own. */
function baseOptions(input: RenderQrCodeInput, errorCorrectionLevel: QrErrorCorrectionLevel) {
  const opts: Record<string, unknown> = {
    errorCorrectionLevel,
    margin: input.margin,
    width: input.scalePx,
    color: { dark: input.colorDark, light: input.colorLight },
  };
  if (typeof input.version === "number") opts.version = input.version;
  if (typeof input.maskPattern === "number") opts.maskPattern = input.maskPattern;
  return opts;
}

/** Parse a `#rgb` / `#rrggbb` hex into sharp's `{r,g,b}` (falls back to white). */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.length >= 6
        ? raw.slice(0, 6)
        : "ffffff";
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Square (Chebyshev) dilate of a binary 0/255 mask — separable max filter. */
function dilateSquare(src: Buffer, width: number, height: number, radius: number): Buffer {
  if (radius <= 0) return Buffer.from(src);
  const tmp = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let max = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let i = x0; i <= x1; i++) {
        const v = src[row + i]!;
        if (v > max) max = v;
      }
      tmp[row + x] = max;
    }
  }
  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let max = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let j = y0; j <= y1; j++) {
        const v = tmp[j * width + x]!;
        if (v > max) max = v;
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

/**
 * Composite a logo onto a rendered QR PNG.
 *
 * Under the logo sits a colored "quiet ring" that clears nearby modules so the
 * mark isn't drawn flush onto the code (the usual look from third-party QR
 * generators). The ring follows the logo's alpha silhouette — dilated by a
 * pad — rather than a hard square: a circular mark gets a circular halo;
 * transparent PNG corners stay clear of the ring fill. Modules outside that
 * halo remain visible. Ring color is admin-tunable (defaults to white).
 */
async function compositeLogo(
  basePng: Buffer,
  scalePx: number,
  logoBuffer: Buffer,
  logoSizePct: number,
  logoQuietPct: number,
  logoQuietColor: string,
): Promise<Buffer> {
  const logoWidth = Math.max(1, Math.round(scalePx * logoSizePct));
  // Quiet ring around the mark — free space between logo ink and the nearest
  // modules. Width is admin-tunable (`quietPct` of logo width); 0 = flush.
  const quiet = Math.min(0.35, Math.max(0, logoQuietPct));
  const padding = quiet <= 0 ? 0 : Math.max(2, Math.round(logoWidth * quiet));

  const resizedLogo = await sharp(logoBuffer)
    .resize(logoWidth, logoWidth, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Quiet ring disabled — stamp the logo alone (transparency preserved).
  if (padding === 0) {
    return sharp(basePng).composite([{ input: resizedLogo, gravity: "center" }]).png().toBuffer();
  }

  const { width: lw = logoWidth, height: lh = logoWidth } = await sharp(resizedLogo).metadata();

  // One pixel of headroom so coverage AA at the rim isn't clipped by the canvas.
  const pad = padding + 1;

  // Extra canvas so the dilated plate can grow past the mark without clipping.
  // The logo itself stays centered inside that pad (transparent around it).
  const logoPadded = await sharp(resizedLogo)
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const plateW = lw + pad * 2;
  const plateH = lh + pad * 2;

  // Build the quiet plate from the logo alpha silhouette:
  // 1) hard-threshold at 2×, 2) square-dilate by quiet padding, 3) box-average
  // back to 1× for coverage AA. No Gaussian blur — large blur was washing the
  // mask out (and looking soft); this keeps a crisp rim with real AA.
  const ss = 2;
  const hiW = plateW * ss;
  const hiH = plateH * ss;
  const hiPad = padding * ss;

  const hiAlpha = await sharp(logoPadded)
    .extractChannel("alpha")
    .resize(hiW, hiH, { kernel: "nearest" })
    .threshold(16)
    .raw()
    .toBuffer();

  const hiMask = dilateSquare(hiAlpha, hiW, hiH, hiPad);

  const plateMask = Buffer.alloc(plateW * plateH);
  const cell = ss * ss;
  for (let y = 0; y < plateH; y++) {
    for (let x = 0; x < plateW; x++) {
      let sum = 0;
      const y0 = y * ss;
      const x0 = x * ss;
      for (let dy = 0; dy < ss; dy++) {
        const row = (y0 + dy) * hiW + x0;
        for (let dx = 0; dx < ss; dx++) sum += hiMask[row + dx]!;
      }
      plateMask[y * plateW + x] = Math.round(sum / cell);
    }
  }

  const plate = await sharp({
    create: {
      width: plateW,
      height: plateH,
      channels: 3,
      background: hexToRgb(logoQuietColor),
    },
  })
    .joinChannel(plateMask, { raw: { width: plateW, height: plateH, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(basePng)
    .composite([
      { input: plate, gravity: "center" },
      { input: logoPadded, gravity: "center" },
    ])
    .png()
    .toBuffer();
}

/**
 * `qr-code-styling`'s `margin` is raw pixels around the code, but our stored
 * `margin` (like the `qrcode` package's own option of the same name) is in
 * modules — the quiet-zone unit the QR spec actually defines. Converting
 * exactly (rather than guessing a proportion) means the two generators lay
 * out the same requested quiet zone the same way: encode with `qrcode`'s own
 * (synchronous, render-free) `QRCode.create` first purely to learn the
 * resulting module count for these exact data + error-correction + version
 * settings, then scale `margin` modules into pixels of `scalePx`.
 */
function stylingMarginPx(input: Pick<RenderQrCodeInput, "data" | "errorCorrectionLevel" | "version" | "margin" | "scalePx">): number {
  try {
    const qr = QRCode.create(input.data, {
      errorCorrectionLevel: input.errorCorrectionLevel,
      version: typeof input.version === "number" ? input.version : undefined,
    });
    const moduleCount = qr.modules.size;
    const moduleSizePx = input.scalePx / (moduleCount + input.margin * 2);
    return Math.max(0, Math.round(input.margin * moduleSizePx));
  } catch {
    // Same data will fail identically for the real render below, which throws
    // a clearer error — this fallback just keeps a reasonable-looking margin
    // if that somehow doesn't happen first.
    return Math.round(input.scalePx * 0.08);
  }
}

/** Render the styled SVG body (no logo — see the file doc comment for why). */
async function renderStyledSvg(input: RenderQrCodeInput): Promise<Buffer> {
  const margin = stylingMarginPx(input);
  const qr = new QRCodeStyling({
    type: "svg",
    jsdom: JSDOM,
    width: input.scalePx,
    height: input.scalePx,
    margin,
    data: input.data,
    qrOptions: {
      typeNumber: typeof input.version === "number" ? input.version : 0,
      errorCorrectionLevel: input.errorCorrectionLevel,
    },
    dotsOptions: { type: input.dotsStyle, color: input.colorDark },
    ...(input.cornerSquareStyle
      ? { cornersSquareOptions: { type: input.cornerSquareStyle, color: input.colorDark } }
      : {}),
    ...(input.cornerDotStyle
      ? { cornersDotOptions: { type: input.cornerDotStyle, color: input.colorDark } }
      : {}),
    backgroundOptions: { color: input.colorLight },
  });
  const raw = await qr.getRawData("svg");
  if (!raw || !Buffer.isBuffer(raw)) throw new Error("Could not render the styled QR code.");
  return raw;
}

export async function renderQrCode(input: RenderQrCodeInput): Promise<RenderedQrCode> {
  if (!input.data.trim()) throw new Error("There's nothing to encode.");

  const hasLogo = Boolean(input.logoBuffer);
  const format: "svg" | "png" = hasLogo ? "png" : input.format;
  const errorCorrectionLevel = errorLevelForRender(input.errorCorrectionLevel, hasLogo);

  if (isStyled(input)) {
    const svg = await renderStyledSvg({ ...input, errorCorrectionLevel });
    if (format === "svg") {
      return { buffer: svg, contentType: "image/svg+xml", format: "svg", errorCorrectionLevel };
    }
    const png = await sharp(svg).png().toBuffer();
    if (!hasLogo || !input.logoBuffer) {
      return { buffer: png, contentType: "image/png", format: "png", errorCorrectionLevel };
    }
    const composited = await compositeLogo(
      png,
      input.scalePx,
      input.logoBuffer,
      input.logoSizePct ?? 0.2,
      input.logoQuietPct ?? 0.22,
      input.logoQuietColor ?? "#ffffff",
    );
    return { buffer: composited, contentType: "image/png", format: "png", errorCorrectionLevel };
  }

  const options = baseOptions(input, errorCorrectionLevel);

  if (format === "svg") {
    const svg = await QRCode.toString(input.data, { ...options, type: "svg" });
    return {
      buffer: Buffer.from(svg, "utf8"),
      contentType: "image/svg+xml",
      format: "svg",
      errorCorrectionLevel,
    };
  }

  const qrPng = (await QRCode.toBuffer(input.data, { ...options, type: "png" })) as Buffer;
  if (!hasLogo || !input.logoBuffer) {
    return { buffer: qrPng, contentType: "image/png", format: "png", errorCorrectionLevel };
  }

  const composited = await compositeLogo(
    qrPng,
    input.scalePx,
    input.logoBuffer,
    input.logoSizePct ?? 0.2,
    input.logoQuietPct ?? 0.22,
    input.logoQuietColor ?? "#ffffff",
  );
  return { buffer: composited, contentType: "image/png", format: "png", errorCorrectionLevel };
}
