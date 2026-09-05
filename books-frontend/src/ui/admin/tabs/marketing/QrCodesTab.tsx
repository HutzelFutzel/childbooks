"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  QrCode as QrCodeIcon,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppConfigStore, type QrCodeInput } from "../../../../state/appConfigStore";
import type { BrandAssetSlot } from "../../../../core/config/branding";
import {
  QR_CORNER_STYLES,
  QR_DOT_STYLES,
  QR_ERROR_CORRECTION_LEVELS,
  QR_LOGO_QUIET_COLOR_DEFAULT,
  QR_LOGO_QUIET_DEFAULT,
  QR_LOGO_QUIET_MAX,
  QR_LOGO_QUIET_MIN,
  QR_LOGO_SIZE_MAX,
  QR_LOGO_SIZE_MIN,
  qrTrackedUrl,
  type QrCode,
  type QrCornerStyle,
  type QrDotStyle,
  type QrErrorCorrectionLevel,
  type QrFormat,
  type QrRender,
  type QrScanStats,
} from "../../../../core/config/qrCodes";
import { arrivalToken } from "../../../../core/profile/acquisition";
import { useAdminTab } from "../../adminTabStore";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Toggle } from "../../../components/Toggle";
import { Disclosure, Grid, NumberField, Section, TabIntro, TextField, fileToBase64 } from "../products/parts";

/** Every brand-image slot a logo can be copied from, in the same order the
 *  Branding tab lists them. */
const BRAND_ASSET_SLOT_LABELS: { slot: BrandAssetSlot; label: string }[] = [
  { slot: "logo", label: "Logo" },
  { slot: "logoDark", label: "Logo (dark)" },
  { slot: "icon", label: "App icon / mark" },
  { slot: "favicon", label: "Favicon" },
  { slot: "ogImage", label: "Social share image" },
  { slot: "defaultCoverFront", label: "Default front cover (square)" },
  { slot: "defaultCoverBack", label: "Default back cover (square)" },
  { slot: "defaultCoverFrontWide", label: "Default front cover (landscape)" },
  { slot: "defaultCoverBackWide", label: "Default back cover (landscape)" },
  { slot: "defaultCoverFrontPortrait", label: "Default front cover (portrait)" },
  { slot: "defaultCoverBackPortrait", label: "Default back cover (portrait)" },
];

const QR_DOT_STYLE_LABELS: Record<QrDotStyle, string> = {
  square: "Square",
  dots: "Dots",
  rounded: "Rounded",
  classy: "Classy",
  "classy-rounded": "Classy rounded",
  "extra-rounded": "Extra rounded",
};

/**
 * In-progress edits live in `sessionStorage` so switching admin tabs (which
 * unmounts this whole panel — see `AdminApp.tsx`) and coming back doesn't
 * throw away whatever the admin was in the middle of typing. Scoped to the
 * tab (session, not local storage) and to one draft per code id, plus one
 * for a not-yet-created code — cleared once a save/delete/cancel resolves.
 *
 * Also time-boxed: `sessionStorage` survives a plain page reload, not just a
 * tab switch, so without an expiry a genuinely abandoned edit (the admin
 * tried something, didn't like it, and just navigated away without an
 * explicit "discard") would silently resurrect — possibly hours later — and
 * look like the *saved* code, right up until the next save quietly pushes
 * that stale state (missing logo, old colors, …) back to the server. A short
 * expiry keeps the "resume where I left off" behavior for an actual
 * back-and-forth editing session while treating anything older as abandoned.
 */
const QR_DRAFT_STORAGE_PREFIX = "childbooks:admin:qrcodes:draft:";
const QR_NEW_DRAFT_STORAGE_KEY = `${QR_DRAFT_STORAGE_PREFIX}new`;
const QR_CREATING_STORAGE_KEY = "childbooks:admin:qrcodes:creating";
const QR_DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

interface StoredQrDraft {
  draft: QrDraft;
  savedAt: number;
}

/** Bust browser / Storage-emulator caching of `?alt=media` URLs. Each save
 *  writes a new object path, but restores re-point at an older path the
 *  browser may still have cached; `updatedAt` changes on every swap. */
function cacheBustedUrl(url: string, updatedAt?: number): string {
  if (!updatedAt) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}v=${updatedAt}`;
}

function loadDraftFromStorage(key: string, fallback: QrDraft): QrDraft {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Partial<StoredQrDraft>;
    if (typeof stored.savedAt !== "number" || Date.now() - stored.savedAt > QR_DRAFT_MAX_AGE_MS) {
      window.sessionStorage.removeItem(key);
      return fallback;
    }
    // Spread over a fresh default rather than trusting the stored blob
    // outright — a draft saved before a schema change (a new field added)
    // should still load with a sane value for whatever it's missing.
    return { ...fallback, ...stored.draft };
  } catch {
    return fallback;
  }
}

function saveDraftToStorage(key: string, draft: QrDraft): void {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredQrDraft = { draft, savedAt: Date.now() };
    window.sessionStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // Storage full or unavailable (private browsing) — the draft just won't
    // survive a tab switch; nothing else depends on this succeeding.
  }
}

function clearDraftFromStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

const QR_CORNER_STYLE_LABELS: Record<QrCornerStyle, string> = {
  square: "Square",
  dot: "Dot",
  dots: "Dots",
  rounded: "Rounded",
  "extra-rounded": "Extra rounded",
  classy: "Classy",
  "classy-rounded": "Classy rounded",
};

/**
 * Marketing → QR codes: a named, reusable library of QR codes rendered by our
 * own generator (the `qrcode` npm package, run server-side — no third-party QR
 * API, so a code baked into a printed book can't break from under it). Every
 * option the package exposes is here; a center logo (own upload, or a copy of
 * an existing brand image) is optional and composited on top by `sharp`.
 *
 * Anything else that needs a QR code (a back-cover branding block, a marketing
 * page, an order insert) points at one of these by id rather than duplicating
 * the generator.
 */
export function QrCodesTab() {
  const codes = useAppConfigStore((s) => s.qrCodes.codes);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);
  const [creating, setCreating] = useState(
    () => typeof window !== "undefined" && window.sessionStorage.getItem(QR_CREATING_STORAGE_KEY) === "1",
  );

  const startCreating = () => {
    setCreating(true);
    if (typeof window !== "undefined") window.sessionStorage.setItem(QR_CREATING_STORAGE_KEY, "1");
  };
  const stopCreating = () => {
    setCreating(false);
    clearDraftFromStorage(QR_NEW_DRAFT_STORAGE_KEY);
    if (typeof window !== "undefined") window.sessionStorage.removeItem(QR_CREATING_STORAGE_KEY);
  };

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere="Want a fixed logo + URL + QR block on every book's back cover? That belongs in Marketing → Branding once it exists — this library is the general-purpose generator any feature (including that one) points at by id."
        links={[{ label: "Analysis → QR codes", onClick: () => openAnalysis("qrCodes") }]}
      >
        Every code here is rendered by our own generator, not a free web QR API —
        nothing baked into a printed book can break because some third-party
        service rate-limits, re-brands, or disappears. Error correction, size,
        colors, quiet zone, version, mask pattern and cell/eye shape are all
        exposed, plus an optional center logo. Turn on{" "}
        <span className="font-medium">Track scans</span> on any saved code to count its scans, re-point it after
        it&apos;s printed, and hand whoever scans it an arrival token a coupon can apply itself to.
      </TabIntro>

      {creating && <QrCodeCard code={null} onSaved={stopCreating} onCancel={stopCreating} />}

      {codes.length === 0 && !creating && (
        <p className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
          No QR codes yet — create one to get a permanent, printable URL.
        </p>
      )}

      {codes.map((code) => (
        <QrCodeCard key={code.id} code={code} />
      ))}

      {!creating && (
        <Button variant="secondary" leftIcon={<Plus className="size-4" />} onClick={startCreating}>
          New QR code
        </Button>
      )}
    </div>
  );
}

/** Editable draft shape — a friendlier, always-valid superset of `QrCodeInput`
 *  (auto version/mask as booleans, an in-progress upload kept until saved). */
interface QrDraft {
  name: string;
  data: string;
  tracked: boolean;
  errorCorrectionLevel: QrErrorCorrectionLevel;
  margin: number;
  scalePx: number;
  colorDark: string;
  colorLight: string;
  format: QrFormat;
  versionAuto: boolean;
  version: number;
  maskPatternAuto: boolean;
  maskPattern: number;
  dotsStyle: QrDotStyle;
  cornerSquareStyle: QrCornerStyle | null;
  cornerDotStyle: QrCornerStyle | null;
  logoEnabled: boolean;
  logoSource: "keep" | "upload" | "brandingAsset";
  logoBrandingSlot: BrandAssetSlot;
  logoUpload: { base64: string; mimeType: string } | null;
  logoSizePct: number;
  /** Quiet-ring pad around the logo, as a fraction of the logo's width. */
  logoQuietPct: number;
  /** Quiet-ring fill color. */
  logoQuietColor: string;
}

function newDraft(): QrDraft {
  return {
    name: "",
    data: "",
    tracked: false,
    errorCorrectionLevel: "M",
    margin: 4,
    scalePx: 512,
    colorDark: "#000000",
    colorLight: "#ffffff",
    format: "png",
    versionAuto: true,
    version: 10,
    maskPatternAuto: true,
    maskPattern: 0,
    dotsStyle: "square",
    cornerSquareStyle: null,
    cornerDotStyle: null,
    logoEnabled: false,
    // Default to upload — branding assets are optional and can be missing
    // from Storage even when the Branding tab still lists them (emulator
    // drift). Auto-selecting a branding slot on toggle would immediately
    // error the live preview.
    logoSource: "upload",
    logoBrandingSlot: "icon",
    logoUpload: null,
    logoSizePct: 0.2,
    logoQuietPct: QR_LOGO_QUIET_DEFAULT,
    logoQuietColor: QR_LOGO_QUIET_COLOR_DEFAULT,
  };
}

function draftFromCode(code: QrCode): QrDraft {
  return {
    name: code.name,
    data: code.data,
    tracked: code.tracked,
    errorCorrectionLevel: code.errorCorrectionLevel,
    margin: code.margin,
    scalePx: code.scalePx,
    colorDark: code.colorDark,
    colorLight: code.colorLight,
    format: code.format,
    versionAuto: code.version === null,
    version: code.version ?? 10,
    maskPatternAuto: code.maskPattern === null,
    maskPattern: code.maskPattern ?? 0,
    dotsStyle: code.dotsStyle,
    cornerSquareStyle: code.cornerSquareStyle,
    cornerDotStyle: code.cornerDotStyle,
    logoEnabled: Boolean(code.logo),
    logoSource: code.logo ? "keep" : "upload",
    logoBrandingSlot: code.logo?.brandingSlot ?? "icon",
    logoUpload: null,
    logoSizePct: code.logo?.sizePct ?? 0.2,
    logoQuietPct: code.logo?.quietPct ?? QR_LOGO_QUIET_DEFAULT,
    logoQuietColor: code.logo?.quietColor ?? QR_LOGO_QUIET_COLOR_DEFAULT,
  };
}

/**
 * `id` should be the already-saved code's id whenever there is one (omit it
 * only for a brand-new, never-saved draft). Create/update ignore it (the URL
 * carries the id there), but preview/download depend on it — without it the
 * backend has no saved code to resolve a `"keep"` logo against, and silently
 * renders with no logo at all rather than erroring.
 */
function draftToInput(draft: QrDraft, id?: string): QrCodeInput {
  return {
    ...(id ? { id } : {}),
    name: draft.name.trim() || "Untitled QR code",
    data: draft.data.trim(),
    tracked: draft.tracked,
    errorCorrectionLevel: draft.errorCorrectionLevel,
    margin: draft.margin,
    scalePx: draft.scalePx,
    colorDark: draft.colorDark,
    colorLight: draft.colorLight,
    format: draft.format,
    version: draft.versionAuto ? null : draft.version,
    maskPattern: draft.maskPatternAuto ? null : draft.maskPattern,
    dotsStyle: draft.dotsStyle,
    cornerSquareStyle: draft.cornerSquareStyle,
    cornerDotStyle: draft.cornerDotStyle,
    logo: !draft.logoEnabled
      ? null
      : draft.logoSource === "upload" && draft.logoUpload
        ? {
            source: "upload",
            base64: draft.logoUpload.base64,
            mimeType: draft.logoUpload.mimeType,
            sizePct: draft.logoSizePct,
            quietPct: draft.logoQuietPct,
            quietColor: draft.logoQuietColor,
          }
        : draft.logoSource === "brandingAsset"
          ? {
              source: "brandingAsset",
              brandingSlot: draft.logoBrandingSlot,
              sizePct: draft.logoSizePct,
              quietPct: draft.logoQuietPct,
              quietColor: draft.logoQuietColor,
            }
          : draft.logoSource === "keep"
            ? {
                source: "keep",
                sizePct: draft.logoSizePct,
                quietPct: draft.logoQuietPct,
                quietColor: draft.logoQuietColor,
              }
            // "upload" picked but no file chosen yet — keep an existing logo
            // if there is one; otherwise send null so the preview doesn't
            // error (and a save without a file doesn't invent a logo).
            : id
              ? {
                  source: "keep",
                  sizePct: draft.logoSizePct,
                  quietPct: draft.logoQuietPct,
                  quietColor: draft.logoQuietColor,
                }
              : null,
  };
}

function segBtnClass(active: boolean): string {
  return `h-9 flex-1 rounded-lg px-2 text-xs font-semibold ring-1 ring-inset transition ${
    active
      ? "bg-brand-600 text-white ring-brand-600"
      : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50"
  }`;
}

/** Like `segBtnClass`, but a fixed-width pill that wraps in a row instead of
 *  stretching to fill it — for option sets too long for a segmented control
 *  (the six cell shapes). */
function pillBtnClass(active: boolean): string {
  return `h-8 shrink-0 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition ${
    active
      ? "bg-brand-600 text-white ring-brand-600"
      : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50"
  }`;
}

function QrCodeCard({
  code,
  onSaved,
  onCancel,
}: {
  code: QrCode | null;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isNew = code === null;
  const branding = useAppConfigStore((s) => s.branding);
  const createQrCode = useAppConfigStore((s) => s.createQrCode);
  const updateQrCode = useAppConfigStore((s) => s.updateQrCode);
  const removeQrCode = useAppConfigStore((s) => s.deleteQrCode);
  const restoreVersion = useAppConfigStore((s) => s.restoreQrCodeVersion);
  const deleteVersion = useAppConfigStore((s) => s.deleteQrCodeVersion);
  const previewQrCode = useAppConfigStore((s) => s.previewQrCode);

  const storageKey = code ? `${QR_DRAFT_STORAGE_PREFIX}${code.id}` : QR_NEW_DRAFT_STORAGE_KEY;
  const freshDraft = code ? draftFromCode(code) : newDraft();
  const [draft, setDraft] = useState<QrDraft>(() => {
    const loaded = loadDraftFromStorage(storageKey, freshDraft);
    // Older session drafts defaulted logo-on to "brandingAsset", which
    // immediately errors the preview when those Storage files are missing
    // (common after an emulator reset). Coerce to upload unless this code
    // already has a saved logo the admin may still want to replace from branding.
    if (loaded.logoEnabled && loaded.logoSource === "brandingAsset" && !code?.logo) {
      return { ...loaded, logoSource: "upload" };
    }
    return loaded;
  });
  // A restored draft that actually differs from the saved code (or is brand
  // new) starts dirty, so "Save changes" is enabled without the admin having
  // to touch a field first — otherwise a continued edit could look saved.
  const [dirty, setDirty] = useState(() => isNew || JSON.stringify(draft) !== JSON.stringify(freshDraft));
  // Collapsed to a compact summary row once there's nothing pending — a
  // library of a dozen codes shouldn't each take a screen's worth of space.
  // Mid-edit (including a just-restored unsaved draft) starts expanded.
  const [expanded, setExpanded] = useState(() => isNew || dirty);

  // Persist every edit — not debounced; sessionStorage writes are cheap, and
  // a tab switch can happen at any moment mid-edit.
  useEffect(() => {
    saveDraftToStorage(storageKey, draft);
  }, [draft, storageKey]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState<QrFormat | null>(null);
  const [preview, setPreview] = useState<string | null>(() =>
    code?.rendered ? cacheBustedUrl(code.rendered.imageUrl, code.rendered.updatedAt) : null,
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Bumped to force a re-fetch even when draft fields are unchanged — e.g.
  // expanding a collapsed card after a backend render-path change, or after
  // restoring a history version whose settings match the current draft.
  const [previewNonce, setPreviewNonce] = useState(0);
  const requestId = useRef(0);
  // Last saved render we adopted into local state — used to detect external
  // updates (restore / store refresh) without clobbering an in-progress draft
  // on every parent re-render.
  const syncedRenderPath = useRef<string | null>(code?.rendered?.storagePath ?? null);

  const patch = (p: Partial<QrDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const adoptSavedCode = (next: QrCode) => {
    setDraft(draftFromCode(next));
    setDirty(false);
    clearDraftFromStorage(storageKey);
    syncedRenderPath.current = next.rendered?.storagePath ?? null;
    setPreview(
      next.rendered ? cacheBustedUrl(next.rendered.imageUrl, next.rendered.updatedAt) : null,
    );
    setPreviewError(null);
  };

  // When the saved render changes underneath us (version restore, or another
  // tab's save landing in the store) and we don't have local edits pending,
  // adopt it so the thumbnail / preview / form don't stay on the old image.
  useEffect(() => {
    if (!code?.rendered) return;
    if (code.rendered.storagePath === syncedRenderPath.current) return;
    if (dirty) return;
    adoptSavedCode(code);
    // Force a live re-render too — restore swaps the file pointer without
    // changing draft fields, so the preview effect's normal deps wouldn't fire.
    setPreviewNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code?.rendered?.storagePath, code?.updatedAt]);

  // Live preview: re-render (server-side, in memory — no Storage write) on
  // every draft change while the card is open. Debounced so a dragged slider
  // doesn't fire a request per tick. Collapsed cards skip the network call
  // entirely — expanding is itself a dep, so reopening always gets a fresh
  // render rather than a stale data-URL from the previous edit session.
  useEffect(() => {
    if (!expanded) return;
    if (!draft.data.trim()) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const id = ++requestId.current;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = setTimeout(() => {
      void previewQrCode(draftToInput(draft, code?.id))
        .then((res) => {
          if (id !== requestId.current) return;
          setPreview(`data:${res.contentType};base64,${res.base64}`);
        })
        .catch((err) => {
          if (id !== requestId.current) return;
          // Drop the stale image so a failed re-render can't look like a
          // successful one — previously the old preview stayed up and the
          // error was only shown when preview was already null.
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : "Could not render a preview.");
        })
        .finally(() => {
          if (id === requestId.current) setPreviewLoading(false);
        });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expanded,
    draft.data,
    // Tracking changes what's encoded, so it changes the image.
    draft.tracked,
    draft.errorCorrectionLevel,
    draft.margin,
    draft.scalePx,
    draft.colorDark,
    draft.colorLight,
    draft.format,
    draft.versionAuto,
    draft.version,
    draft.maskPatternAuto,
    draft.maskPattern,
    draft.dotsStyle,
    draft.cornerSquareStyle,
    draft.cornerDotStyle,
    draft.logoEnabled,
    draft.logoSource,
    draft.logoBrandingSlot,
    draft.logoUpload,
    draft.logoSizePct,
    draft.logoQuietPct,
    draft.logoQuietColor,
    previewNonce,
  ]);

  const onSave = async () => {
    if (!draft.data.trim()) {
      toast.error("Enter a URL or text to encode.");
      return;
    }
    setSaving(true);
    try {
      const input = draftToInput(draft, code?.id);
      if (isNew) {
        const created = await createQrCode(input);
        toast.success("QR code created.");
        adoptSavedCode(created);
        onSaved?.();
      } else {
        const updated = await updateQrCode(code.id, input);
        toast.success("QR code updated.");
        adoptSavedCode(updated);
        // The edit is done — collapse back to the compact row rather than
        // keep occupying a full card's worth of space.
        setExpanded(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the QR code.");
    } finally {
      setSaving(false);
    }
  };

  /** Revert to the last-saved version, discarding whatever's pending — the
   *  explicit escape hatch out of an in-progress edit the admin decided not
   *  to keep (the alternative being to just navigate away, which no longer
   *  silently loses the change, but also doesn't un-pend it). */
  const onDiscard = () => {
    setDraft(freshDraft);
    setDirty(false);
    clearDraftFromStorage(storageKey);
    setPreview(
      code?.rendered ? cacheBustedUrl(code.rendered.imageUrl, code.rendered.updatedAt) : null,
    );
    setPreviewError(null);
    setPreviewNonce((n) => n + 1);
  };

  /** Download the code as an actual file — SVG when asked for and no logo is
   *  forcing PNG (see `functions/src/qrcode.ts`), otherwise PNG. Renders via
   *  the no-Storage-write preview endpoint so this works for an unsaved
   *  draft too, not just an already-saved code. */
  const downloadFormat = async (fmt: QrFormat) => {
    if (!draft.data.trim()) return;
    setDownloading(fmt);
    try {
      const currentPreviewMatch = fmt === draft.format ? /^data:([^;]+);base64,(.+)$/.exec(preview ?? "") : null;
      const { contentType, base64 } = currentPreviewMatch
        ? { contentType: currentPreviewMatch[1], base64: currentPreviewMatch[2] }
        : await previewQrCode({ ...draftToInput(draft, code?.id), format: fmt });
      const ext = contentType === "image/svg+xml" ? "svg" : "png";
      const safeName =
        draft.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "qr-code";
      const link = document.createElement("a");
      link.href = `data:${contentType};base64,${base64}`;
      link.download = `${safeName}.${ext}`;
      link.click();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not render a download.");
    } finally {
      setDownloading(null);
    }
  };

  const onDelete = async () => {
    if (!code) return;
    if (!window.confirm(`Delete "${code.name}"? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await removeQrCode(code.id);
      toast.success("QR code deleted.");
      clearDraftFromStorage(storageKey);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
      setDeleting(false);
    }
  };

  const brandingSlots = BRAND_ASSET_SLOT_LABELS.filter((s) => branding[s.slot]?.imageUrl);

  return (
    <div className="space-y-3 rounded-xl ring-1 ring-inset ring-ink-100 p-4">
      {/* A brand-new, not-yet-saved code has nothing to collapse to — only an
       *  existing one gets the compact-row header. */}
      {!isNew && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-50 ring-1 ring-inset ring-ink-100">
              {code?.rendered ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={code.rendered.storagePath}
                  src={cacheBustedUrl(code.rendered.imageUrl, code.rendered.updatedAt)}
                  alt=""
                  className="max-h-full max-w-full object-contain p-1"
                />
              ) : (
                <QrCodeIcon className="size-4 text-ink-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink-800">{draft.name || "Untitled QR code"}</span>
                {draft.tracked && (
                  <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">
                    Tracked
                  </span>
                )}
                {dirty && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    Unsaved edits
                  </span>
                )}
              </div>
              {!expanded && <div className="truncate text-xs text-ink-400">{draft.data || "No URL/text set"}</div>}
            </div>
            {expanded ? (
              <ChevronUp className="size-4 shrink-0 text-ink-400" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-ink-400" />
            )}
          </button>
          {/* Downloads stay available while collapsed — no need to expand just
           *  to grab a file. SVG is unavailable when a logo is on (compositing
           *  forces PNG); same rule as the expanded action row. */}
          {!expanded && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === "png"}
                disabled={!draft.data.trim() || downloading !== null}
                leftIcon={<Download className="size-3.5" />}
                onClick={() => void downloadFormat("png")}
              >
                PNG
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === "svg"}
                disabled={!draft.data.trim() || draft.logoEnabled || downloading !== null}
                title={
                  draft.logoEnabled
                    ? "A logo forces PNG output, so there's no vector version of this one."
                    : undefined
                }
                leftIcon={<Download className="size-3.5" />}
                onClick={() => void downloadFormat("svg")}
              >
                SVG
              </Button>
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
          <div className="space-y-3">
            <Grid cols={2}>
              <TextField label="Name" value={draft.name} placeholder="e.g. Back cover CTA" onChange={(v) => patch({ name: v })} />
              <TextField
                label={draft.tracked ? "Destination URL" : "URL / text"}
                value={draft.data}
                placeholder="https://example.com"
                onChange={(v) => patch({ data: v })}
              />
            </Grid>

            <TrackedPanel code={code} draft={draft} patch={patch} />

            <Section title="Style" hint="Every option the qrcode package exposes.">
              <Grid cols={3}>
                <Field label="Error correction">
                  <div className="flex gap-1">
                    {QR_ERROR_CORRECTION_LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => patch({ errorCorrectionLevel: lvl })}
                        className={segBtnClass(draft.errorCorrectionLevel === lvl)}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </Field>
                <NumberField label="Quiet zone (margin)" value={draft.margin} min={0} onChange={(n) => patch({ margin: n })} />
                <NumberField
                  label="Output size"
                  value={draft.scalePx}
                  min={128}
                  step="32"
                  suffix="px"
                  onChange={(n) => patch({ scalePx: n })}
                />
              </Grid>
              <Grid cols={3}>
                <ColorField label="Foreground" value={draft.colorDark} onChange={(v) => patch({ colorDark: v })} />
                <ColorField label="Background" value={draft.colorLight} onChange={(v) => patch({ colorLight: v })} />
                <Field label="Format">
                  <div className="flex gap-1">
                    {(["png", "svg"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => patch({ format: f })}
                        className={`${segBtnClass(draft.format === f)} uppercase`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </Field>
              </Grid>
              {draft.logoEnabled && draft.format === "svg" && (
                <p className="text-[11px] leading-relaxed text-amber-700">
                  A logo can&apos;t be composited onto vector SVG — this will render as PNG instead.
                </p>
              )}

              <Disclosure label="Advanced — version &amp; mask pattern">
                <Grid cols={2}>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink-700">QR version (size)</span>
                      <Toggle checked={draft.versionAuto} onChange={(v) => patch({ versionAuto: v })} label="Auto version" />
                    </div>
                    {!draft.versionAuto && (
                      <NumberField
                        label="Version (1–40)"
                        value={draft.version}
                        min={1}
                        onChange={(n) => patch({ version: Math.min(40, Math.max(1, n)) })}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink-700">Mask pattern</span>
                      <Toggle checked={draft.maskPatternAuto} onChange={(v) => patch({ maskPatternAuto: v })} label="Auto mask" />
                    </div>
                    {!draft.maskPatternAuto && (
                      <NumberField
                        label="Mask (0–7)"
                        value={draft.maskPattern}
                        min={0}
                        onChange={(n) => patch({ maskPattern: Math.min(7, Math.max(0, n)) })}
                      />
                    )}
                    {draft.dotsStyle !== "square" || draft.cornerSquareStyle || draft.cornerDotStyle ? (
                      <p className="text-[11px] leading-relaxed text-ink-400">
                        Ignored while any shape below isn&apos;t plain squares — the styling renderer picks its own.
                      </p>
                    ) : null}
                  </div>
                </Grid>
              </Disclosure>
            </Section>

            <Section
              title="Shape"
              hint="Rounded or dotted cells and eyes. Anything other than plain squares switches this code from the qrcode package to qr-code-styling."
            >
              <Field label="Cells">
                <div className="flex flex-wrap gap-1.5">
                  {QR_DOT_STYLES.map((style) => (
                    <button
                      key={style}
                      type="button"
                      onClick={() => patch({ dotsStyle: style })}
                      className={pillBtnClass(draft.dotsStyle === style)}
                    >
                      {QR_DOT_STYLE_LABELS[style]}
                    </button>
                  ))}
                </div>
              </Field>
              <Grid cols={2}>
                <Field label="Outer eye ring">
                  <select
                    value={draft.cornerSquareStyle ?? ""}
                    onChange={(e) => patch({ cornerSquareStyle: (e.target.value || null) as QrCornerStyle | null })}
                    className="h-11 w-full rounded-xl2 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">Match cells</option>
                    {QR_CORNER_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {QR_CORNER_STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Inner eye dot">
                  <select
                    value={draft.cornerDotStyle ?? ""}
                    onChange={(e) => patch({ cornerDotStyle: (e.target.value || null) as QrCornerStyle | null })}
                    className="h-11 w-full rounded-xl2 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">Match cells</option>
                    {QR_CORNER_STYLES.map((s) => (
                      <option key={s} value={s}>
                        {QR_CORNER_STYLE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              </Grid>
            </Section>

            <LogoSection
              draft={draft}
              patch={patch}
              brandingSlots={brandingSlots}
              hasExistingLogo={Boolean(code?.logo)}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
                {isNew ? "Create QR code" : "Save changes"}
              </Button>
              {!isNew && dirty && (
                <Button variant="ghost" size="sm" onClick={onDiscard}>
                  Discard changes
                </Button>
              )}
              {isNew ? (
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleting}
                  loading={deleting}
                  leftIcon={<Trash2 className="size-3.5" />}
                  onClick={() => void onDelete()}
                >
                  Delete
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === "png"}
                disabled={!draft.data.trim() || downloading !== null}
                leftIcon={<Download className="size-3.5" />}
                onClick={() => void downloadFormat("png")}
              >
                Download PNG
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === "svg"}
                disabled={!draft.data.trim() || draft.logoEnabled || downloading !== null}
                title={draft.logoEnabled ? "A logo forces PNG output, so there's no vector version of this one." : undefined}
                leftIcon={<Download className="size-3.5" />}
                onClick={() => void downloadFormat("svg")}
              >
                Download SVG
              </Button>
              {code?.rendered && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Copy className="size-3.5" />}
                    onClick={() => {
                      void navigator.clipboard.writeText(code.rendered!.imageUrl);
                      toast.success("URL copied.");
                    }}
                  >
                    Copy URL
                  </Button>
                  <a
                    href={code.rendered.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-ink-600 transition hover:bg-ink-100"
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </a>
                </>
              )}
            </div>

            {code && code.history.length > 0 && (
              <VersionsStrip
                history={code.history}
                onRestore={async (sp) => {
                  await restoreVersion(code.id, sp);
                  // Restore must win over any in-progress draft — the store
                  // just swapped the rendered file, so pull the fresh code
                  // and show it immediately (don't wait for the sync effect,
                  // which skips when dirty).
                  const next = useAppConfigStore.getState().qrCodes.codes.find((c) => c.id === code.id);
                  if (next) adoptSavedCode(next);
                  setPreviewNonce((n) => n + 1);
                }}
                onDelete={(sp) => deleteVersion(code.id, sp)}
              />
            )}
          </div>

          <div className="w-full">
            <div className="mb-1.5 text-[11px] font-medium text-ink-500">Live preview</div>
            <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-ink-50 ring-1 ring-inset ring-ink-100">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={preview.slice(0, 64)}
                  src={preview}
                  alt="QR code preview"
                  className="max-h-full max-w-full object-contain p-2"
                />
              ) : previewError ? (
                <span className="p-2 text-center text-[11px] text-red-600">{previewError}</span>
              ) : (
                <span className="p-2 text-center text-[11px] text-ink-400">Enter a URL to preview</span>
              )}
              {previewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                  <Loader2 className="size-5 animate-spin text-brand-500" />
                </div>
              )}
            </div>
            {code?.rendered && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                &ldquo;Copy URL&rdquo;/&ldquo;Open&rdquo; point at the last <em>saved</em> render, not this live preview.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Turn a code into a **tracked** one, and show what that gets you.
 *
 * A plain code encodes its destination directly, which is fine for "put our
 * homepage on the back cover" and useless for attribution: the scan is
 * indistinguishable from a direct visit, and the destination is frozen in ink.
 * Tracked codes encode `{site}/q/{id}` instead and let the server forward the
 * scan on — which counts it, keeps the destination editable after the poster is
 * on a wall, and hands the scanner an arrival token a coupon can key off.
 *
 * Only offered on a SAVED code, because the id is what gets encoded and the
 * server mints it. The download button works on an unsaved draft by design, so
 * without this rule an admin could print a code pointing at a placeholder id
 * that resolves to nothing.
 */
function TrackedPanel({
  code,
  draft,
  patch,
}: {
  code: QrCode | null;
  draft: QrDraft;
  patch: (p: Partial<QrDraft>) => void;
}) {
  const siteUrl = useAppConfigStore((s) => s.seo.siteUrl);
  const loadScans = useAppConfigStore((s) => s.loadQrScanStats);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);
  const [scans, setScans] = useState<QrScanStats | null>(null);

  const id = code?.id ?? null;
  useEffect(() => {
    if (!id || !draft.tracked) return;
    let live = true;
    void loadScans()
      .then((all) => {
        if (live) setScans(all[id] ?? null);
      })
      // A missing count is not worth an error toast on a settings screen.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, draft.tracked, loadScans]);

  const encoded = id ? qrTrackedUrl(siteUrl, id) : "";
  const token = id ? arrivalToken("qr", id) : "";

  const copy = (value: string, what: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(`${what} copied.`);
  };

  return (
    <Section
      title="Track scans"
      hint="Count scans, change where this code points after it's printed, and let a coupon apply itself to whoever scans it."
      action={
        <Toggle
          checked={draft.tracked}
          disabled={!id}
          onChange={(v) => patch({ tracked: v })}
          label="Track scans"
        />
      }
    >
      {!id ? (
        <p className="text-xs text-ink-400">
          Save this code first. Tracking encodes the code&apos;s own id, and that id is assigned when it&apos;s
          created — offering it now would let you download an image pointing at an id that doesn&apos;t exist yet.
        </p>
      ) : !draft.tracked ? (
        <p className="text-[11px] leading-relaxed text-ink-400">
          Off: the destination above is encoded straight into the image. Nothing counts the scan, and the URL is fixed
          for as long as the code exists in print. Turning this on re-renders the image — anything already printed
          keeps working, because the old image still encodes the old URL.
        </p>
      ) : (
        <div className="space-y-2">
          <CopyRow
            label="Encoded in the image"
            value={encoded}
            onCopy={() => copy(encoded, "Link")}
            hint="Scans hit this, get counted, and are forwarded to the destination above."
          />
          <CopyRow
            label="Coupon audience token"
            value={token}
            onCopy={() => copy(token, "Token")}
            hint={
              <>
                Paste this into a coupon&apos;s <span className="font-medium">Arrived via</span> field to auto-grant it
                to everyone who scans this code.{" "}
                <button
                  type="button"
                  className="font-medium text-brand-600 underline-offset-2 hover:underline"
                  onClick={() => openMarketingTab("coupons")}
                >
                  Coupons →
                </button>
              </>
            }
          />
          <div className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
            {scans && scans.scans > 0 ? (
              <>
                <span className="font-semibold text-ink-800">{scans.scans.toLocaleString()}</span> scan
                {scans.scans === 1 ? "" : "s"}
                {scans.lastScanAt > 0 && <> · last {new Date(scans.lastScanAt).toLocaleDateString()}</>}
              </>
            ) : (
              "No scans yet."
            )}
          </div>
          {!siteUrl && (
            <p className="text-[11px] leading-relaxed text-amber-700">
              No site URL is set in SEO settings, so there&apos;s no absolute address to encode — this code still
              renders, but with the destination encoded directly and nothing tracked. Set the site URL and save again.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function CopyRow({
  label,
  value,
  hint,
  onCopy,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-ink-50 px-2 py-1.5 text-xs text-ink-700">{value}</code>
        <Button variant="secondary" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={onCopy}>
          Copy
        </Button>
      </div>
      {hint && <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-ink-200 bg-white p-1"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" />
      </div>
    </Field>
  );
}

function LogoSection({
  draft,
  patch,
  brandingSlots,
  hasExistingLogo,
}: {
  draft: QrDraft;
  patch: (p: Partial<QrDraft>) => void;
  brandingSlots: { slot: BrandAssetSlot; label: string }[];
  hasExistingLogo: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      patch({ logoSource: "upload", logoUpload: { base64, mimeType: file.type || "image/png" } });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Section
      title="Center logo"
      hint="Optional. Composited over the middle by our own generator, using either your own picture or an existing brand image — a logo automatically bumps error correction to at least Q so the code still scans."
      action={
        <Toggle
          checked={draft.logoEnabled}
          onChange={(v) => {
            if (!v) {
              patch({ logoEnabled: false });
              return;
            }
            // Turning the logo on shouldn't immediately fetch a branding
            // asset (those can 404 after local Storage drift). Prefer keep
            // when there's already a logo on this code, otherwise upload.
            const logoSource = hasExistingLogo
              ? draft.logoSource === "upload" || draft.logoSource === "brandingAsset"
                ? draft.logoSource
                : ("keep" as const)
              : ("upload" as const);
            patch({ logoEnabled: true, logoSource });
          }}
          label="Add a center logo"
        />
      }
    >
      {draft.logoEnabled && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {hasExistingLogo && (
              <button type="button" onClick={() => patch({ logoSource: "keep" })} className={segBtnClass(draft.logoSource === "keep")}>
                Keep current
              </button>
            )}
            <button
              type="button"
              onClick={() => patch({ logoSource: "brandingAsset" })}
              className={segBtnClass(draft.logoSource === "brandingAsset")}
            >
              Branding asset
            </button>
            <button type="button" onClick={() => patch({ logoSource: "upload" })} className={segBtnClass(draft.logoSource === "upload")}>
              Upload a picture
            </button>
          </div>

          {draft.logoSource === "brandingAsset" && (
            <Field label="Which brand image">
              {brandingSlots.length === 0 ? (
                <p className="text-xs text-ink-400">
                  No branding images are set yet — upload one in Marketing → Branding, or upload a picture here instead.
                </p>
              ) : (
                <>
                  <select
                    value={draft.logoBrandingSlot}
                    onChange={(e) => patch({ logoBrandingSlot: e.target.value as BrandAssetSlot })}
                    className="h-11 w-full rounded-xl2 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    {brandingSlots.map((s) => (
                      <option key={s.slot} value={s.slot}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-ink-400">
                    If preview fails saying the file is missing, re-upload that image in Marketing → Branding — the
                    config can outlive the Storage file after a local emulator reset.
                  </p>
                </>
              )}
            </Field>
          )}

          {draft.logoSource === "upload" && (
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/jpeg"
                className="hidden"
                onChange={(e) => void onPick(e.target.files?.[0])}
              />
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                leftIcon={<Upload className="size-3.5" />}
                onClick={() => inputRef.current?.click()}
              >
                {draft.logoUpload ? "Replace picture" : "Choose a picture"}
              </Button>
              {draft.logoUpload && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:${draft.logoUpload.mimeType};base64,${draft.logoUpload.base64}`}
                  alt=""
                  className="h-14 w-14 rounded-lg bg-white object-contain p-1 ring-1 ring-inset ring-ink-100"
                />
              )}
            </div>
          )}

          {draft.logoSource === "keep" && (
            <p className="text-xs text-ink-400">Using the logo already saved on this code.</p>
          )}

          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-600">
              <span>Logo size</span>
              <span className="tabular-nums text-ink-400">{Math.round(draft.logoSizePct * 100)}%</span>
            </div>
            <input
              type="range"
              min={QR_LOGO_SIZE_MIN}
              max={QR_LOGO_SIZE_MAX}
              step={0.01}
              value={draft.logoSizePct}
              onChange={(e) => patch({ logoSizePct: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-600">
              <span>Quiet ring</span>
              <span className="tabular-nums text-ink-400">{Math.round(draft.logoQuietPct * 100)}%</span>
            </div>
            <input
              type="range"
              min={QR_LOGO_QUIET_MIN}
              max={QR_LOGO_QUIET_MAX}
              step={0.01}
              value={draft.logoQuietPct}
              onChange={(e) => patch({ logoQuietPct: Number(e.target.value) })}
              className="mt-1 w-full"
            />
            <p className="mt-1 text-[11px] text-ink-400">
              Padding around the logo (as a % of logo size). Clears nearby modules without a hard square — 0% sits
              flush on the code.
            </p>
          </label>

          <ColorField
            label="Quiet ring color"
            value={draft.logoQuietColor}
            onChange={(v) => patch({ logoQuietColor: v })}
          />
          <button
            type="button"
            className="text-[11px] font-medium text-brand-600 hover:underline"
            onClick={() => patch({ logoQuietColor: draft.colorLight })}
          >
            Match QR background
          </button>
        </div>
      )}
    </Section>
  );
}

/** A strip of previous renders with restore + permanent-delete actions. */
function VersionsStrip({
  history,
  onRestore,
  onDelete,
}: {
  history: QrRender[];
  onRestore: (storagePath: string) => Promise<void>;
  onDelete: (storagePath: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (sp: string, fn: () => Promise<void>, ok: string) => {
    setBusy(sp);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5 border-t border-ink-100 pt-2">
      <div className="text-[11px] font-medium text-ink-500">Version history ({history.length})</div>
      <div className="flex flex-wrap gap-2">
        {history.map((v) => (
          <div key={v.storagePath} className="w-14 shrink-0">
            <div className="flex size-14 items-center justify-center overflow-hidden rounded-lg bg-ink-50 ring-1 ring-inset ring-ink-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={v.storagePath}
                src={cacheBustedUrl(v.imageUrl, v.updatedAt)}
                alt=""
                className="max-h-full max-w-full object-contain p-1"
              />
            </div>
            <div className="mt-1 flex justify-center gap-1">
              <button
                type="button"
                title="Restore this version"
                disabled={busy === v.storagePath}
                onClick={() => void run(v.storagePath, () => onRestore(v.storagePath), "Version restored.")}
                className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-brand-600 disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                title="Delete permanently"
                disabled={busy === v.storagePath}
                onClick={() => {
                  if (window.confirm("Permanently delete this version? This can't be undone.")) {
                    void run(v.storagePath, () => onDelete(v.storagePath), "Version deleted.");
                  }
                }}
                className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
