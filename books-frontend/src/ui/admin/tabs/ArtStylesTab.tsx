"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";

/** Read a File as bare base64 (no data: prefix) + its mime type. */
function readBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve({ base64: comma >= 0 ? result.slice(comma + 1) : result, mimeType: file.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function StyleRow({ presetId, label, description }: { presetId: string; label: string; description: string }) {
  const example = useAppConfigStore((s) => s.artStyles.examples[presetId]);
  const upload = useAppConfigStore((s) => s.uploadArtStyleImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { base64, mimeType } = await readBase64(file);
      await upload(presetId, base64, mimeType);
      toast.success(`Updated example for ${label}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl ring-1 ring-inset ring-ink-100 p-3">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-ink-100">
        {example?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={example.imageUrl} alt={`${label} example`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] text-ink-400">
            No image
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-800">{label}</div>
        <div className="truncate text-xs text-ink-500">{description}</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        leftIcon={<Upload className="size-4" />}
        onClick={() => inputRef.current?.click()}
      >
        {example?.imageUrl ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}

export function ArtStylesTab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        Upload an example image for each art style. Users see it in the setup wizard; styles without
        an image show the gradient swatch.
      </p>
      <div className="space-y-2">
        {ART_STYLE_PRESETS.map((preset) => (
          <StyleRow
            key={preset.id}
            presetId={preset.id}
            label={preset.label}
            description={preset.description}
          />
        ))}
      </div>
    </div>
  );
}
