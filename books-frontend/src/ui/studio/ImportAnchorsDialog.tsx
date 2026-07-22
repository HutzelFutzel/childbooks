/**
 * Character transfer — import anchors (characters / places / objects) from
 * another of the user's projects into the current one, including their current
 * reference art. A gateable feature ("characterTransfer"): fully configurable
 * via the admin Plans tab (see `core/config/features`).
 *
 * Imported anchors get fresh ids and a fresh single-version image tree whose
 * blob is COPIED (version blobs are project-exclusive; sharing an id across
 * projects would let one project's GC delete the other's image).
 */
import { useMemo, useState } from "react";
import { ArrowLeft, UserPlus } from "lucide-react";
import type { Anchor, Project } from "../../core/types";
import { createVersionTree } from "../../core/versioning";
import { currentAnchorImage } from "../../state/ai";
import { copyBlob } from "../../state/blobs";
import { useProjectsStore } from "../../state/projectsStore";
import { AnchorCard } from "../anchors/AnchorCard";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function ImportAnchorsDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
}) {
  const projects = useProjectsStore((s) => s.projects);
  const setAnchors = useProjectsStore((s) => s.setAnchors);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const sources = useMemo(
    () => projects.filter((p) => p.id !== project.id && (p.anchors?.length ?? 0) > 0),
    [projects, project.id],
  );
  const source = sources.find((p) => p.id === sourceId) ?? null;

  function reset() {
    setSourceId(null);
    setPicked(new Set());
  }

  function toggle(anchorId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  }

  async function runImport() {
    if (!source) return;
    const targets = (source.anchors ?? []).filter((a) => picked.has(a.id));
    if (targets.length === 0) return;
    setImporting(true);
    try {
      const imported: Anchor[] = [];
      for (const anchor of targets) {
        const image = currentAnchorImage(anchor);
        // Copy only the CURRENT image version — history stays with the source.
        let versions: Anchor["versions"];
        if (image) {
          const blobId = await copyBlob(image.blobId);
          if (blobId) {
            versions = createVersionTree(
              { blobId, mimeType: image.mimeType },
              { label: `Imported from “${source.title}”` },
            );
          }
        }
        imported.push({
          ...anchor,
          id: newId(),
          // Relations reference source-project anchor ids that don't exist here
          // (clear the notes too, since they're keyed by those same dead ids).
          containedIds: undefined,
          relatedIds: undefined,
          relatedNotes: undefined,
          versions,
        });
      }
      await setAnchors([...(project.anchors ?? []), ...imported]);
      notify.success(
        "Characters imported",
        `${imported.length} ${imported.length === 1 ? "reference" : "references"} added from “${source.title}”.`,
      );
      reset();
      onClose();
    } catch (err) {
      notify.error(err);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={source ? `Import from “${source.title}”` : "Import characters"}
      size="max-w-2xl"
      footer={
        source ? (
          <>
            <Button variant="ghost" size="sm" leftIcon={<ArrowLeft className="size-3.5" />} onClick={reset}>
              Back
            </Button>
            <Button
              size="sm"
              loading={importing}
              disabled={picked.size === 0}
              leftIcon={!importing ? <UserPlus className="size-4" /> : undefined}
              onClick={() => void runImport()}
            >
              Import {picked.size > 0 ? picked.size : ""} selected
            </Button>
          </>
        ) : undefined
      }
    >
      {!source ? (
        sources.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">
            No other projects with characters yet. Create another book first, then transfer its cast
            here.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">
              Pick the book to bring characters, places or objects from. Their reference art comes
              along, so they look the same in this story.
            </p>
            {sources.map((p) => (
              <button
                key={p.id}
                onClick={() => setSourceId(p.id)}
                className="flex w-full items-center justify-between rounded-xl border border-ink-100 bg-white px-4 py-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-800">{p.title}</span>
                  <span className="text-xs text-ink-400">
                    {(p.anchors ?? []).filter((a) => a.include).length} references
                  </span>
                </span>
                <UserPlus className="size-4 shrink-0 text-ink-300" />
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
          {(source.anchors ?? [])
            .filter((a) => a.include)
            .map((anchor) => (
              <AnchorCard
                key={anchor.id}
                anchor={anchor}
                selected={picked.has(anchor.id)}
                onClick={() => toggle(anchor.id)}
              />
            ))}
        </div>
      )}
    </Modal>
  );
}