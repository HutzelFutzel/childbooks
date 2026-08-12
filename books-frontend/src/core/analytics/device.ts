/**
 * Coarse, privacy-preserving device classification — shared by the client and
 * the backend so a device is named the same thing everywhere.
 *
 * WHAT IS COLLECTED, AND WHY IT NEEDS NO COOKIE BANNER
 * ----------------------------------------------------
 * Everything here is derived from signals the browser volunteers with the
 * request it was already making: the `User-Agent` header and the low-entropy
 * client hints (`Sec-CH-UA*`) Chromium sends by default. Reading those is not
 * "storing or accessing information on the terminal equipment" (ePrivacy Art
 * 5(3)) — nothing is written to the device and nothing is asked of it — so the
 * consent gate that fronts GA4 (see `ui/consent/`) doesn't apply. It IS personal
 * data once attached to a uid, which is why it stays coarse, aggregate and
 * disclosed rather than unconsented-but-precise.
 *
 * The rules that keep it that way, and that any change here must preserve:
 *   1. NEVER request high-entropy hints (`getHighEntropyValues`, device model,
 *      architecture, full version lists). Actively interrogating the device is
 *      fingerprinting, and fingerprinting needs consent.
 *   2. NEVER combine these facts with an IP into a persistent identifier. The
 *      moment the tuple can single someone out across sessions it stops being a
 *      dimension and starts being a tracker.
 *   3. Keep every field LOW-CARDINALITY (families, and major versions only).
 *      That's a privacy property before it's a storage one: a full version
 *      string plus an OS plus a viewport is most of a fingerprint on its own.
 *
 * {@link ViewportBucket} is the one exception and is treated differently: screen
 * size is read from the DOM, i.e. the terminal reporting a property on request.
 * Regulators care about identifiers rather than screen widths, but the line is
 * arguable and the consent plumbing already exists — so callers only send it
 * when analytics consent has been granted (see `SessionTracker`), and everything
 * else works fine without it.
 */

// ---- Primitives -------------------------------------------------------------

/**
 * Coarse form factor. `unknown` is a real value, not a gap to be filled: an
 * absent User-Agent is a different fact from "desktop", and defaulting it to
 * desktop would quietly pad whichever number the dashboard cares most about.
 * Mirrors the `ZZ` market convention in `markets.ts`.
 */
export const DEVICE_CLASSES = ["mobile", "tablet", "desktop", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Form factors that represent a real observation (i.e. everything but `unknown`). */
export const KNOWN_DEVICE_CLASSES = ["mobile", "tablet", "desktop"] as const;

export const OS_FAMILIES = [
  "ios",
  "ipados",
  "android",
  "macos",
  "windows",
  "linux",
  "chromeos",
  "other",
] as const;
export type OsFamily = (typeof OS_FAMILIES)[number];

export const BROWSER_FAMILIES = [
  "chrome",
  "safari",
  "firefox",
  "edge",
  "samsung",
  "opera",
  "other",
] as const;
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

/**
 * Viewport width buckets, chosen to line up with the Tailwind breakpoints the
 * app is actually built against — the point of measuring this is to find out
 * whether those breakpoints match reality, which a histogram of arbitrary
 * pixel values can't tell you.
 */
export const VIEWPORT_BUCKETS = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;
export type ViewportBucket = (typeof VIEWPORT_BUCKETS)[number];

/** The complete set of device dimensions recorded for a session or event. */
export interface DeviceFacts {
  device: DeviceClass;
  os: OsFamily;
  browser: BrowserFamily;
  /** Major version only — 17, never "17.4.1". Null when unparseable. */
  browserMajor: number | null;
}

export const UNKNOWN_DEVICE_FACTS: DeviceFacts = {
  device: "unknown",
  os: "other",
  browser: "other",
  browserMajor: null,
};

// ---- Parsing ----------------------------------------------------------------

/**
 * Low-entropy client hints, as they arrive on the request. All optional: only
 * Chromium sends them, and only over HTTPS — so the User-Agent fallback below
 * stays load-bearing for Safari and Firefox indefinitely.
 */
export interface ClientHints {
  /** `Sec-CH-UA-Platform`, e.g. `"macOS"`. */
  platform?: string | null;
  /** `Sec-CH-UA-Mobile`, e.g. `?1`. */
  mobile?: string | null;
  /** `Sec-CH-UA` brand list, e.g. `"Chromium";v="122", "Google Chrome";v="122"`. */
  brands?: string | null;
}

/** Strip the quoting the Structured-Headers syntax wraps hint values in. */
function unquote(v: string | null | undefined): string {
  return (v ?? "").trim().replace(/^"+|"+$/g, "");
}

function osFromHintPlatform(platform: string): OsFamily | null {
  switch (unquote(platform).toLowerCase()) {
    case "android":
      return "android";
    case "ios":
      return "ios";
    case "macos":
      return "macos";
    case "windows":
      return "windows";
    case "linux":
      return "linux";
    case "chrome os":
    case "chromeos":
      return "chromeos";
    default:
      return null;
  }
}

/**
 * Browser family + major version from the `Sec-CH-UA` brand list.
 *
 * The list deliberately contains a decoy brand ("Not(A:Brand", "Not_A Brand",
 * and other deliberately-varying spellings) to stop naive parsers from treating
 * the first entry as the truth, plus the generic "Chromium" every derivative
 * reports. So: skip the decoys, prefer a specific brand over Chromium, and only
 * fall back to Chromium when it's all that's on offer.
 */
function browserFromHintBrands(brands: string): { browser: BrowserFamily; major: number | null } | null {
  const entries = [...brands.matchAll(/"([^"]+)";\s*v="([^"]+)"/g)].map((m) => ({
    brand: m[1],
    version: m[2],
  }));
  if (entries.length === 0) return null;

  let chromium: number | null = null;
  for (const { brand, version } of entries) {
    const b = brand.toLowerCase();
    // The decoy brand's spelling is intentionally unstable, so match loosely on
    // the one thing it always contains rather than on any exact string.
    if (b.includes("not") && b.includes("brand")) continue;
    const major = majorOf(version);
    if (b === "chromium") {
      chromium = major;
      continue;
    }
    const family = browserFamilyFromName(b);
    if (family) return { browser: family, major };
  }
  return chromium != null ? { browser: "chrome", major: chromium } : null;
}

function browserFamilyFromName(name: string): BrowserFamily | null {
  if (name.includes("edge")) return "edge";
  if (name.includes("opera") || name.includes("opr")) return "opera";
  if (name.includes("samsung")) return "samsung";
  if (name.includes("firefox")) return "firefox";
  if (name.includes("google chrome") || name === "chrome") return "chrome";
  if (name.includes("safari")) return "safari";
  return null;
}

function majorOf(version: string): number | null {
  const n = parseInt(version, 10);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
}

/** Coarse device class from the User-Agent string. */
function deviceFromUa(ua: string): DeviceClass {
  const s = ua.toLowerCase();
  if (!s) return "unknown";
  if (/ipad|tablet|kindle|playbook|silk|nexus 7|nexus 10/.test(s)) return "tablet";
  if (/mobi|iphone|ipod|windows phone|blackberry|bb10|opera mini/.test(s)) return "mobile";
  // Android without the "Mobile" token is the platform's own tablet signal.
  if (/android/.test(s)) return /mobile/.test(s) ? "mobile" : "tablet";
  if (/macintosh|windows nt|cros|x11|linux/.test(s)) return "desktop";
  return "unknown";
}

function osFromUa(ua: string): OsFamily {
  const s = ua.toLowerCase();
  // iPadOS 13+ reports a desktop Macintosh UA, distinguishable only by the
  // touch-capable Safari build — check it before the macOS branch below.
  if (/ipad/.test(s)) return "ipados";
  if (/iphone|ipod/.test(s)) return "ios";
  if (/android/.test(s)) return "android";
  if (/cros/.test(s)) return "chromeos";
  if (/windows/.test(s)) return "windows";
  if (/macintosh|mac os x/.test(s)) return "macos";
  if (/linux|x11|ubuntu|fedora/.test(s)) return "linux";
  return "other";
}

/**
 * Browser family + major version from the User-Agent string.
 *
 * Order is the whole trick, because every Chromium browser also claims to be
 * Chrome and Safari: the derivatives (Edge, Opera, Samsung) have to be tested
 * before Chrome, and Chrome before Safari.
 */
function browserFromUa(ua: string): { browser: BrowserFamily; major: number | null } {
  const tests: { family: BrowserFamily; re: RegExp }[] = [
    { family: "edge", re: /edg(?:e|a|ios)?\/(\d+)/i },
    { family: "opera", re: /(?:opr|opera|opios)\/(\d+)/i },
    { family: "samsung", re: /samsungbrowser\/(\d+)/i },
    { family: "firefox", re: /(?:firefox|fxios)\/(\d+)/i },
    { family: "chrome", re: /(?:chrome|crios|chromium)\/(\d+)/i },
    { family: "safari", re: /version\/(\d+).*safari/i },
  ];
  for (const { family, re } of tests) {
    const m = re.exec(ua);
    if (m) return { browser: family, major: majorOf(m[1]) };
  }
  // Safari without a `Version/` token (in-app WebViews, older builds).
  if (/safari/i.test(ua)) return { browser: "safari", major: null };
  return { browser: "other", major: null };
}

/**
 * Resolve the device facts for one request.
 *
 * Client hints win where they're present — Chromium has frozen the User-Agent
 * string, so hint-first is what keeps this working as the UA decays — with two
 * exceptions the hints genuinely can't answer:
 *   - Form factor: `Sec-CH-UA-Mobile: ?0` is sent by Android tablets as well as
 *     desktops, so the tablet/mobile split has to come from the UA. The hint is
 *     only consulted to correct a `desktop`/`unknown` reading to `mobile`.
 *   - Anything at all when no hints are sent (Safari, Firefox, plain HTTP).
 */
export function parseDeviceFacts(input: { ua?: string | null; hints?: ClientHints }): DeviceFacts {
  const ua = (input.ua ?? "").slice(0, 500);
  const hints = input.hints ?? {};
  if (!ua && !hints.platform && !hints.brands) return { ...UNKNOWN_DEVICE_FACTS };

  const hintMobile = unquote(hints.mobile) === "?1";
  let device = deviceFromUa(ua);
  if (hintMobile && (device === "desktop" || device === "unknown")) device = "mobile";
  if (!hintMobile && device === "unknown" && hints.platform) device = "desktop";

  const os = osFromHintPlatform(hints.platform ?? "") ?? osFromUa(ua);
  const fromHints = hints.brands ? browserFromHintBrands(hints.brands) : null;
  const { browser, major } = fromHints ?? browserFromUa(ua);

  return {
    // iPadOS lies about being a Mac (see osFromUa); a touch iPad that got
    // classified as a tablet is better described as iPadOS than macOS.
    os: device === "tablet" && os === "macos" ? "ipados" : os,
    device,
    browser,
    browserMajor: major,
  };
}

/** Bucket a viewport width (CSS px) against the app's own breakpoints. */
export function viewportBucket(width: number): ViewportBucket {
  if (!Number.isFinite(width) || width <= 0) return "xs";
  if (width < 640) return "xs";
  if (width < 768) return "sm";
  if (width < 1024) return "md";
  if (width < 1280) return "lg";
  if (width < 1536) return "xl";
  return "2xl";
}

// ---- Labels -----------------------------------------------------------------

const DEVICE_LABELS: Record<DeviceClass, string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  unknown: "Unknown",
};

const OS_LABELS: Record<OsFamily, string> = {
  ios: "iOS",
  ipados: "iPadOS",
  android: "Android",
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  chromeos: "ChromeOS",
  other: "Other",
};

const BROWSER_LABELS: Record<BrowserFamily, string> = {
  chrome: "Chrome",
  safari: "Safari",
  firefox: "Firefox",
  edge: "Edge",
  samsung: "Samsung Internet",
  opera: "Opera",
  other: "Other",
};

const VIEWPORT_LABELS: Record<ViewportBucket, string> = {
  xs: "< 640px",
  sm: "640–767px",
  md: "768–1023px",
  lg: "1024–1279px",
  xl: "1280–1535px",
  "2xl": "≥ 1536px",
};

export function deviceLabel(d: string): string {
  return DEVICE_LABELS[d as DeviceClass] ?? d;
}

export function osLabel(os: string): string {
  return OS_LABELS[os as OsFamily] ?? os;
}

export function browserLabel(b: string): string {
  return BROWSER_LABELS[b as BrowserFamily] ?? b;
}

export function viewportLabel(v: string): string {
  return VIEWPORT_LABELS[v as ViewportBucket] ?? v;
}

/** `"safari:17"` → `"Safari 17"`. The key shape used in breakdown maps. */
export function browserVersionLabel(key: string): string {
  const [family, major] = key.split(":");
  const name = browserLabel(family);
  return major && major !== "null" ? `${name} ${major}` : name;
}

/**
 * Stable, low-cardinality map key for a browser + major version pair. Takes
 * loose strings so callers can build one from a stored document without
 * re-narrowing a family that was already validated on the way in.
 */
export function browserVersionKey(facts: {
  browser: string;
  browserMajor: number | null;
}): string {
  return `${facts.browser}:${facts.browserMajor ?? "null"}`;
}

// ---- Coercion ---------------------------------------------------------------

function oneOf<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Coerce an arbitrary payload (a Firestore doc, a request body) into
 * {@link DeviceFacts}. Tolerant by design: an older document written before a
 * family existed must never crash a read, and an unrecognized value has to
 * land on a known bucket rather than widening the map's cardinality.
 */
export function normalizeDeviceFacts(raw: unknown): DeviceFacts {
  if (!raw || typeof raw !== "object") return { ...UNKNOWN_DEVICE_FACTS };
  const d = raw as Record<string, unknown>;
  const major = typeof d.browserMajor === "number" && Number.isFinite(d.browserMajor)
    ? Math.trunc(d.browserMajor)
    : null;
  return {
    device: oneOf(DEVICE_CLASSES, d.device, "unknown"),
    os: oneOf(OS_FAMILIES, d.os, "other"),
    browser: oneOf(BROWSER_FAMILIES, d.browser, "other"),
    browserMajor: major,
  };
}

/** True when the facts carry no real observation (nothing worth aggregating). */
export function isUnknownDevice(facts: DeviceFacts): boolean {
  return facts.device === "unknown" && facts.os === "other" && facts.browser === "other";
}
