/**
 * Validation and normalization for admin-uploaded image-shape SVGs.
 *
 * Authors use the intuitive print-mask convention (white keeps, black removes,
 * grey feathers). We compile that luminance mask once into a high-resolution
 * alpha PNG, so Chrome, Safari and Canvas all consume identical pixels while
 * user illustrations remain untouched.
 */
import { JSDOM } from "jsdom";
import sharp from "sharp";

const MAX_BYTES = 512 * 1024;
const MAX_ELEMENTS = 2_000;
const MAX_PATH_DATA = 300_000;
const OUTPUT_SIZE = 4096;
const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "style",
]);

export class ImageMaskValidationError extends Error {}

function invalid(message: string): never {
  throw new ImageMaskValidationError(message);
}

function finiteNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceViewBox(svg: SVGSVGElement): [number, number, number, number] {
  const values = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return values as [number, number, number, number];
  }
  const width = finiteNumber(svg.getAttribute("width"));
  const height = finiteNumber(svg.getAttribute("height"));
  if (width && height && width > 0 && height > 0) return [0, 0, width, height];
  return invalid("The SVG needs a valid viewBox (for example 0 0 1000 1000).");
}

function safeUrlValue(value: string): boolean {
  const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)].map((match) => match[2]);
  return urls.every((url) => url.startsWith("#"));
}

function safeCss(value: string): boolean {
  return (
    !/@import|expression\s*\(|javascript:|https?:|data:|filter\s*:|animation\s*:/i.test(value) &&
    safeUrlValue(value)
  );
}

/**
 * Return a canonical alpha PNG, or throw a plain-language upload error.
 */
export async function compileImageMaskSvg(input: Buffer): Promise<Buffer> {
  if (input.length === 0) invalid("The SVG file is empty.");
  if (input.length > MAX_BYTES) invalid("Image-shape SVGs must be 512 KB or smaller.");

  const source = input.toString("utf8");
  if (!/<svg[\s>]/i.test(source)) invalid("This file is not an SVG.");
  if (/<!doctype|<!entity/i.test(source)) {
    invalid("SVG document types and entities are not supported.");
  }

  let dom: JSDOM;
  try {
    dom = new JSDOM(source, { contentType: "image/svg+xml" });
  } catch {
    return invalid("The SVG could not be parsed.");
  }
  const document = dom.window.document;
  if (document.querySelector("parsererror")) invalid("The SVG contains invalid XML.");
  const root = document.documentElement;
  if (root.localName.toLowerCase() !== "svg") invalid("This file is not an SVG.");

  const viewBox = sourceViewBox(root as unknown as SVGSVGElement);
  const ratio = viewBox[2] / viewBox[3];
  if (ratio < 0.95 || ratio > 1.05) {
    invalid("Upload one square SVG; it will adapt automatically to every image frame.");
  }

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!ALLOWED_ELEMENTS.has(element.localName.toLowerCase())) element.remove();
  }
  for (const style of Array.from(root.querySelectorAll("style"))) {
    const css = style.textContent ?? "";
    if (!safeCss(css)) {
      invalid("The SVG contains external or executable styles.");
    }
  }
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  if (elements.length > MAX_ELEMENTS) {
    invalid(`The SVG is too complex (${elements.length} elements; maximum ${MAX_ELEMENTS}).`);
  }

  let pathDataLength = 0;
  for (const element of elements) {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name === "style") {
        if (!safeCss(value)) {
          invalid("The SVG contains external or executable styles.");
        }
        continue;
      }
      if (
        name.startsWith("on") ||
        name === "filter" ||
        name === "src" ||
        name === "data" ||
        ((name === "href" || name === "xlink:href") && !value.startsWith("#")) ||
        !safeUrlValue(value)
      ) {
        element.removeAttribute(attr.name);
      }
    }
    pathDataLength += element.getAttribute("d")?.length ?? 0;
  }
  if (pathDataLength > MAX_PATH_DATA) {
    invalid("The SVG paths are too complex. Simplify the artwork and try again.");
  }

  try {
    const sanitized = Buffer.from(new dom.window.XMLSerializer().serializeToString(root), "utf8");
    const { data, info } = await sharp(sanitized, { density: 300 })
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let alpha = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const luminance = Math.round(
        data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722,
      );
      const normalizedAlpha = Math.round((luminance * data[i + 3]) / 255);
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = normalizedAlpha;
      alpha += normalizedAlpha;
    }
    const coverage = alpha / ((data.length / info.channels) * 255);
    if (coverage < 0.02) invalid("The mask hides the entire image.");
    if (coverage > 0.995) {
      invalid("The mask is fully opaque. Use white for the image and black outside it.");
    }
    return await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof ImageMaskValidationError) throw error;
    invalid("The SVG uses artwork that the image renderer cannot safely reproduce.");
  }
}
