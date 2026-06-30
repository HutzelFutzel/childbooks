"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2, Upload } from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({
        base64: comma >= 0 ? result.slice(comma + 1) : result,
        mimeType: file.type || "image/svg+xml",
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function BrandingTab() {
  const watermark = useAppConfigStore((s) => s.branding.watermark);
  const uploadWatermark = useAppConfigStore((s) => s.uploadWatermark);
  const updateAppearance = useAppConfigStore((s) => s.updateWatermarkAppearance);
  const removeWatermark = useAppConfigStore((s) => s.removeWatermark);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Local appearance state for live preview; committed (debounced) to the backend.
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

  const commitAppearance = async (patch: { opacity?: number; scale?: number }) => {
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
    <div className="space-y-5">
      <p className="text-xs text-ink-500">
        Upload a watermark (SVG recommended) shown over publicly shared books. It is hidden for
        readers whose publisher has a plan with the “remove watermark” entitlement.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Preview over a sample page */}
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

        {/* Controls */}
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
              onMouseUp={() => void commitAppearance({ opacity })}
              onTouchEnd={() => void commitAppearance({ opacity })}
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
              onMouseUp={() => void commitAppearance({ scale })}
              onTouchEnd={() => void commitAppearance({ scale })}
              className="mt-1 w-full"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
