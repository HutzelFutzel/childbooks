import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import type { AssetItem } from "../../core/settings";
import { putBlob } from "../../state/blobs";
import { useSettingsStore } from "../../state/settingsStore";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { notify } from "../lib/notify";
import { useDragSource } from "./StudioDnd";

/** Read the intrinsic aspect ratio (w/h) of an image file. */
function imageAspect(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(1);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * Uploadable, draggable library of reusable image assets. Clicking (or
 * dragging) a tile places it on `onPlace`'s target page.
 */
export function AssetsLibrary({ onPlace }: { onPlace?: (asset: AssetItem) => void }) {
  const assets = useSettingsStore((s) => s.settings.assets);
  const addAsset = useSettingsStore((s) => s.addAsset);
  const removeAsset = useSettingsStore((s) => s.removeAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const blobId = await putBlob(file);
        const aspect = await imageAspect(file);
        addAsset({
          id: Math.random().toString(36).slice(2, 10),
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Image",
          blobId,
          aspect,
        });
      }
    } catch (err) {
      notify.error(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">My assets</p>
        <button
          onClick={() => fileRef.current?.click()}
          title="Upload images"
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-brand-600"
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>
      {assets.length === 0 ? (
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-2 flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-ink-200 px-3 py-5 text-center transition hover:border-brand-300 hover:bg-brand-50/40"
        >
          <ImagePlus className="size-5 text-ink-300" />
          <span className="text-[11px] text-ink-500">Upload images to add to a page.</span>
        </button>
      ) : (
        <div className="mt-2 grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto">
          {assets.map((asset) => (
            <AssetTile
              key={asset.id}
              asset={asset}
              onRemove={() => removeAsset(asset.id)}
              onClick={onPlace ? () => onPlace(asset) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetTile({
  asset,
  onRemove,
  onClick,
}: {
  asset: AssetItem;
  onRemove: () => void;
  onClick?: () => void;
}) {
  const url = useBlobUrl(asset.blobId);
  const drag = useDragSource(() => ({ type: "asset", asset, label: asset.name }), onClick);
  return (
    <div
      {...drag}
      title={`${asset.name}${onClick ? " — click to place, or drag onto a page" : ""}`}
      className="group relative aspect-square cursor-grab touch-none overflow-hidden rounded-lg border border-ink-200 bg-ink-50 transition hover:border-brand-300 active:cursor-grabbing"
    >
      {url ? (
        <img
          src={url}
          alt={asset.name}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          className="size-full select-none object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          <Loader2 className="size-4 animate-spin text-ink-300" />
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Remove asset"
        className="absolute right-0.5 top-0.5 hidden rounded bg-white/90 p-0.5 text-red-500 shadow-sm group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}
