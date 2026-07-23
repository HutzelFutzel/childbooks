"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RotateCcw, Upload } from "lucide-react";
import { ART_STYLE_PRESETS } from "../../../core/config/options";
import { resolveArtStyleText } from "../../../core/prompts/style";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Section } from "./products/parts";

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

function StyleEditor({
  presetId,
  label,
  description,
  labelText,
  onLabelChange,
  onLabelReset,
  promptText,
  onPromptChange,
  onPromptReset,
}: {
  presetId: string;
  label: string;
  description: string;
  labelText: string | undefined;
  onLabelChange: (text: string) => void;
  onLabelReset: () => void;
  promptText: string | undefined;
  onPromptChange: (text: string) => void;
  onPromptReset: () => void;
}) {
  const example = useAppConfigStore((s) => s.artStyles.examples[presetId]);
  const upload = useAppConfigStore((s) => s.uploadArtStyleImage);
  const promptDescriptions = useAppConfigStore((s) => s.artStyles.promptDescriptions);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const preset = ART_STYLE_PRESETS.find((p) => p.id === presetId);
  const defaultDesc = preset?.promptDescription ?? preset?.promptHint ?? "";
  const defaultLabel = preset?.label ?? presetId;
  const hasOverride = Boolean(promptText?.trim());
  const hasLabelOverride = Boolean(labelText?.trim());

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

  const preview = resolveArtStyleText(
    { presetId, customDescription: "" },
    {
      artStyles: {
        version: 1,
        examples: {},
        labels: {},
        promptDescriptions: promptText?.trim()
          ? { [presetId]: { text: promptText, updatedAt: 0 } }
          : promptDescriptions,
      },
    },
  );

  return (
    <Section
      title={labelText?.trim() || label}
      hint={description}
      action={
        hasOverride ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RotateCcw className="size-3.5" />}
            onClick={onPromptReset}
          >
            Reset prompt
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-ink-100 ring-1 ring-inset ring-ink-100">
          {example?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={example.imageUrl} alt={`${label} example`} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-[10px] text-ink-400">
              No image
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Field
            label="Style title"
            hint={
              hasLabelOverride ? `Default: ${defaultLabel}` : "Shown to customers in the story setup wizard."
            }
          >
            <div className="flex items-center gap-2">
              <Input
                value={labelText ?? defaultLabel}
                onChange={(e) => onLabelChange(e.target.value)}
                placeholder={defaultLabel}
              />
              {hasLabelOverride ? (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<RotateCcw className="size-3.5" />}
                  onClick={onLabelReset}
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Style prompt (for image generation)">
            <Textarea
              rows={5}
              value={promptText ?? defaultDesc}
              onChange={(e) => onPromptChange(e.target.value)}
              className="font-mono text-xs leading-relaxed"
            />
          </Field>
          <p className="text-[11px] text-ink-400">
            Resolved preview: <span className="text-ink-500">{preview.slice(0, 140)}…</span>
          </p>
        </div>
        <div className="shrink-0 self-start">
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
            {example?.imageUrl ? "Replace image" : "Upload image"}
          </Button>
        </div>
      </div>
    </Section>
  );
}

export function ArtStylesTab() {
  const stored = useAppConfigStore((s) => s.artStyles);
  const save = useAppConfigStore((s) => s.saveArtStyles);

  const [promptDescriptions, setPromptDescriptions] = useState(stored.promptDescriptions);
  const [labels, setLabels] = useState(stored.labels);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) {
      setPromptDescriptions(stored.promptDescriptions);
      setLabels(stored.labels);
    }
  }, [stored.promptDescriptions, stored.labels, dirty]);

  const onSave = async () => {
    setSaving(true);
    try {
      await save({
        version: 1,
        examples: stored.examples,
        promptDescriptions,
        labels,
      });
      setDirty(false);
      toast.success("Art style settings saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save art styles.");
    } finally {
      setSaving(false);
    }
  };

  const setPrompt = (presetId: string, text: string) => {
    setPromptDescriptions((prev) => ({
      ...prev,
      [presetId]: { text, updatedAt: Date.now() },
    }));
    setDirty(true);
  };

  const resetPrompt = (presetId: string) => {
    setPromptDescriptions((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
    setDirty(true);
  };

  const setLabel = (presetId: string, text: string) => {
    setLabels((prev) => ({
      ...prev,
      [presetId]: { text, updatedAt: Date.now() },
    }));
    setDirty(true);
  };

  const resetLabel = (presetId: string) => {
    setLabels((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
    setDirty(true);
  };

  const unchanged = useMemo(
    () =>
      JSON.stringify(promptDescriptions) === JSON.stringify(stored.promptDescriptions) &&
      JSON.stringify(labels) === JSON.stringify(stored.labels),
    [promptDescriptions, labels, stored.promptDescriptions, stored.labels],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-relaxed text-ink-500">
          Titles and example images appear in the story setup wizard; style prompts are injected
          into illustration and character-reference generation. Images upload immediately; titles
          and prompt text save with the button below.
        </p>
        <Button size="sm" loading={saving} disabled={!dirty || unchanged} onClick={() => void onSave()}>
          Save changes
        </Button>
      </div>

      <div className="space-y-3">
        {ART_STYLE_PRESETS.map((preset) => (
          <StyleEditor
            key={preset.id}
            presetId={preset.id}
            label={preset.label}
            description={preset.description}
            labelText={labels[preset.id]?.text}
            onLabelChange={(text) => setLabel(preset.id, text)}
            onLabelReset={() => resetLabel(preset.id)}
            promptText={promptDescriptions[preset.id]?.text}
            onPromptChange={(text) => setPrompt(preset.id, text)}
            onPromptReset={() => resetPrompt(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}
