/**
 * First-run style gate when the story cast already has character drawings.
 * Extracts a book look in the background. Compatible drawings skip the preset
 * grid; a clash asks whose look the book should use.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ArtStyleSelection } from "../../core/types";
import { collectSourceArtGroups, derivedStyleSelection } from "../../core/book/sourceArt";
import { extractArtStyleRemote } from "../../platform/aiClient";
import { Button } from "../components/Button";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";

export function ArtworkLookGate({
  onResolved,
  onFailed,
}: {
  onResolved: (style: ArtStyleSelection) => void | Promise<void>;
  onFailed: () => void;
}) {
  const { project } = useStudio();
  const groups = collectSourceArtGroups(project);
  const [phase, setPhase] = useState<"extracting" | "conflict">("extracting");
  const [options, setOptions] = useState<
    { id: string; name: string; stylePrompt: string; thumbBlobId?: string }[]
  >([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const result = await extractArtStyleRemote(project);
        if (cancelled || cancelledRef.current) return;
        const extractedNames = result.characters.map((character) => character.name).filter(Boolean);
        if (result.compatible && result.stylePrompt.trim()) {
          await onResolved(
            derivedStyleSelection({
              stylePrompt: result.stylePrompt,
              derivedFromNames: extractedNames.length > 0 ? extractedNames : groups.map((group) => group.name),
            }),
          );
          return;
        }
        const thumbs = new Map(
          groups.map((group) => [group.id, group.images[0]?.blobId] as const),
        );
        const next = result.characters.map((character) => ({
          ...character,
          thumbBlobId: thumbs.get(character.id),
        }));
        if (cancelled || cancelledRef.current) return;
        if (next.length < 2) {
          const prompt = next[0]?.stylePrompt || result.stylePrompt;
          if (!prompt.trim()) {
            onFailed();
            return;
          }
          await onResolved(
            derivedStyleSelection({
              stylePrompt: prompt,
              derivedFromNames: extractedNames.length > 0 ? extractedNames : groups.map((group) => group.name),
            }),
          );
          return;
        }
        setOptions(next);
        setPickedId(next[0]?.id ?? null);
        setPhase("conflict");
      } catch (err) {
        if (cancelled || cancelledRef.current) return;
        notify.info(
          "Choose an art style",
          err instanceof Error
            ? err.message
            : "We couldn’t read a look from the uploaded artwork.",
        );
        onFailed();
      }
    })();
    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
    // Run once for this first-time visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  if (phase === "extracting") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-ink-50/30 px-6">
        <Loader2 className="size-6 animate-spin text-brand-600" />
        <h1 className="mt-4 font-display text-xl font-semibold text-ink-900">
          Matching the book to your artwork
        </h1>
        <p className="mt-1.5 max-w-sm text-center text-sm leading-relaxed text-ink-500">
          We’ll keep your characters as they are and use their look for the rest of the book.
        </p>
      </div>
    );
  }

  async function confirmLook() {
    const picked = options.find((option) => option.id === pickedId) ?? options[0];
    if (!picked) return;
    if (cancelledRef.current) return;
    setBusy(true);
    try {
      if (cancelledRef.current) return;
      await onResolved(
        derivedStyleSelection({
          stylePrompt: picked.stylePrompt,
          derivedFromName: picked.name,
          derivedFromNames: [picked.name],
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-ink-50/30">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-ink-900">Choose the book’s look</h1>
          <p className="mt-0.5 hidden text-sm text-ink-500 sm:block">
            These characters use different art styles. Choose one look for the whole book.
          </p>
        </div>
        <Button size="sm" loading={busy} disabled={!pickedId} onClick={() => void confirmLook()}>
          Use this look
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-xl space-y-4">
          <p className="text-sm leading-relaxed text-ink-500 sm:hidden">
            These characters use different art styles. Choose one look for the whole book.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {options.map((option) => (
              <LookChoice
                key={option.id}
                name={option.name}
                thumbBlobId={option.thumbBlobId}
                selected={pickedId === option.id}
                onSelect={() => setPickedId(option.id)}
              />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-ink-400">
            Every character keeps their design, clothing and colours. Only the drawing style will
            be matched.
          </p>
        </div>
      </div>
    </div>
  );
}

function LookChoice({
  name,
  thumbBlobId,
  selected,
  onSelect,
}: {
  name: string;
  thumbBlobId?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { url } = useBlobUrlState(thumbBlobId);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-white p-3 text-left shadow-soft ring-1 transition",
        selected ? "ring-2 ring-brand-500" : "ring-ink-100 hover:ring-brand-300",
      )}
    >
      <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-ink-100">
        {url ? <img src={url} alt="" className="size-full object-cover" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink-900">{name}’s look</span>
      </span>
    </button>
  );
}
