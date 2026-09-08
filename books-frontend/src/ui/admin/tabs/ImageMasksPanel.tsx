"use client";

import { useRef, useState } from "react";
import { Archive, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ImageMaskAsset } from "../../../core/config/imageMasks";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Section } from "./products/parts";

function readSvg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function nameFromFile(file: File): string {
  const bare = file.name.replace(/\.svg$/i, "").replace(/[-_]+/g, " ").trim();
  return bare.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 80) || "Image shape";
}

function maskStyle(url: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url("${url}")`,
    maskImage: `url("${url}")`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  };
}

function ShapeCard({ asset }: { asset: ImageMaskAsset }) {
  const patch = useAppConfigStore((state) => state.patchImageMask);
  const [name, setName] = useState(asset.name);
  const [busy, setBusy] = useState(false);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === asset.name) {
      setName(asset.name);
      return;
    }
    setBusy(true);
    try {
      await patch(asset.id, { name: next });
    } catch (error) {
      setName(asset.name);
      toast.error(error instanceof Error ? error.message : "Could not rename image shape.");
    } finally {
      setBusy(false);
    }
  };

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    try {
      await patch(asset.id, { archived });
      toast.success(archived ? "Image shape archived." : "Image shape restored.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update image shape.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-ink-200 bg-white p-3">
      <div className="grid h-24 grid-cols-[1fr_1.28fr_.72fr] items-center gap-2 rounded-lg bg-ink-50 p-2">
        {["aspect-square", "aspect-[4/3]", "aspect-[3/4]"].map((aspect) => (
          <div
            key={aspect}
            className={`${aspect} max-h-20 w-full rounded-md bg-black p-1`}
          >
            <div className="size-full bg-white" style={maskStyle(asset.imageUrl)} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={name}
          disabled={busy}
          aria-label="Image shape name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-medium text-ink-700 outline-none hover:border-ink-200 focus:border-brand-300 focus:bg-white"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setName(asset.name);
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          disabled={busy}
          title={asset.archived ? "Restore" : "Archive"}
          aria-label={asset.archived ? "Restore image shape" : "Archive image shape"}
          onClick={() => void setArchived(!asset.archived)}
          className="rounded-md p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:opacity-40"
        >
          {asset.archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />}
        </button>
      </div>
    </article>
  );
}

export function ImageMasksPanel() {
  const assets = useAppConfigStore((state) => state.imageMasks.assets);
  const upload = useAppConfigStore((state) => state.uploadImageMask);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const active = assets.filter((asset) => !asset.archived);
  const archived = assets.filter((asset) => asset.archived);

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".svg")) {
          throw new Error(`${file.name} is not an SVG file.`);
        }
        await upload(nameFromFile(file), await readSvg(file), "image/svg+xml");
        uploaded += 1;
      }
      toast.success(`${uploaded === 1 ? "Image shape" : `${uploaded} image shapes`} added.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Section
      title="Image shapes"
      hint="Upload one square black-and-white SVG. White shows the picture; black cuts it away. Every upload is previewed automatically across common frame shapes."
    >
      <div className="space-y-3">
        <div>
          <input
            ref={inputRef}
            type="file"
            accept=".svg,image/svg+xml"
            multiple
            className="hidden"
            onChange={(event) => void onPick(event.target.files)}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            leftIcon={<Upload className="size-4" />}
            onClick={() => inputRef.current?.click()}
          >
            Add SVG
          </Button>
        </div>

        {active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-xs text-ink-400">
            No image shapes yet. Upload a square SVG to add the Shape control to the editor.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((asset) => <ShapeCard key={asset.id} asset={asset} />)}
          </div>
        )}

        {archived.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-ink-500">
              Archived ({archived.length})
            </summary>
            <div className="mt-2 grid gap-3 opacity-70 sm:grid-cols-2 xl:grid-cols-3">
              {archived.map((asset) => <ShapeCard key={asset.id} asset={asset} />)}
            </div>
          </details>
        )}
      </div>
    </Section>
  );
}
