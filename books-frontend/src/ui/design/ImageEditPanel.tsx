/**
 * Docked Canva-style edit sheets for page illustrations. Everyday actions live
 * on the floating ImageStyleBar; deep controls (refine, cast, scene, versions,
 * effects) open here. Cover-specific options nest inside Refine when on a cover.
 */
import { useEffect, useMemo, useState } from "react";
import { MapPin, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import type { Anchor, ImageElement } from "../../core/types";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Field, Input, Textarea } from "../components/Input";
import { VersionThumb } from "../components/VersionThumb";
import { Badge } from "../components/Badge";
import { InfoHint } from "../components/InfoHint";
import { SparkEstimateCost } from "../layout/SparkCost";
import { formatList } from "../lib/formatList";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { anchorThumbBlobId } from "../../state/ai";
import { EffectsControls } from "./EffectsControls";
import { AlignPad, type AlignEdge, Section, Slider } from "./inspectorKit";
import { CoverToolsPanel } from "../studio/CoverStudio";
import { usePageIllustration } from "../studio/usePageIllustration";
import { useStudio } from "../studio/StudioContext";
import { cn } from "../lib/cn";

function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

const SCENE_BRIEF_PLACEHOLDER =
  "Ava peeks under the bed; warm lantern light; curious, not scared";

export type ImageEditSection =
  | "refine"
  | "characters"
  | "scene"
  | "versions"
  | "effects"
  | "frame";

export function ImageEditPanel({
  pageId,
  image,
  section,
  onPatch,
  onGestureEnd,
  onAlign,
}: {
  pageId: string;
  image: ImageElement;
  section: ImageEditSection;
  onPatch: (patch: Partial<ImageElement>, opts?: { coalesce?: string }) => void;
  onGestureEnd: () => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  const illo = usePageIllustration(pageId);
  const isIllustration = image.kind === "illustration";

  if (section === "effects") {
    return (
      <div className="p-4">
        <EffectsControls
          effects={image.effects}
          showOpacity
          onChange={(effects, meta) =>
            onPatch(
              { effects },
              meta?.coalesce ? { coalesce: `effects-${image.id}` } : undefined,
            )
          }
          onGestureEnd={onGestureEnd}
        />
      </div>
    );
  }

  if (section === "frame") {
    return (
      <FrameSection
        image={image}
        onPatch={onPatch}
        onGestureEnd={onGestureEnd}
        onAlign={onAlign}
      />
    );
  }

  if (!isIllustration || !illo.subject || illo.blank) {
    return (
      <p className="p-4 text-xs leading-relaxed text-ink-400">
        These controls are for AI page illustrations.
      </p>
    );
  }

  if (section === "refine") {
    return <RefineSection illo={illo} />;
  }
  if (section === "characters") {
    return <CharactersSection illo={illo} />;
  }
  if (section === "scene") {
    return <SceneSection illo={illo} />;
  }
  if (section === "versions") {
    return <VersionsSection illo={illo} />;
  }

  return null;
}

function FrameSection({
  image,
  onPatch,
  onGestureEnd,
  onAlign,
}: {
  image: ImageElement;
  onPatch: (patch: Partial<ImageElement>, opts?: { coalesce?: string }) => void;
  onGestureEnd: () => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  const coalesce = (key: string) => ({ coalesce: `${key}-${image.id}` });
  const isFill = image.fit !== "contain";
  const zoom = Math.max(1, image.zoom ?? 1);
  const focus = image.focus ?? { x: 0.5, y: 0.5 };
  const softFill =
    (image.fitBackdrop ?? (image.kind === "illustration" ? "blur" : "none")) === "blur";

  return (
    <div className="space-y-4 p-4">
      <Section title="Fit">
        <div className="inline-flex rounded-lg border border-ink-200">
          {(
            [
              {
                id: "cover" as const,
                label: "Fill",
                hint: "Fills the frame — double-click or use Position to drag which part shows",
              },
              {
                id: "contain" as const,
                label: "Fit",
                hint: "Shows the whole picture — choose how leftover bars look below",
              },
            ] as const
          ).map((opt, i) => (
            <button
              key={opt.id}
              title={opt.hint}
              onClick={() => onPatch({ fit: opt.id })}
              className={cn(
                "px-3 py-1.5 text-xs transition first:rounded-l-lg last:rounded-r-lg",
                i > 0 && "border-l border-ink-200",
                (image.fit === opt.id || (opt.id === "cover" && isFill))
                  ? "bg-brand-50 text-brand-700"
                  : "text-ink-600 hover:bg-ink-50",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
          {isFill
            ? "Fills the frame — edges may be cropped. Use Position on the toolbar to drag the picture."
            : "Shows the whole picture. Leftover bars can be soft-filled or left clear."}
        </p>
        <Slider
          label="Corners"
          min={0}
          max={0.5}
          step={0.02}
          value={image.corner ?? 0}
          onChange={(corner) => onPatch({ corner: corner || undefined }, coalesce("corner"))}
          onGestureEnd={onGestureEnd}
        />
      </Section>
      {!isFill && (
        <Section title="Leftover space">
          <div className="inline-flex rounded-lg border border-ink-200">
            {(
              [
                { id: "blur" as const, label: "Soft fill", hint: "Blurred zoom of the picture" },
                { id: "none" as const, label: "Transparent", hint: "Page shows through" },
              ] as const
            ).map((opt, i) => (
              <button
                key={opt.id}
                title={opt.hint}
                onClick={() => onPatch({ fitBackdrop: opt.id })}
                className={cn(
                  "px-3 py-1.5 text-xs transition first:rounded-l-lg last:rounded-r-lg",
                  i > 0 && "border-l border-ink-200",
                  (opt.id === "blur" ? softFill : !softFill)
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-600 hover:bg-ink-50",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Section>
      )}
      {isFill && (
        <Section title="Framing">
          <p className="mb-2 text-[11px] leading-snug text-ink-400">
            Drag the picture in Position mode, or nudge with these sliders.
          </p>
          <Slider
            label="Zoom"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(z) => onPatch({ zoom: z <= 1.001 ? undefined : z }, coalesce("zoom"))}
            onGestureEnd={onGestureEnd}
            format={(z) => `${z.toFixed(1)}×`}
          />
          <Slider
            label="Left ↔ Right"
            min={0}
            max={1}
            step={0.02}
            value={focus.x}
            onChange={(x) => onPatch({ focus: { x, y: focus.y } }, coalesce("focus"))}
            onGestureEnd={onGestureEnd}
            format={(v) => `${Math.round(v * 100)}`}
          />
          <Slider
            label="Up ↕ Down"
            min={0}
            max={1}
            step={0.02}
            value={focus.y}
            onChange={(y) => onPatch({ focus: { x: focus.x, y } }, coalesce("focus"))}
            onGestureEnd={onGestureEnd}
            format={(v) => `${Math.round(v * 100)}`}
          />
        </Section>
      )}
      <Section title="Position on page">
        <AlignPad onAlign={onAlign} />
      </Section>
    </div>
  );
}

function RefineSection({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const [coverTab, setCoverTab] = useState<"picture" | "cover">("picture");
  const { coverMode, intentPick, setIntentPick, generating, applyIntentPick } = illo;

  return (
    <div className="flex flex-col">
      {coverMode && (
        <div className="flex gap-1 border-b border-ink-100 px-3 pt-3">
          {(
            [
              { id: "picture" as const, label: "Picture" },
              { id: "cover" as const, label: "Cover" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setCoverTab(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-semibold transition",
                coverTab === tab.id
                  ? "border-brand-500 text-brand-700"
                  : "border-transparent text-ink-400 hover:text-ink-700",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {coverMode && coverTab === "cover" ? (
        <div className="p-4">
          <CoverToolsPanel embedded />
        </div>
      ) : (
        <PictureRefineBody illo={illo} />
      )}

      <Modal
        open={intentPick !== null}
        onClose={() => setIntentPick(null)}
        title="Who did you mean?"
        size="max-w-md"
      >
        {intentPick && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">{intentPick.edit}</p>
            <div className="flex flex-col gap-2">
              {intentPick.candidates.map((c) => (
                <Button
                  key={c.anchorId}
                  variant="secondary"
                  loading={generating}
                  className="justify-start"
                  onClick={() => void applyIntentPick(c.anchorId)}
                >
                  {c.name}
                  {c.brief ? (
                    <span className="ml-1 truncate font-normal text-ink-400">— {c.brief}</span>
                  ) : null}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Generate / refine / new-version controls shared by pages and covers. */
function PictureRefineBody({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const { openImageEdit } = useStudio();
  const {
    cursor,
    generating,
    sparkRange,
    edit,
    setEdit,
    applyEdit,
    tryAgain,
    generate,
    isStale,
    layoutStale,
    changedHere,
    staleRefAnchors,
    updateScene,
    redrawLayout,
    coverMode,
  } = illo;

  return (
    <div className="space-y-3 p-4">
      {!cursor ? (
        <Button
          className="w-full"
          loading={generating}
          leftIcon={<Sparkles className="size-4" />}
          onClick={() => void generate()}
        >
          {coverMode ? "Generate cover" : "Generate"}
          <SparkEstimateCost range={sparkRange} />
        </Button>
      ) : (
        <>
          {layoutStale && !isStale && (
            <StatusBanner
              message="Drawn for a different layout."
              action="Redraw"
              loading={generating}
              onAction={() => void redrawLayout()}
            />
          )}
          {isStale && (
            <StatusBanner
              message={
                changedHere.length > 0
                  ? `${formatList(changedHere.map((a) => a.name))} changed.`
                  : "Characters & places on this page changed."
              }
              action={
                staleRefAnchors.length > 0 ? "Update looks, then scene" : "Update scene"
              }
              loading={generating}
              onAction={() => void updateScene()}
              hint={
                staleRefAnchors.length > 0
                  ? `Will refresh ${formatList(staleRefAnchors.map((a) => a.name))} first.`
                  : undefined
              }
            />
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">Change this picture</p>
            <Input
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              placeholder="warmer light, bigger smile…"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || generating) return;
                if (edit.trim()) void applyEdit();
                else void tryAgain();
              }}
            />
            <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
              {edit.trim()
                ? "Applies your tweak to the current drawing — same scene."
                : "Leave blank for a fresh drawing of the same scene, or type a small tweak."}
            </p>
          </div>

          {/* One CTA: typed text → apply tweak; empty → new version. Avoids
              spending a generation that ignores a half-typed edit. */}
          {edit.trim() ? (
            <Button
              className="w-full"
              variant="secondary"
              loading={generating}
              leftIcon={<Sparkles className="size-4" />}
              onClick={() => void applyEdit()}
            >
              Apply change
              <SparkEstimateCost range={sparkRange} />
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="secondary"
              loading={generating}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void tryAgain()}
            >
              New version
              <SparkEstimateCost range={sparkRange} />
            </Button>
          )}

          <button
            type="button"
            className="text-left text-[11px] font-medium text-brand-600 hover:text-brand-700"
            onClick={() => openImageEdit("scene")}
          >
            Want a different scene? Edit what’s happening →
          </button>
        </>
      )}
    </div>
  );
}

function CharactersSection({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const {
    anchors,
    activeIds,
    drawnAnchorIds,
    coverMode,
    isStale,
    staleRefAnchors,
    updateScene,
    generating,
    sparkRange,
    setActiveAnchors,
    cursor,
    changedHere,
  } = illo;
  const { setImageEditCloseGuard } = useStudio();

  const [draftIds, setDraftIds] = useState(activeIds);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(null);

  const dirty = !sameIdSet(draftIds, activeIds);
  const differsFromArt =
    !!cursor && drawnAnchorIds.length > 0 && !sameIdSet(draftIds, drawnAnchorIds);

  // Stay in sync with commits when the user isn't mid-edit.
  useEffect(() => {
    if (!dirty) setDraftIds(activeIds);
  }, [activeIds, dirty]);

  useEffect(() => {
    setImageEditCloseGuard((proceed) => {
      if (!dirty) return true;
      setPendingProceed(() => proceed);
      setDiscardOpen(true);
      return false;
    });
    return () => setImageEditCloseGuard(null);
  }, [dirty, setImageEditCloseGuard]);

  const staleLookIds = useMemo(() => {
    const ids = new Set(changedHere.map((a) => a.id));
    for (const a of staleRefAnchors) ids.add(a.id);
    return ids;
  }, [changedHere, staleRefAnchors]);

  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);
  const committedSet = useMemo(() => new Set(activeIds), [activeIds]);

  const diff = useMemo(() => {
    const name = (id: string) => anchors.find((a) => a.id === id)?.name ?? "Someone";
    const added = draftIds.filter((id) => !committedSet.has(id)).map(name);
    const removed = activeIds.filter((id) => !draftSet.has(id)).map(name);
    return { added, removed };
  }, [draftIds, activeIds, anchors, committedSet, draftSet]);

  function toggleDraft(id: string) {
    setDraftIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function cancelDraft() {
    setDraftIds(activeIds);
  }

  function matchPicture() {
    setDraftIds(drawnAnchorIds);
  }

  async function applyAndUpdate() {
    if (dirty) await setActiveAnchors(draftIds);
    await updateScene();
  }

  if (anchors.length === 0) {
    return (
      <p className="p-4 text-xs leading-relaxed text-ink-400">
        No characters or places in the cast yet. Add them in the Characters step.
      </p>
    );
  }

  const characters = anchors.filter((a) => a.type !== "place");
  const places = anchors.filter((a) => a.type === "place");

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs font-medium text-ink-500">
          {coverMode ? "Featured on this cover" : "Who’s in this picture"}
          <InfoHint topic="pageAnchors" />
        </div>
        <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-600">
          {draftIds.length}
        </span>
      </div>

      {characters.length > 0 && (
        <CastGroup
          label="Characters"
          anchors={characters}
          draftSet={draftSet}
          staleLookIds={staleLookIds}
          onToggle={toggleDraft}
        />
      )}
      {places.length > 0 && (
        <CastGroup
          label="Places"
          anchors={places}
          draftSet={draftSet}
          staleLookIds={staleLookIds}
          onToggle={toggleDraft}
        />
      )}

      {(diff.added.length > 0 || diff.removed.length > 0) && (
        <p className="text-[11px] leading-snug text-ink-500">
          {diff.added.length > 0 && <>Added {formatList(diff.added)}</>}
          {diff.added.length > 0 && diff.removed.length > 0 && " · "}
          {diff.removed.length > 0 && <>Removed {formatList(diff.removed)}</>}
        </p>
      )}

      <p className="text-[11px] leading-snug text-ink-400">
        Tap to include or leave out. Changes stay local until you update the picture.
      </p>

      {differsFromArt && (
        <button
          type="button"
          className="text-left text-[11px] font-medium text-brand-600 hover:text-brand-700"
          onClick={matchPicture}
        >
          Match the picture
        </button>
      )}

      {(dirty || isStale) && (
        <div className="flex gap-2">
          {dirty && (
            <Button
              className="flex-1"
              size="sm"
              variant="secondary"
              disabled={generating}
              onClick={cancelDraft}
            >
              Cancel
            </Button>
          )}
          <Button
            className="flex-1"
            size="sm"
            loading={generating}
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => void applyAndUpdate()}
          >
            Update picture
            <SparkEstimateCost range={sparkRange} />
          </Button>
        </div>
      )}

      <Modal
        open={discardOpen}
        onClose={() => {
          setDiscardOpen(false);
          setPendingProceed(null);
        }}
        title="Discard cast changes?"
        size="max-w-sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDiscardOpen(false);
                setPendingProceed(null);
              }}
            >
              Keep editing
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const go = pendingProceed;
                setDiscardOpen(false);
                setPendingProceed(null);
                cancelDraft();
                go?.();
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          You changed who’s in the picture, but haven’t updated the art yet.
        </p>
      </Modal>
    </div>
  );
}

function CastGroup({
  label,
  anchors,
  draftSet,
  staleLookIds,
  onToggle,
}: {
  label: string;
  anchors: Anchor[];
  draftSet: Set<string>;
  staleLookIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {anchors.map((a) => (
          <PortraitChip
            key={a.id}
            anchor={a}
            active={draftSet.has(a.id)}
            lookStale={staleLookIds.has(a.id)}
            onClick={() => onToggle(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SceneSection({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const { openImageEdit } = useStudio();
  const {
    subject,
    genSpread,
    patchSubject,
    anchors,
    activeIds,
    generating,
    sparkRange,
    tryAgain,
    cursor,
  } = illo;

  if (!subject || !genSpread) return null;

  const castOnPage = anchors.filter((a) => activeIds.includes(a.id));

  return (
    <div className="space-y-3 p-4">
      {castOnPage.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {castOnPage.map((a) => (
            <Badge key={a.id} tone="brand" className="text-[11px]">
              {a.name}
            </Badge>
          ))}
        </div>
      )}

      <Field label="What’s happening in the picture">
        <Textarea
          rows={3}
          value={genSpread.illustration}
          onChange={(e) => patchSubject({ illustration: e.target.value })}
          placeholder={SCENE_BRIEF_PLACEHOLDER}
        />
      </Field>
      <p className="text-[11px] leading-snug text-ink-400">
        Describe the moment — who, where, what they’re doing. Skip “generate an
        image of…” or style instructions.
      </p>

      {cursor ? (
        <Button
          className="w-full"
          loading={generating}
          leftIcon={<Wand2 className="size-4" />}
          onClick={() => void tryAgain()}
        >
          New version
          <SparkEstimateCost range={sparkRange} />
        </Button>
      ) : null}

      <button
        type="button"
        className="text-left text-[11px] font-medium text-brand-600 hover:text-brand-700"
        onClick={() => openImageEdit("refine")}
      >
        Small tweak instead? Describe a change →
      </button>
    </div>
  );
}

function VersionsSection({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const { versions, tree, setVersion, deleteVersion } = illo;
  if (versions.length === 0) {
    return (
      <p className="p-4 text-xs leading-relaxed text-ink-400">
        No versions yet — generate or edit to create the first one.
      </p>
    );
  }
  return (
    <div className="p-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {versions.map((node, i) => (
          <VersionThumb
            key={node.id}
            blobId={node.content.blobId}
            index={i + 1}
            size="sm"
            hideIndex
            active={node.id === tree?.cursorId}
            onClick={() => setVersion(node.id)}
            onDelete={() => deleteVersion(node.id)}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-400">
        Click a thumb to restore. New edits always add a version.
      </p>
    </div>
  );
}

function StatusBanner({
  message,
  action,
  onAction,
  loading,
  hint,
}: {
  message: string;
  action: string;
  onAction: () => void;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-amber-800">
          <RefreshCw className="size-3.5 shrink-0" />
          {message}
        </span>
        <Button
          size="sm"
          variant="secondary"
          loading={loading}
          leftIcon={<RefreshCw className="size-4" />}
          onClick={onAction}
        >
          {action}
        </Button>
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-amber-700">{hint}</p>}
    </div>
  );
}

function PortraitChip({
  anchor,
  active,
  lookStale,
  onClick,
}: {
  anchor: Anchor;
  active: boolean;
  lookStale?: boolean;
  onClick: () => void;
}) {
  const url = useBlobUrl(anchorThumbBlobId(anchor));
  const isPlace = anchor.type === "place";
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "In this picture — click to remove" : "Add to this picture"}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl px-1.5 py-2 transition active:scale-[0.98]",
        active ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : "bg-ink-50/80 hover:bg-ink-100",
      )}
    >
      <span className="relative">
        <span
          className={cn(
            "flex size-12 items-center justify-center overflow-hidden rounded-full bg-ink-100",
            active ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-brand-50" : "opacity-55 grayscale",
            lookStale && active && "ring-amber-500",
          )}
        >
          {url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : isPlace ? (
            <MapPin className="size-5 text-ink-400" />
          ) : (
            <span className="text-sm font-semibold text-ink-400">
              {anchor.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        {lookStale && active && (
          <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
        )}
        {isPlace && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-ink-100">
            <MapPin className="size-2.5 text-ink-500" />
          </span>
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 w-full text-center text-[11px] font-medium leading-tight",
          active ? "text-brand-800" : "text-ink-400",
        )}
      >
        {anchor.name}
      </span>
    </button>
  );
}
