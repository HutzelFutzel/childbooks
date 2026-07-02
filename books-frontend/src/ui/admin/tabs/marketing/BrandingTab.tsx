"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Trash2, Upload } from "lucide-react";
import { useAppConfigStore } from "../../../../state/appConfigStore";
import type {
  BrandAsset,
  BrandAssetSlot,
  BrandColors,
  BrandingWatermark,
} from "../../../../core/config/branding";
import { Button } from "../../../components/Button";
import { Field, Input } from "../../../components/Input";
import { Grid, Section, TextField } from "../products/parts";

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/png",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const ASSETS: {
  slot: BrandAssetSlot;
  label: string;
  hint: string;
  ratio: string;
  dark?: boolean;
}[] = [
  { slot: "logo", label: "Logo", hint: "Horizontal logo for light backgrounds. SVG or transparent PNG.", ratio: "5/2" },
  { slot: "logoDark", label: "Logo (dark)", hint: "Logo variant for dark backgrounds.", ratio: "5/2", dark: true },
  { slot: "icon", label: "App icon / mark", hint: "Square mark. 512×512 PNG or SVG.", ratio: "1/1" },
  { slot: "favicon", label: "Favicon", hint: "Browser tab icon. SVG or 512×512 PNG.", ratio: "1/1" },
  { slot: "ogImage", label: "Social share image", hint: "Open Graph / Twitter card. 1200×630 PNG.", ratio: "1200/630" },
];

/**
 * Marketing → Branding: the product's brand kit. Identity (name/tagline/colors)
 * plus every brand image (logo, dark logo, icon, favicon, social image) and the
 * share watermark — all stored in `appConfig/branding` and read live across the
 * marketing site, the studio top bar, and SEO/social metadata.
 */
export function BrandingTab() {
  const branding = useAppConfigStore((s) => s.branding);
  const saveInfo = useAppConfigStore((s) => s.saveBrandingInfo);

  // Identity draft (name / tagline / colors) with a manual save.
  const [name, setName] = useState(branding.brandName);
  const [tagline, setTagline] = useState(branding.tagline);
  const [colors, setColors] = useState<BrandColors>(branding.colors);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setName(branding.brandName);
    setTagline(branding.tagline);
    setColors(branding.colors);
  }, [branding.brandName, branding.tagline, branding.colors, dirty]);

  const onSaveInfo = async () => {
    setSaving(true);
    try {
      await saveInfo({ brandName: name, tagline, colors });
      setDirty(false);
      toast.success("Brand identity saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
        Your brand kit. Everything here is stored in Firebase and used live across
        the landing page, the studio top bar, shared book pages, and social/search
        metadata — no redeploy needed when you change it.
      </p>

      {/* ---- Identity ---- */}
      <Section
        title="Identity"
        hint="Name and tagline appear in the nav, top bar, footer and metadata. Primary color drives the browser theme color and brand accents."
        action={
          <div className="flex gap-2">
            {dirty && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setName(branding.brandName);
                  setTagline(branding.tagline);
                  setColors(branding.colors);
                  setDirty(false);
                }}
              >
                Discard
              </Button>
            )}
            <Button size="sm" onClick={onSaveInfo} loading={saving} disabled={!dirty}>
              Save identity
            </Button>
          </div>
        }
      >
        <Grid cols={2}>
          <TextField
            label="Brand name"
            value={name}
            onChange={(v) => {
              setName(v);
              setDirty(true);
            }}
          />
          <TextField
            label="Tagline"
            value={tagline}
            onChange={(v) => {
              setTagline(v);
              setDirty(true);
            }}
          />
        </Grid>
        <Grid cols={2}>
          <ColorField
            label="Primary color"
            value={colors.primary}
            onChange={(v) => {
              setColors((c) => ({ ...c, primary: v }));
              setDirty(true);
            }}
          />
          <ColorField
            label="Accent color"
            value={colors.accent}
            onChange={(v) => {
              setColors((c) => ({ ...c, accent: v }));
              setDirty(true);
            }}
          />
        </Grid>
      </Section>

      {/* ---- Brand images ---- */}
      <Section title="Brand images" hint="Upload once; swap anytime. Replacing an image keeps the old one in version history — nothing is lost.">
        <div className="grid gap-3 sm:grid-cols-2">
          {ASSETS.map((a) => (
            <AssetCard
              key={a.slot}
              slot={a.slot}
              label={a.label}
              hint={a.hint}
              ratio={a.ratio}
              dark={a.dark}
              asset={branding[a.slot]}
              history={branding.assetHistory[a.slot] ?? []}
            />
          ))}
        </div>
      </Section>

      {/* ---- Watermark ---- */}
      <WatermarkCard />
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
          className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-200 bg-white p-1"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function AssetCard({
  slot,
  label,
  hint,
  ratio,
  dark,
  asset,
  history,
}: {
  slot: BrandAssetSlot;
  label: string;
  hint: string;
  ratio: string;
  dark?: boolean;
  asset: BrandAsset | null;
  history: BrandAsset[];
}) {
  const upload = useAppConfigStore((s) => s.uploadBrandingAsset);
  const remove = useAppConfigStore((s) => s.removeBrandingAsset);
  const restore = useAppConfigStore((s) => s.restoreBrandingAsset);
  const deleteVersion = useAppConfigStore((s) => s.deleteBrandingAssetVersion);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await upload(slot, base64, mimeType, asset?.alt);
      toast.success(`${label} updated.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await remove(slot);
      toast.success(`${label} removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl ring-1 ring-inset ring-ink-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink-800">{label}</div>
          <p className="text-[11px] leading-relaxed text-ink-400">{hint}</p>
        </div>
      </div>

      <div
        style={{ aspectRatio: ratio }}
        className={`flex w-full items-center justify-center overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100 ${
          dark ? "bg-ink-800" : "bg-ink-50"
        }`}
      >
        {asset?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.imageUrl} alt={asset.alt ?? label} className="max-h-full max-w-full object-contain p-3" />
        ) : (
          <span className="text-[11px] text-ink-400">No {label.toLowerCase()} set</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/webp,image/jpeg,image/x-icon"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          leftIcon={<Upload className="size-3.5" />}
          onClick={() => inputRef.current?.click()}
        >
          {asset?.imageUrl ? "Replace" : "Upload"}
        </Button>
        {asset?.imageUrl && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            leftIcon={<Trash2 className="size-3.5" />}
            onClick={() => void onRemove()}
          >
            Remove
          </Button>
        )}
      </div>

      <VersionHistory
        versions={history}
        dark={dark}
        onRestore={(sp) => restore(slot, sp)}
        onDelete={(sp) => deleteVersion(slot, sp)}
      />
    </div>
  );
}

/** A strip of previous versions with restore + permanent-delete actions. */
function VersionHistory({
  versions,
  dark,
  onRestore,
  onDelete,
}: {
  versions: (BrandAsset | BrandingWatermark)[];
  dark?: boolean;
  onRestore: (storagePath: string) => Promise<void>;
  onDelete: (storagePath: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (versions.length === 0) return null;

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
      <div className="text-[11px] font-medium text-ink-500">Version history ({versions.length})</div>
      <div className="flex flex-wrap gap-2">
        {versions.map((v) =>
          v.storagePath ? (
            <div key={v.storagePath} className="w-16 shrink-0">
              <div
                className={`flex size-16 items-center justify-center overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100 ${
                  dark ? "bg-ink-800" : "bg-ink-50"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.imageUrl} alt="" className="max-h-full max-w-full object-contain p-1" />
              </div>
              <div className="mt-1 flex justify-center gap-1">
                <button
                  type="button"
                  title="Restore this version"
                  disabled={busy === v.storagePath}
                  onClick={() => void run(v.storagePath!, () => onRestore(v.storagePath!), "Version restored.")}
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
                      void run(v.storagePath!, () => onDelete(v.storagePath!), "Version deleted.");
                    }
                  }}
                  className="rounded p-1 text-ink-500 hover:bg-ink-100 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

/** The share watermark: upload + live opacity/size controls (unchanged behavior). */
function WatermarkCard() {
  const watermark = useAppConfigStore((s) => s.branding.watermark);
  const watermarkHistory = useAppConfigStore((s) => s.branding.watermarkHistory);
  const uploadWatermark = useAppConfigStore((s) => s.uploadWatermark);
  const updateAppearance = useAppConfigStore((s) => s.updateWatermarkAppearance);
  const removeWatermark = useAppConfigStore((s) => s.removeWatermark);
  const restore = useAppConfigStore((s) => s.restoreWatermark);
  const deleteVersion = useAppConfigStore((s) => s.deleteWatermarkVersion);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [opacity, setOpacity] = useState(watermark?.opacity ?? 0.5);
  const [scale, setScale] = useState(watermark?.scale ?? 0.25);

  useEffect(() => {
    setOpacity(watermark?.opacity ?? 0.5);
    setScale(watermark?.scale ?? 0.25);
  }, [watermark?.opacity, watermark?.scale, watermark?.imageUrl]);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await uploadWatermark(base64, mimeType, opacity, scale);
      toast.success("Watermark updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const commit = async (patch: { opacity?: number; scale?: number }) => {
    try {
      await updateAppearance(patch);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save appearance.");
    }
  };

  const onRemove = async () => {
    setBusy(true);
    try {
      await removeWatermark();
      toast.success("Watermark removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove watermark.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Share watermark"
      hint="Shown over publicly shared books. Hidden for readers whose publisher has a plan with the “remove watermark” entitlement."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl ring-1 ring-inset ring-ink-100 p-3">
          <div className="mb-2 text-xs font-medium text-ink-600">Preview</div>
          <div className="relative aspect-4/3 w-full overflow-hidden rounded-lg bg-linear-to-br from-brand-100 to-amber-100">
            {watermark?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={watermark.imageUrl}
                alt="Watermark preview"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 object-contain"
                style={{ width: `${Math.round(scale * 100)}%`, opacity }}
              />
            ) : (
              <div className="flex size-full items-center justify-center text-xs text-ink-500">
                No watermark set
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-xl ring-1 ring-inset ring-ink-100 p-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/svg+xml,image/png,image/webp"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              leftIcon={<Upload className="size-4" />}
              onClick={() => inputRef.current?.click()}
            >
              {watermark?.imageUrl ? "Replace" : "Upload"}
            </Button>
            {watermark?.imageUrl && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                leftIcon={<Trash2 className="size-4" />}
                onClick={() => void onRemove()}
              >
                Remove
              </Button>
            )}
          </div>

          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-600">
              <span>Opacity</span>
              <span className="tabular-nums text-ink-400">{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              disabled={!watermark?.imageUrl}
              onChange={(e) => setOpacity(Number(e.target.value))}
              onMouseUp={() => void commit({ opacity })}
              onTouchEnd={() => void commit({ opacity })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block">
            <div className="flex items-center justify-between text-xs font-medium text-ink-600">
              <span>Size (page width)</span>
              <span className="tabular-nums text-ink-400">{Math.round(scale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={scale}
              disabled={!watermark?.imageUrl}
              onChange={(e) => setScale(Number(e.target.value))}
              onMouseUp={() => void commit({ scale })}
              onTouchEnd={() => void commit({ scale })}
              className="mt-1 w-full"
            />
          </label>
        </div>
      </div>

      <VersionHistory
        versions={watermarkHistory}
        onRestore={(sp) => restore(sp)}
        onDelete={(sp) => deleteVersion(sp)}
      />
    </Section>
  );
}
