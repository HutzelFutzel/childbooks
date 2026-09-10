"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Eye,
  EyeOff,
  ImagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  resolveArtStyles,
  type ArtStyleDefinition,
  type ArtStyleExample,
  type ArtStylesConfig,
} from "../../../core/config/artStyles";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { Button } from "../../components/Button";
import { Field, Input, Textarea } from "../../components/Input";
import { Toggle } from "../../components/Toggle";
import { cn } from "../../lib/cn";

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

function styleId(existing: Set<string>, label: string): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56) || "art-style";
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    if (!existing.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function normalizeOrders(config: ArtStylesConfig): ArtStylesConfig {
  return {
    version: 2,
    styles: resolveArtStyles(config, { includeDisabled: true }).map(
      (style, order) => ({
        ...style,
        order,
        examples: style.examples.map((example, exampleOrder) => ({
          ...example,
          order: exampleOrder,
        })),
      }),
    ),
  };
}

function PreviewThumb({
  example,
  index,
  count,
  busy,
  onMove,
  onRemove,
}: {
  example: ArtStyleExample;
  index: number;
  count: number;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <div className="aspect-4/3 overflow-hidden bg-ink-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={example.imageUrl}
          alt=""
          className="size-full object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="text-[11px] font-medium text-ink-500">
          {index === 0 ? "Primary preview" : `Example ${index + 1}`}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={busy || index === 0}
            aria-label="Move preview earlier"
            onClick={() => onMove(-1)}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:opacity-25"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={busy || index === count - 1}
            aria-label="Move preview later"
            onClick={() => onMove(1)}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 disabled:opacity-25"
          >
            <ArrowRight className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label="Remove preview"
            onClick={onRemove}
            className="rounded-md p-1.5 text-ink-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-25"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
}

function StyleEditor({
  style,
  onChange,
}: {
  style: ArtStyleDefinition;
  onChange: (next: ArtStyleDefinition) => void;
}) {
  const upload = useAppConfigStore((state) => state.uploadArtStyleImage);
  const removeImage = useAppConfigStore((state) => state.removeArtStyleImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const patch = (next: Partial<ArtStyleDefinition>) =>
    onChange({ ...style, ...next, updatedAt: Date.now() });

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).slice(0, Math.max(0, 12 - style.examples.length));
    if (!selected.length) {
      toast.info("This style already has the maximum of 12 previews.");
      return;
    }
    setBusy(true);
    let examples = style.examples.slice();
    try {
      for (const file of selected) {
        if (!file.type.startsWith("image/")) {
          throw new Error(`${file.name} is not an image.`);
        }
        const payload = await readBase64(file);
        const uploaded = await upload(style.id, payload.base64, payload.mimeType);
        if (!examples.some((item) => item.storagePath === uploaded.storagePath)) {
          examples = [...examples, { ...uploaded, order: examples.length }];
          const persisted = useAppConfigStore
            .getState()
            .artStyles.styles.find((item) => item.id === style.id);
          onChange({
            ...style,
            examples,
            updatedAt: persisted?.updatedAt ?? style.updatedAt,
          });
        }
      }
      toast.success(
        `${selected.length} preview${selected.length === 1 ? "" : "s"} added.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const moveExample = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= style.examples.length) return;
    const examples = style.examples.slice();
    [examples[index], examples[target]] = [examples[target], examples[index]];
    patch({ examples: examples.map((example, order) => ({ ...example, order })) });
  };

  const deleteExample = async (example: ArtStyleExample) => {
    if (!example.storagePath) {
      patch({
        examples: style.examples
          .filter((item) => item !== example)
          .map((item, order) => ({ ...item, order })),
      });
      return;
    }
    setBusy(true);
    try {
      await removeImage(style.id, example.storagePath);
      const persisted = useAppConfigStore
        .getState()
        .artStyles.styles.find((item) => item.id === style.id);
      onChange({
        ...style,
        examples: style.examples
          .filter((item) => item.storagePath !== example.storagePath)
          .map((item, order) => ({ ...item, order })),
        updatedAt: persisted?.updatedAt ?? style.updatedAt,
      });
      toast.success("Preview removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove preview.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <section className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-ink-900">
              Customer previews
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
              The first picture is shown while customers compare styles. Additional
              pictures are optional examples of the same look. Preview images are
              never sent to the image model.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void onPick(event.target.files)}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            disabled={style.examples.length >= 12}
            leftIcon={<ImagePlus className="size-4" />}
            onClick={() => inputRef.current?.click()}
          >
            Add pictures
          </Button>
        </div>

        {style.examples.length ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {style.examples.map((example, index) => (
              <PreviewThumb
                key={example.storagePath ?? example.imageUrl}
                example={example}
                index={index}
                count={style.examples.length}
                busy={busy}
                onMove={(direction) => moveExample(index, direction)}
                onRemove={() => void deleteExample(example)}
              />
            ))}
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex aspect-4/1 w-full flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-ink-50/70 px-4 text-center transition hover:border-brand-400 hover:bg-brand-50/40"
          >
            <ImagePlus className="size-5 text-ink-400" />
            <span className="mt-2 text-sm font-medium text-ink-700">
              Add the primary preview
            </span>
            <span className="mt-0.5 text-xs text-ink-500">
              Use a 4:3 image, ideally 1200 × 900 px or larger.
            </span>
          </button>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
        <div>
          <h2 className="font-display text-lg font-bold text-ink-900">
            Style details
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Customers see the title and short description. Only the drawing prompt
            is sent to image generation.
          </p>
        </div>
        <Field label="Style title" required>
          <Input
            value={style.label}
            maxLength={120}
            onChange={(event) => patch({ label: event.target.value })}
          />
        </Field>
        <Field
          label="Short description"
          hint="One plain sentence about visible qualities. Shown under the preview."
        >
          <Textarea
            rows={2}
            value={style.description}
            maxLength={300}
            onChange={(event) => patch({ description: event.target.value })}
          />
        </Field>
        <Field
          label="Drawing prompt"
          hint="Sent to the image model whenever this style is active. Customers never see it."
          required
        >
          <Textarea
            rows={7}
            value={style.promptDescription}
            onChange={(event) => patch({ promptDescription: event.target.value })}
            className="font-mono text-xs leading-relaxed"
          />
        </Field>
      </section>

      <section className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-800">
              Transparent inset artwork
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
              Remove the background when the active image model supports it.
              Covers and full-page artwork remain opaque.
            </p>
          </div>
          <Toggle
            label="Transparent inset artwork"
            checked={style.generationHints.background === "prefer-transparent"}
            onChange={(checked) =>
              patch({
                generationHints: checked
                  ? { ...style.generationHints, background: "prefer-transparent" }
                  : {},
              })
            }
          />
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-ink-800">
            {style.enabled ? "Available to customers" : "Removed from customer choices"}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            Existing books keep this style even when it is removed from new choices.
          </p>
        </div>
        <Button
          variant={style.enabled ? "ghost" : "secondary"}
          size="sm"
          leftIcon={
            style.enabled ? <EyeOff className="size-4" /> : <Eye className="size-4" />
          }
          onClick={() => patch({ enabled: !style.enabled })}
        >
          {style.enabled ? "Remove style" : "Restore style"}
        </Button>
      </section>
    </div>
  );
}

export function ArtStylesTab() {
  const stored = useAppConfigStore((state) => state.artStyles);
  const save = useAppConfigStore((state) => state.saveArtStyles);
  const [draft, setDraft] = useState<ArtStylesConfig>(stored);
  const [selectedId, setSelectedId] = useState(
    () => resolveArtStyles(stored, { includeDisabled: true })[0]?.id ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const styles = useMemo(
    () => resolveArtStyles(draft, { includeDisabled: true }),
    [draft],
  );
  const selected = styles.find((style) => style.id === selectedId) ?? styles[0];
  const dirty = useMemo(
    () => JSON.stringify(normalizeOrders(draft)) !== JSON.stringify(normalizeOrders(stored)),
    [draft, stored],
  );

  useEffect(() => {
    if (!dirty) setDraft(stored);
  }, [dirty, stored]);

  useEffect(() => {
    if (!selected && styles[0]) setSelectedId(styles[0].id);
  }, [selected, styles]);

  const persist = async (next = draft) => {
    setSaving(true);
    try {
      const saved = await save(normalizeOrders(next));
      setDraft(saved);
      toast.success("Art styles saved.");
      return saved;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save art styles.");
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updateStyle = (next: ArtStyleDefinition) => {
    setDraft((current) => ({
      ...current,
      styles: current.styles.map((style) => (style.id === next.id ? next : style)),
    }));
  };

  const moveStyle = (id: string, direction: -1 | 1) => {
    const ordered = resolveArtStyles(draft, { includeDisabled: true });
    const index = ordered.findIndex((style) => style.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setDraft({
      version: 2,
      styles: ordered.map((style, order) => ({ ...style, order })),
    });
  };

  const addStyle = async () => {
    const label = newName.trim();
    if (!label) return;
    const now = Date.now();
    const id = styleId(new Set(styles.map((style) => style.id)), label);
    const next: ArtStylesConfig = {
      version: 2,
      styles: [
        ...styles,
        {
          id,
          label,
          description: "",
          promptDescription: `Children's picture-book illustration in a ${label} style.`,
          enabled: false,
          order: styles.length,
          examples: [],
          generationHints: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const saved = await persist(next);
    if (!saved) return;
    setSelectedId(id);
    setNewName("");
    setAdding(false);
    toast.info("Add pictures and review the drawing prompt before restoring this style.");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="font-display text-xl font-bold text-ink-900">Art styles</h1>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Manage the looks customers compare after writing their story. Order
            controls the picker; removed styles remain available to existing books.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Plus className="size-4" />}
            onClick={() => setAdding(true)}
          >
            Add style
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!dirty}
            onClick={() => void persist()}
          >
            Save changes
          </Button>
        </div>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-2xl border border-brand-200 bg-brand-50/50 p-3 sm:flex-row sm:items-end">
          <Field label="New style title" className="min-w-0 flex-1">
            <Input
              autoFocus
              value={newName}
              placeholder="For example, Ink and Gouache"
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addStyle();
                if (event.key === "Escape") setAdding(false);
              }}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={saving}
              disabled={!newName.trim()}
              onClick={() => void addStyle()}
            >
              Create style
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="self-start rounded-2xl border border-ink-200 bg-white p-2 lg:sticky lg:top-4">
          <div className="max-h-[72vh] space-y-1 overflow-y-auto">
            {styles.map((style, index) => {
              const preview = style.examples[0];
              return (
                <div
                  key={style.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl p-1.5 transition",
                    selected?.id === style.id
                      ? "bg-brand-50 ring-1 ring-inset ring-brand-200"
                      : "hover:bg-ink-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(style.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <span className="aspect-4/3 w-14 shrink-0 overflow-hidden rounded-md bg-ink-100">
                      {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview.imageUrl}
                          alt=""
                          className="size-full object-cover"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-800">
                        {style.label}
                      </span>
                      <span className="block text-[11px] text-ink-500">
                        {style.enabled ? "Available" : "Removed"} ·{" "}
                        {style.examples.length} picture
                        {style.examples.length === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                  <span className="flex shrink-0 flex-col opacity-50 transition group-hover:opacity-100">
                    <button
                      type="button"
                      disabled={index === 0}
                      aria-label={`Move ${style.label} up`}
                      onClick={() => moveStyle(style.id, -1)}
                      className="rounded p-1 text-ink-500 hover:bg-white disabled:opacity-20"
                    >
                      <ArrowUp className="size-3" />
                    </button>
                    <button
                      type="button"
                      disabled={index === styles.length - 1}
                      aria-label={`Move ${style.label} down`}
                      onClick={() => moveStyle(style.id, 1)}
                      className="rounded p-1 text-ink-500 hover:bg-white disabled:opacity-20"
                    >
                      <ArrowDown className="size-3" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </aside>

        {selected ? (
          <StyleEditor style={selected} onChange={updateStyle} />
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-ink-300 text-sm text-ink-500">
            Add a style to begin.
          </div>
        )}
      </div>
    </div>
  );
}
