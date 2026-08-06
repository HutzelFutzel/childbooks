/**
 * Minimal ambient typing for the ONE entry point of `qr-code-styling` we
 * actually use at runtime: its plain-CommonJS Node build.
 *
 * Deliberately not importing anything from the package's own shipped types
 * (`qr-code-styling` → `lib/index.d.ts` → `lib/types/index.d.ts`) — that file
 * unconditionally does `import nodeCanvas from "canvas"`, and we never
 * install the `canvas` npm package (its native build is unnecessary weight
 * and deploy risk for a code path that only ever asks this library for SVG,
 * never `type: "canvas"`). Importing its types would drag that resolution
 * in; this shim describes only what `functions/src/qrcode.ts` touches.
 */
declare module "qr-code-styling/lib/qr-code-styling.common.js" {
  export interface QrStylingGradientStop {
    offset: number;
    color: string;
  }

  export interface QrStylingGradient {
    type: "linear" | "radial";
    rotation?: number;
    colorStops: QrStylingGradientStop[];
  }

  export interface QrStylingShapeOptions {
    type?: string;
    color?: string;
    gradient?: QrStylingGradient;
  }

  export interface QrStylingOptions {
    /** We only ever request "svg" — see the doc comment above. */
    type?: "svg" | "canvas";
    width?: number;
    height?: number;
    /** In raw pixels (NOT modules) — see `stylingMarginPx` in `qrcode.ts`. */
    margin?: number;
    data?: string;
    /** The `JSDOM` class itself (not an instance) — the library constructs
     *  its own `new jsdom("", { resources: "usable" }).window` internally,
     *  lazily, only once a QR is actually rendered. */
    jsdom?: unknown;
    qrOptions?: {
      /** 0 = auto-select the smallest version that fits, 1..40 = fixed. */
      typeNumber?: number;
      errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    };
    dotsOptions?: QrStylingShapeOptions & { roundSize?: boolean };
    cornersSquareOptions?: QrStylingShapeOptions;
    cornersDotOptions?: QrStylingShapeOptions;
    backgroundOptions?: { color?: string; gradient?: QrStylingGradient };
  }

  export class QRCodeStyling {
    constructor(options?: QrStylingOptions);
    getRawData(extension?: "svg" | "png"): Promise<Buffer | Blob | null>;
  }
}
