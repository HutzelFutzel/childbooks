import { useState } from "react";
import { GitBranch, RefreshCw, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import type { Anchor } from "../../core/types";
import { selectVersion, allVersions } from "../../core/versioning";
import { changedAnchorsForAnchor, generateAnchorVersion, staleAnchorIds } from "../../state/ai";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { ImagePreview } from "../components/ImagePreview";
import { Tabs } from "../components/Tabs";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { formatList } from "../lib/formatList";
import { notify } from "../lib/notify";
import { RelationsEditor } from "./RelationsEditor";

export function AnchorEditor({
  anchor,
  generating,
  setGenerating,
}: {
  anchor: Anchor;
  generating: boolean;
  setGenerating: (v: boolean) => void;
}) {
  const updateAnchor = useProjectsStore((s) => s.updateAnchor);
  const project = useProjectsStore((s) => s.current());
  const [edit, setEdit] = useState("");

  const isStale = Boolean(project && anchor.versions && staleAnchorIds(project).includes(anchor.id));
  const changedRefs = project && isStale ? changedAnchorsForAnchor(project, anchor.id) : [];
  const cursorId = anchor.versions?.cursorId;
  const cursorNode = cursorId ? anchor.versions!.nodes[cursorId] : undefined;
  const cursorUrl = useBlobUrl(cursorNode?.content.blobId);
  const hasImage = Boolean(anchor.versions);
  const versions = anchor.versions ? allVersions(anchor.versions) : [];

  async function generate(options: Parameters<typeof generateAnchorVersion>[1] = {}) {
    setGenerating(true);
    try {
      await generateAnchorVersion(anchor.id, options);
      notify.success(hasImage ? "New version created" : "Reference generated");
      setEdit("");
    } catch (err) {
      notify.error(err);
    } finally {
      setGenerating(false);
    }
  }

  function selectVer(id: string) {
    if (!anchor.versions) return;
    void updateAnchor(anchor.id, { versions: selectVersion(anchor.versions, id) });
  }

  return (
    <div className="space-y-5">
      <ImagePreview
        src={cursorUrl}
        loading={generating}
        aspect={1}
        emptyLabel="No image yet — generate below"
      />

      {isStale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs text-amber-800">
            <RefreshCw className="size-3.5 shrink-0" />
            {changedRefs.length > 0
              ? `${formatList(changedRefs.map((a) => a.name))} changed since this was generated.`
              : "A referenced character or object changed since this was generated."}
          </span>
          <Button
            size="sm"
            loading={generating}
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => void generate({ useReference: true })}
          >
            Update
          </Button>
        </div>
      )}

      {/* Version history */}
      {versions.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-ink-500">
            Version history — click to revert or branch from any point
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {versions.map((node, i) => (
              <VersionThumb
                key={node.id}
                blobId={node.content.blobId}
                index={i + 1}
                active={node.id === cursorId}
                onClick={() => selectVer(node.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Design controls */}
      <div className="space-y-3 border-t border-ink-100 pt-4">
        <Tabs
          className="w-full"
          value={anchor.mode}
          onChange={(v) => void updateAnchor(anchor.id, { mode: v as Anchor["mode"] })}
          items={[
            { id: "creative", label: "Let AI design" },
            { id: "describe", label: "I'll describe it" },
          ]}
        />

        {anchor.mode === "describe" && (
          <Field label="Your description" hint="Guides how this character or place should look.">
            <Textarea
              value={anchor.userGuidance ?? ""}
              onChange={(e) => void updateAnchor(anchor.id, { userGuidance: e.target.value })}
              rows={3}
              placeholder="e.g. a small round robot with a brass body, big blue eyes, one dented antenna…"
            />
          </Field>
        )}

        {!hasImage ? (
          <Button
            className="w-full"
            loading={generating}
            leftIcon={<Sparkles className="size-4" />}
            onClick={() => void generate()}
          >
            Generate reference sheet
          </Button>
        ) : (
          <div className="space-y-3">
            <Field label="Refine this version">
              <Input
                value={edit}
                onChange={(e) => setEdit(e.target.value)}
                placeholder="e.g. make her smile, add a red scarf…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && edit.trim() && !generating) {
                    void generate({ edit, useReference: true });
                  }
                }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                loading={generating}
                leftIcon={<GitBranch className="size-4" />}
                disabled={!edit.trim()}
                onClick={() => void generate({ edit, useReference: true })}
              >
                Apply edit
              </Button>
              <Button
                variant="secondary"
                loading={generating}
                leftIcon={<RotateCcw className="size-4" />}
                onClick={() => void generate({ useReference: false })}
              >
                Regenerate
              </Button>
            </div>
            <Button
              variant="ghost"
              className="w-full"
              loading={generating}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void generate({ useReference: true })}
            >
              Variation (keep likeness)
            </Button>
          </div>
        )}
      </div>

      <RelationsEditor
        anchor={anchor}
        all={project?.anchors ?? []}
        onChange={(patch) => void updateAnchor(anchor.id, patch)}
      />
    </div>
  );
}

function VersionThumb({
  blobId,
  index,
  active,
  onClick,
}: {
  blobId: string;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  const url = useBlobUrl(blobId);
  return (
    <button
      onClick={onClick}
      className={`relative size-16 shrink-0 overflow-hidden rounded-lg ring-2 transition ${
        active ? "ring-brand-500" : "ring-transparent hover:ring-ink-200"
      }`}
    >
      {url ? (
        <img src={url} alt={`Version ${index}`} className="size-full object-cover" />
      ) : (
        <div className="size-full bg-ink-100" />
      )}
      <span className="absolute bottom-0 right-0 rounded-tl bg-ink-900/60 px-1 text-[10px] text-white">
        {index}
      </span>
    </button>
  );
}
