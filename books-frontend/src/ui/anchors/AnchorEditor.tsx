import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { Anchor } from "../../core/types";
import type { ImageTier } from "../../core/config/modelConfig";
import { layoutOf, sheetAspect, sheetSpecFor } from "../../core/pipeline/anchorLayout";
import { allVersions, getCursor, selectVersion } from "../../core/versioning";
import { changedAnchorsForAnchor, staleAnchorIds } from "../../state/ai";
import { useJobsStore } from "../../state/jobsStore";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { FastDraftBadge } from "../components/FastDraftBadge";
import { FastDraftBanner } from "../components/FastDraftBanner";
import { Field, Input, Textarea } from "../components/Input";
import { ImagePreview } from "../components/ImagePreview";
import { Modal } from "../components/Modal";
import { Select } from "../components/Select";
import { VersionHistoryList } from "../components/VersionHistoryList";
import { SparkEstimateCost, useImageActionRange } from "../layout/SparkCost";
import { useBlobUrlState } from "../hooks/useBlobUrl";
import { formatList } from "../lib/formatList";
import { notify } from "../lib/notify";
import { generateAnchorViaJob } from "../studio/studioGen";
import { ANCHOR_TYPE_ICON } from "./AnchorCard";

/**
 * Optional Cast refinement drawer.
 *
 * The image and one small-change field stay visible. Foundational details,
 * version history, redesign, and removal are disclosed only when requested.
 */
export function AnchorEditor({
  anchor,
  generating: generatingProp,
  setGenerating,
  onRemoved,
}: {
  anchor: Anchor;
  generating: boolean;
  setGenerating: (value: boolean) => void;
  onRemoved?: () => void;
}) {
  const updateAnchor = useProjectsStore((state) => state.updateAnchor);
  const renameAnchor = useProjectsStore((state) => state.renameAnchor);
  const removeAnchor = useProjectsStore((state) => state.removeAnchor);
  const deleteAnchorVersion = useProjectsStore((state) => state.deleteAnchorVersion);
  const project = useProjectsStore((state) => state.current());
  const jobActive = useJobsStore((state) => state.activeUnitIds.has(anchor.id));
  const generating = generatingProp || jobActive;

  const [edit, setEdit] = useState("");
  const [name, setName] = useState(anchor.name);
  const [age, setAge] = useState(String(anchor.ageYears ?? 6));
  const [description, setDescription] = useState(anchor.description);
  const [userGuidance, setUserGuidance] = useState(anchor.userGuidance ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVersionId, setConfirmVersionId] = useState<string | null>(null);

  useEffect(() => setName(anchor.name), [anchor.id, anchor.name]);
  useEffect(() => setAge(String(anchor.ageYears ?? 6)), [anchor.id, anchor.ageYears]);
  useEffect(() => setDescription(anchor.description), [anchor.id, anchor.description]);
  useEffect(() => setUserGuidance(anchor.userGuidance ?? ""), [anchor.id, anchor.userGuidance]);

  const cursorId = anchor.versions?.cursorId;
  const cursorNode = cursorId ? anchor.versions?.nodes[cursorId] : undefined;
  const { url: cursorUrl, status: cursorStatus } = useBlobUrlState(cursorNode?.content.blobId);
  const fallbackLayout = layoutOf(sheetSpecFor(anchor));
  const cursorAspect = sheetAspect(cursorNode?.content.layout ?? fallbackLayout);
  const versions = anchor.versions ? allVersions(anchor.versions) : [];
  const hasImage = Boolean(anchor.versions);
  const sparkRange = useImageActionRange("anchorImage");
  const TypeIcon = ANCHOR_TYPE_ICON[anchor.type];

  const isStale = Boolean(project && anchor.versions && staleAnchorIds(project).includes(anchor.id));
  const changedRefs = project && isStale ? changedAnchorsForAnchor(project, anchor.id) : [];
  const selfChanged = changedRefs.some((candidate) => candidate.id === anchor.id);
  const otherChangedRefs = changedRefs.filter((candidate) => candidate.id !== anchor.id);

  async function generate(
    options: { edit?: string; useReference?: boolean; tier?: ImageTier } = {},
  ) {
    if (!project) return;
    setGenerating(true);
    const started = await generateAnchorViaJob(
      project,
      anchor.id,
      options,
      (error) => notify.error(error),
      () => setGenerating(false),
    );
    if (started) {
      setEdit("");
    } else {
      setGenerating(false);
    }
  }

  function dependentPageCount(): number {
    if (!project) return 0;
    return Object.values(project.illustrations ?? {}).filter((tree) =>
      (getCursor(tree).content.references ?? []).some(
        (usage) => usage.anchorId === anchor.id && !usage.textOnly,
      ),
    ).length;
  }

  function applyVersion(id: string) {
    if (!anchor.versions) return;
    void updateAnchor(anchor.id, { versions: selectVersion(anchor.versions, id) });
  }

  function selectVersionSafely(id: string) {
    if (!anchor.versions || id === cursorId) return;
    if (dependentPageCount() > 0) setConfirmVersionId(id);
    else applyVersion(id);
  }

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(anchor.name);
      return;
    }
    if (trimmed !== anchor.name) void renameAnchor(anchor.id, trimmed);
  }

  function commitAge() {
    const parsed = Math.min(120, Math.max(0, Number(age)));
    if (Number.isFinite(parsed) && parsed !== anchor.ageYears) {
      void updateAnchor(anchor.id, { ageYears: parsed, ageSource: "author" });
      setAge(String(parsed));
    } else {
      setAge(String(anchor.ageYears ?? 6));
    }
  }

  const staleReason =
    selfChanged && otherChangedRefs.length > 0
      ? `The details and ${formatList(otherChangedRefs.map((item) => item.name))} changed.`
      : selfChanged
        ? "The details changed after this look was created."
        : otherChangedRefs.length > 0
          ? `${formatList(otherChangedRefs.map((item) => item.name))} changed.`
          : "A linked visual reference changed.";

  return (
    <>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="relative overflow-hidden rounded-2xl bg-white p-2 shadow-soft ring-1 ring-ink-100">
          <ImagePreview
            src={cursorUrl}
            loading={generating}
            loadingAction="anchorImage"
            refCount={anchor.containedIds?.length ?? 0}
            aspect={cursorAspect}
            className="rounded-xl"
            emptyLabel={
              cursorStatus === "error" || cursorStatus === "missing"
                ? "This image couldn't be loaded"
                : "This look will be created with the rest of your cast"
            }
          />
          {cursorNode?.content.imageTier === "quick" && <FastDraftBadge />}
        </div>

        {isStale && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">This look is out of date</p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{staleReason}</p>
            <Button
              className="mt-2 w-full"
              size="sm"
              variant="secondary"
              loading={generating}
              leftIcon={<RefreshCw className="size-4" />}
              onClick={() => void generate({ useReference: true })}
            >
              Update look
            </Button>
          </div>
        )}

        {cursorNode?.content.imageTier === "quick" && (
          <FastDraftBanner
            upgrading={generating}
            onUpgrade={() => void generate({ useReference: true, tier: "premium" })}
          />
        )}

        {hasImage && (
          <div>
            <Field
              label="Small change"
              hint="Keeps the same character while adjusting one detail."
            >
              <Input
                value={edit}
                onChange={(event) => setEdit(event.target.value)}
                placeholder="Bigger smile, red scarf…"
                disabled={generating}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && edit.trim() && !generating) {
                    void generate({ edit, useReference: true });
                  }
                }}
              />
            </Field>
            <Button
              className="mt-2 w-full"
              variant="secondary"
              loading={generating}
              disabled={!edit.trim()}
              leftIcon={<Sparkles className="size-4" />}
              onClick={() => void generate({ edit, useReference: true })}
            >
              Apply change
              <SparkEstimateCost range={sparkRange} action="anchorImage" />
            </Button>
          </div>
        )}

        <details className="group rounded-xl border border-ink-100 bg-ink-50/60">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-sm font-semibold text-ink-700">
            Character details
            <ChevronDown className="size-4 text-ink-400 transition group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-ink-100 bg-white px-3.5 py-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Type">
                <Select
                  value={anchor.type}
                  onChange={(event) =>
                    void updateAnchor(anchor.id, {
                      type: event.target.value as Anchor["type"],
                      bodyPlan:
                        event.target.value === "character"
                          ? (anchor.bodyPlan ?? "bipedal")
                          : undefined,
                    })
                  }
                  options={[
                    { value: "character", label: "Character" },
                    { value: "place", label: "Place" },
                    { value: "object", label: "Object" },
                  ]}
                />
              </Field>
              {anchor.type === "character" && (
                <Field label="Age">
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={age}
                    onChange={(event) => {
                      setAge(event.target.value);
                      const num = Number(event.target.value);
                      if (event.target.value !== "" && Number.isFinite(num)) {
                        const clamped = Math.min(120, Math.max(0, num));
                        if (clamped !== anchor.ageYears) {
                          void updateAnchor(anchor.id, { ageYears: clamped, ageSource: "author" });
                        }
                      }
                    }}
                    onBlur={commitAge}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </Field>
              )}
            </div>

            <Field
              label="Visual description"
              hint="Appearance only — age is controlled by the Age field."
            >
              <Textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  void updateAnchor(anchor.id, {
                    description: event.target.value,
                    descriptionUserEdited: true,
                  });
                }}
                rows={4}
                placeholder="What should stay recognizable on every page?"
              />
            </Field>

            <Field label="Extra direction" hint="Optional">
              <Textarea
                value={userGuidance}
                onChange={(event) => {
                  setUserGuidance(event.target.value);
                  void updateAnchor(anchor.id, { userGuidance: event.target.value });
                }}
                rows={2}
                placeholder="A detail the story does not mention…"
              />
            </Field>

            {hasImage && (
              <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
                <p className="text-xs font-semibold text-ink-700">Start over from these details</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                  This creates a fundamentally different design instead of preserving the current
                  character.
                </p>
                <Button
                  className="mt-2 w-full"
                  size="sm"
                  variant="ghost"
                  loading={generating}
                  onClick={() => void generate({ useReference: false })}
                >
                  Redesign
                  <SparkEstimateCost range={sparkRange} action="anchorImage" />
                </Button>
              </div>
            )}
          </div>
        </details>

        {versions.length > 1 && (
          <details className="group rounded-xl border border-ink-100 bg-ink-50/60">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-3 text-sm font-semibold text-ink-700">
              Previous versions
              <ChevronDown className="size-4 text-ink-400 transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-ink-100 bg-white p-3.5">
              <VersionHistoryList
                items={versions.map((node, index) => ({
                  id: node.id,
                  blobId: node.content.blobId,
                  index: index + 1,
                  aspect: sheetAspect(node.content.layout ?? fallbackLayout),
                }))}
                activeId={cursorId}
                onSelect={selectVersionSafely}
                onDelete={(id) => void deleteAnchorVersion(anchor.id, id)}
              />
            </div>
          </details>
        )}

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-xs font-medium text-ink-400 hover:text-ink-600">
            <ChevronDown className="size-3.5 transition group-open:rotate-180" />
            More options
          </summary>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"
          >
            <Trash2 className="size-3.5" />
            Remove from cast
          </button>
        </details>

        {!hasImage && (
          <div className="rounded-xl bg-brand-50 px-3.5 py-3 text-xs leading-relaxed text-brand-800 ring-1 ring-brand-100">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <TypeIcon className="size-3.5" />
              Ready with the rest
            </span>
            <p className="mt-1 text-brand-700">
              Close this panel and use Create my cast to make every missing look together.
            </p>
          </div>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Remove ${anchor.name}?`}
        size="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmDelete(false);
                onRemoved?.();
                void removeAnchor(anchor.id);
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          This removes the reference and its artwork. Pages already illustrated with it keep their
          current images.
        </p>
      </Modal>

      <Modal
        open={confirmVersionId !== null}
        onClose={() => setConfirmVersionId(null)}
        title="Use this earlier version?"
        size="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmVersionId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (confirmVersionId) applyVersion(confirmVersionId);
                setConfirmVersionId(null);
              }}
            >
              Use version
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-600">
          {dependentPageCount()} existing page{dependentPageCount() === 1 ? "" : "s"} will be marked
          for an update so the character stays consistent.
        </p>
      </Modal>
    </>
  );
}
