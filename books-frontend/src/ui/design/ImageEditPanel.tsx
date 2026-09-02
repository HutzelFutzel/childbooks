/**
 * Docked Canva-style edit sheets for page illustrations. Everyday actions live
 * on the floating ImageStyleBar; deep controls (refine, cast, scene, versions,
 * effects) open here. Covers share the same tweak / new-version refine flow
 * once art exists; CoverToolsPanel is for first generate + title/bake/wrap setup.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import type { ImageElement } from "../../core/types";
import { Button } from "../components/Button";
import { FastDraftBanner } from "../components/FastDraftBanner";
import { Modal } from "../components/Modal";
import { Field, Input, Textarea } from "../components/Input";
import { VersionHistoryList } from "../components/VersionHistoryList";
import { Badge } from "../components/Badge";
import { SparkEstimateCost } from "../layout/SparkCost";
import { formatList } from "../lib/formatList";
import { useBufferedText } from "../hooks/useBufferedText";
import { CastPicker } from "./CastPicker";
import { EffectsControls } from "./EffectsControls";
import { AlignPad, type AlignEdge, Section, Slider } from "./inspectorKit";
import { CoverToolsPanel } from "../studio/CoverStudio";
import { usePageIllustration } from "../studio/usePageIllustration";
import { useStudioPanelStore } from "../studio/studioPanelStore";
import { cn } from "../lib/cn";

const SCENE_BRIEF_PLACEHOLDER =
  "Ava peeks under the bed; warm lantern light; curious, not scared";

/** Scene brief with local buffering so typing doesn't rewrite the studio every key. */
function SceneBriefField({
  label,
  value,
  onCommit,
  hint,
  flushRef,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  hint?: string;
  /** Optional handle so a Generate button can flush before starting a job. */
  flushRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const field = useBufferedText(value, onCommit);
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = field.flush;
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, field.flush]);
  return (
    <>
      <Field label={label}>
        <Textarea
          rows={3}
          value={field.value}
          onChange={(e) => field.onChange(e.target.value)}
          onFocus={field.onFocus}
          onBlur={field.onBlur}
          placeholder={SCENE_BRIEF_PLACEHOLDER}
        />
      </Field>
      {hint ? <p className="text-[11px] leading-snug text-ink-400">{hint}</p> : null}
    </>
  );
}

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
  /** Absent when opening generate tools on a page that has no art/frame yet. */
  image: ImageElement | null;
  section: ImageEditSection;
  onPatch: (patch: Partial<ImageElement>, opts?: { coalesce?: string }) => void;
  onGestureEnd: () => void;
  onAlign: (edge: AlignEdge) => void;
}) {
  const illo = usePageIllustration(pageId);
  const isIllustration = !image || image.kind === "illustration";

  if (section === "effects") {
    if (!image) {
      return (
        <p className="p-4 text-xs leading-relaxed text-ink-400">
          Generate an illustration before editing effects.
        </p>
      );
    }
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
    if (!image) {
      return (
        <p className="p-4 text-xs leading-relaxed text-ink-400">
          Generate an illustration before framing it.
        </p>
      );
    }
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
  const { coverMode, cursor, intentPick, setIntentPick, generating, applyIntentPick } = illo;

  // Empty cover: full cover setup + generate. Once art exists, same tweak /
  // new-version flow as interior pages, with cover setup tucked underneath.
  if (coverMode && !cursor) {
    return (
      <div className="p-4">
        <CoverToolsPanel embedded />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PictureRefineBody illo={illo} />
      {coverMode && cursor ? <CoverSetupDisclosure /> : null}

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

/** Title / bake / wrap / matching-set — secondary once the cover already has art. */
function CoverSetupDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-ink-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-ink-50"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-ink-700">Cover setup</span>
          <span className="block text-[11px] text-ink-400">
            Title, bake, wrap &amp; matching set
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-ink-400 transition",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-ink-100 px-4 pb-4 pt-3">
          <CoverToolsPanel embedded variant="setup" />
        </div>
      ) : null}
    </div>
  );
}

/** Generate / refine / new-version controls for page + cover illustrations. */
function PictureRefineBody({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const openImageEdit = useStudioPanelStore((s) => s.openImageEdit);
  const sceneFlushRef = useRef<(() => void) | null>(null);
  const {
    coverMode,
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
    genSpread,
    patchSubject,
  } = illo;

  const subjectLabel = coverMode ? "cover" : "picture";

  return (
    <div className="space-y-3 p-4">
      <CastPicker illo={illo} defaultOpen={!cursor} />

      {!cursor ? (
        <>
          {genSpread && (
            <SceneBriefField
              label={
                coverMode ? "Cover scene" : "What’s happening in the picture"
              }
              value={genSpread.illustration}
              onCommit={(illustration) => void patchSubject({ illustration })}
              hint="Describe the moment — who, where, what they’re doing. Skip “generate an image of…” or style instructions."
              flushRef={sceneFlushRef}
            />
          )}
          <Button
            className="w-full"
            loading={generating}
            leftIcon={<Sparkles className="size-4" />}
            onClick={() => {
              sceneFlushRef.current?.();
              void generate();
            }}
          >
            {coverMode ? "Generate cover" : "Generate illustration"}
            <SparkEstimateCost range={sparkRange} />
          </Button>
        </>
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
                  : coverMode
                    ? "Characters & places on this cover changed."
                    : "Characters & places on this page changed."
              }
              action={
                staleRefAnchors.length > 0
                  ? "Update looks, then scene"
                  : coverMode
                    ? "Update cover"
                    : "Update scene"
              }
              loading={generating}
              onAction={() => void updateScene()}
              hint={
                staleRefAnchors.length > 0
                  ? `Will refresh ${formatList(staleRefAnchors.map((a) => a.name))} first.`
                  : "Cast or looks changed — update when you’ve finished editing."
              }
            />
          )}
          {cursor.imageTier === "quick" && (
            <FastDraftBanner
              upgrading={generating}
              onUpgrade={() => void illo.upgradeQuality()}
            />
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-600">
              Change this {subjectLabel}
            </p>
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
  return (
    <div className="p-4">
      <CastPicker illo={illo} collapsible={false} />
    </div>
  );
}

function SceneSection({ illo }: { illo: ReturnType<typeof usePageIllustration> }) {
  const openImageEdit = useStudioPanelStore((s) => s.openImageEdit);
  const {
    coverMode,
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

      <SceneBriefField
        label={coverMode ? "Cover scene" : "What’s happening in the picture"}
        value={genSpread.illustration}
        onCommit={(illustration) => void patchSubject({ illustration })}
        hint="Describe the moment — who, where, what they’re doing. Skip “generate an image of…” or style instructions."
      />

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
      <VersionHistoryList
        hideTitle
        items={versions.map((node, i) => ({
          id: node.id,
          blobId: node.content.blobId,
          index: i + 1,
        }))}
        activeId={tree?.cursorId}
        onSelect={setVersion}
        onDelete={deleteVersion}
      />
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

