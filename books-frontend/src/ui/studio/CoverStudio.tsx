/**
 * Cover-specific tools (text, title treatment, front/back generation).
 * Used as the empty-cover refine sheet, or as a secondary “Cover setup”
 * disclosure once art exists (page-like tweaks live in ImageEditPanel).
 */
import { useState } from "react";
import { ArrowLeft, RefreshCw, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  type CoverSpec,
  type ScreenplayDoc,
} from "../../core/types";
import { CUSTOMER_IMAGE_TIER } from "../../core/config/modelConfig";
import type { SparkEstimateRange } from "../../core/config/sparks";
import { getCursor, updateNodeContent } from "../../core/versioning";
import { coverTextDrift, generateCoverWrap, generateIllustrationVersion } from "../../state/ai";
import { coverSpread } from "../../state/bookUnits";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Field, Input, Textarea } from "../components/Input";
import { Toggle } from "../components/Toggle";
import { CastPicker } from "../design/CastPicker";
import { applyCoverBakeText, buildDesignPages } from "../design/designInit";
import { useBufferedText } from "../hooks/useBufferedText";
import { useTierSparkEstimate } from "../hooks/useTierEstimate";
import { SparkEstimateCost } from "../layout/SparkCost";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { usePageIllustration } from "./usePageIllustration";

/** Scale a spark range by a render count (null-safe). */
function scaleRange(r: SparkEstimateRange | null, n: number): SparkEstimateRange | null {
  if (!r) return null;
  return { minSparks: r.minSparks * n, maxSparks: r.maxSparks * n };
}

/**
 * Cover text, bake, wrap, and generate controls.
 * - `full` (default): first-generate sheet (also used when the cover has no art).
 * - `setup`: secondary disclosure under page-like refine once art exists —
 *   skips the stale banner (parent refine already shows it) and keeps title /
 *   bake / wrap / matching generate.
 */
export function CoverToolsPanel({
  embedded = false,
  variant = "full",
}: {
  embedded?: boolean;
  variant?: "full" | "setup";
}) {
  const {
    project,
    selection,
    generatingPages,
    setPageGenerating,
    selectIllustration,
  } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const setBookTitle = useProjectsStore((s) => s.setBookTitle);
  const setCoverSubtitle = useProjectsStore((s) => s.setCoverSubtitle);
  const setDesign = useProjectsStore((s) => s.setDesign);

  const [wrap, setWrap] = useState(true);
  const [busy, setBusy] = useState<null | "front" | "back" | "set">(null);
  const [startedWithoutCoverArt] = useState(() => {
    const hasArt = (coverId: string) => {
      const tree = project.illustrations?.[coverId];
      return Boolean(tree && getCursor(tree).content.blobId);
    };
    return !hasArt(COVER_FRONT_ID) && !hasArt(COVER_BACK_ID);
  });
  const [customizingFirstCover, setCustomizingFirstCover] = useState(false);
  const productionRange = useTierSparkEstimate("coverIllustration", CUSTOMER_IMAGE_TIER);

  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const front = doc?.frontCover;
  const back = doc?.backCover;
  const frontBake = Boolean(front?.bakeText);
  const canBakeText = (project.config.contentLocale ?? "en-US").startsWith("en-");
  const frontDrift = coverTextDrift(project, COVER_FRONT_ID);

  const frontCostRange = productionRange;
  const backCostRange = productionRange;
  // A cover pair is two full production-quality renders under the hood.
  const setCostRange = scaleRange(productionRange, 2);

  async function patchCover(coverId: string, patch: Partial<CoverSpec>) {
    const tree = project.screenplay;
    if (!tree) return;
    const next = structuredClone(getCursor(tree).content) as ScreenplayDoc;
    const key = coverId === COVER_FRONT_ID ? "frontCover" : "backCover";
    const base: CoverSpec = next[key] ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    next[key] = { ...base, ...patch };
    await setScreenplay(updateNodeContent(tree, tree.cursorId, next));
  }

  async function setFrontBake(on: boolean) {
    if (on && !canBakeText) {
      notify.info(
        "Use editable cover text for this language",
        "Image models can misspell accented characters. The title will stay as a sharp, editable text layer.",
      );
      return;
    }
    await patchCover(COVER_FRONT_ID, { bakeText: on });
    // Never delete the page design — that orphaned selection and closed Edit.
    // Only strip/restore the title overlays while keeping images intact.
    const current = useProjectsStore.getState().current();
    const design = current?.design;
    const pd = design?.pages[COVER_FRONT_ID];
    if (!current || !design || !pd) return;
    const page = buildDesignPages(current).find((p) => p.id === COVER_FRONT_ID);
    if (!page) return;
    const nextPd = applyCoverBakeText(design, page, pd, on);
    await setDesign({
      ...design,
      pages: { ...design.pages, [COVER_FRONT_ID]: nextPd },
    });
  }

  async function revertCoverText(baked: { title?: string; subtitle?: string; author?: string }) {
    await setBookTitle(project.id, baked.title ?? "");
    await setCoverSubtitle(project.id, baked.subtitle ?? "");
    await patchCover(COVER_FRONT_ID, { author: baked.author ?? "" });
  }

  /** Scene brief for the cover currently open in the studio (front or back). */
  const activeCoverId =
    selection.kind !== "none" &&
    selection.kind !== "anchor" &&
    "pageId" in selection &&
    (selection.pageId === COVER_FRONT_ID || selection.pageId === COVER_BACK_ID)
      ? selection.pageId
      : COVER_FRONT_ID;
  const activeCover = activeCoverId === COVER_BACK_ID ? back : front;
  const coverIllo = usePageIllustration(activeCoverId);

  // Buffer toolbox text so typing doesn't mutate the whole studio every key.
  const titleField = useBufferedText(project.title, (v) => {
    void setBookTitle(project.id, v);
  });
  const subtitleField = useBufferedText(front?.subtitle ?? "", (v) => {
    void setCoverSubtitle(project.id, v);
  });
  const authorField = useBufferedText(front?.author ?? "", (v) => {
    void patchCover(COVER_FRONT_ID, { author: v });
  });
  const blurbField = useBufferedText(back?.title ?? "", (v) => {
    void patchCover(COVER_BACK_ID, { title: v });
  });
  const sceneField = useBufferedText(activeCover?.illustration ?? "", (v) => {
    void patchCover(activeCoverId, { illustration: v });
  });

  function flushTextFields() {
    titleField.flush();
    subtitleField.flush();
    authorField.flush();
    blurbField.flush();
    sceneField.flush();
  }

  async function renderCover(coverId: string) {
    // Always read the latest screenplay — buffered scene/title edits may have
    // just flushed in this same tick.
    const live = useProjectsStore.getState().current();
    const liveDoc = live?.screenplay ? getCursor(live.screenplay).content : null;
    const spec = coverId === COVER_FRONT_ID ? liveDoc?.frontCover : liveDoc?.backCover;
    if (!spec) return;
    await generateIllustrationVersion(coverSpread(coverId, spec));
  }

  async function genCover(coverId: string) {
    selectIllustration(coverId, { createIfMissing: true });
    setPageGenerating(coverId, true);
    try {
      await renderCover(coverId);
    } finally {
      setPageGenerating(coverId, false);
    }
  }

  async function generateFront() {
    flushTextFields();
    setBusy("front");
    try {
      await genCover(COVER_FRONT_ID);
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function generateBack() {
    flushTextFields();
    setBusy("back");
    try {
      await genCover(COVER_BACK_ID);
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function runCoverPair(task: () => Promise<void>) {
    setBusy("set");
    selectIllustration(COVER_BACK_ID, { createIfMissing: true });
    selectIllustration(COVER_FRONT_ID, { createIfMissing: true });
    setPageGenerating(COVER_FRONT_ID, true);
    setPageGenerating(COVER_BACK_ID, true);
    try {
      await task();
    } catch (err) {
      notify.error(err);
    } finally {
      setPageGenerating(COVER_FRONT_ID, false);
      setPageGenerating(COVER_BACK_ID, false);
      setBusy(null);
    }
  }

  async function renderWrapPair() {
    await generateCoverWrap({
      onFrontSettled: () => undefined,
      onBackStart: () => undefined,
    });
  }

  async function renderSeparatePair() {
    await renderCover(COVER_FRONT_ID);
    await renderCover(COVER_BACK_ID);
  }

  async function generateWrapSet() {
    flushTextFields();
    return runCoverPair(renderWrapPair);
  }

  async function generateSeparateSet() {
    flushTextFields();
    return runCoverPair(renderSeparatePair);
  }

  async function generateSet() {
    if (wrap) return generateWrapSet();
    return generateSeparateSet();
  }

  async function generateStarter() {
    return runCoverPair(async () => {
      if (frontBake) await setFrontBake(false);
      flushTextFields();
      await renderWrapPair();
    });
  }

  function restoreRecommendedSetup() {
    setWrap(true);
    if (frontBake) void setFrontBake(false);
    setCustomizingFirstCover(false);
  }

  function customizeStarter() {
    setCustomizingFirstCover(true);
  }

  const coverPairGenerating =
    generatingPages.has(COVER_FRONT_ID) || generatingPages.has(COVER_BACK_ID);
  const anyBusy = busy !== null || coverPairGenerating;

  if (!doc) {
    return (
      <p className={cn("text-xs leading-relaxed text-ink-400", !embedded && "p-4")}>
        Draft your book first — cover tools appear once the screenplay is ready.
      </p>
    );
  }

  const setupOnly = variant === "setup";

  if (!setupOnly && startedWithoutCoverArt && !customizingFirstCover) {
    return (
      <CoverCreationStart
        title={project.title}
        loading={anyBusy}
        disabled={anyBusy}
        costRange={setCostRange}
        onGenerate={() => void generateStarter()}
        onCustomize={customizeStarter}
      />
    );
  }

  return (
    <div className={cn("space-y-3", !embedded && "p-4")}>
      {!setupOnly && startedWithoutCoverArt && customizingFirstCover && (
        <button
          type="button"
          onClick={restoreRecommendedSetup}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition hover:text-brand-700"
        >
          <ArrowLeft className="size-3.5" />
          Recommended setup
        </button>
      )}
      {!setupOnly && coverIllo.isStale && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-amber-800">
              Cast or looks changed — update when you’ve finished editing.
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={coverIllo.generating}
              leftIcon={<RefreshCw className="size-4" />}
              onClick={() => void coverIllo.updateScene()}
            >
              Update cover
              <SparkEstimateCost range={coverIllo.sparkRange} action="coverIllustration" />
            </Button>
          </div>
        </div>
      )}
      {frontDrift && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <RefreshCw className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-[11px] leading-relaxed text-amber-800">
                Title is now <span className="font-semibold">“{frontDrift.current.title || "—"}”</span>{" "}
                but the art still shows{" "}
                <span className="font-semibold">“{frontDrift.baked.title || "—"}”</span>.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  loading={coverPairGenerating || busy === "set"}
                  disabled={anyBusy}
                  leftIcon={<Sparkles className="size-3.5" />}
                  onClick={() => void generateSet()}
                >
                  Regenerate
                  <SparkEstimateCost range={setCostRange} action="coverIllustration" />
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={anyBusy}
                  leftIcon={<RotateCcw className="size-3.5" />}
                  onClick={() => void revertCoverText(frontDrift.baked)}
                >
                  Revert text
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-2">
        <Field label="Book title" required>
          <Input
            value={titleField.value}
            onChange={(e) => titleField.onChange(e.target.value)}
            onFocus={titleField.onFocus}
            onBlur={titleField.onBlur}
            placeholder="Your book's title"
          />
        </Field>
        <Field label="Subtitle">
          <Input
            value={subtitleField.value}
            onChange={(e) => subtitleField.onChange(e.target.value)}
            onFocus={subtitleField.onFocus}
            onBlur={subtitleField.onBlur}
            placeholder="Optional"
          />
        </Field>
        <Field label="Author">
          <Input
            value={authorField.value}
            onChange={(e) => authorField.onChange(e.target.value)}
            onFocus={authorField.onFocus}
            onBlur={authorField.onBlur}
            placeholder="Optional"
          />
        </Field>
        <Field label="Back blurb">
          <Textarea
            rows={2}
            value={blurbField.value}
            onChange={(e) => blurbField.onChange(e.target.value)}
            onFocus={blurbField.onFocus}
            onBlur={blurbField.onBlur}
            placeholder="Optional"
          />
        </Field>
        <Field
          label={
            activeCoverId === COVER_BACK_ID ? "Back cover scene" : "Cover scene"
          }
        >
          <Textarea
            rows={3}
            value={sceneField.value}
            onChange={(e) => sceneField.onChange(e.target.value)}
            onFocus={sceneField.onFocus}
            onBlur={sceneField.onBlur}
            placeholder="Ava under a glowing moon; warm night colours; curious, not scared"
          />
        </Field>
        <p className="text-[11px] leading-snug text-ink-400">
          Describe the cover moment — who, where, the mood. Skip “generate an
          image of…” or style instructions.
        </p>

        {/* Cast lives in the page-like refine body when setup is secondary. */}
        {!setupOnly && <CastPicker illo={coverIllo} defaultOpen={!coverIllo.cursor} />}
      </section>

      <section className="space-y-2">
        {canBakeText && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink-700">
                  Paint title into illustration
                </p>
                <p className="text-[11px] text-ink-400">
                  Otherwise the title stays editable
                </p>
              </div>
              <Toggle
                checked={frontBake}
                onChange={(v) => void setFrontBake(v)}
                label="Paint title into illustration"
              />
            </div>
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-700">Continue scene onto back</p>
            <p className="text-[11px] text-ink-400">Creates one connected cover scene</p>
          </div>
          <Toggle checked={wrap} onChange={setWrap} label="Continue the front scene onto the back" />
        </div>
      </section>

      <section className="space-y-2">
        <Button
          className="w-full"
          loading={coverPairGenerating || busy === "set"}
          disabled={anyBusy}
          leftIcon={<Sparkles className="size-4" />}
          onClick={() => void generateSet()}
        >
          Create front &amp; back
          <SparkEstimateCost range={setCostRange} action="coverIllustration" />
        </Button>
        {!wrap && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              loading={busy === "front" || generatingPages.has(COVER_FRONT_ID)}
              disabled={anyBusy}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void generateFront()}
            >
              Front
              <SparkEstimateCost range={frontCostRange} action="coverIllustration" />
            </Button>
            <Button
              variant="secondary"
              loading={busy === "back" || generatingPages.has(COVER_BACK_ID)}
              disabled={anyBusy}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void generateBack()}
            >
              Back
              <SparkEstimateCost range={backCostRange} action="coverIllustration" />
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function CoverCreationStart({
  title,
  loading,
  disabled,
  costRange,
  onGenerate,
  onCustomize,
}: {
  title: string;
  loading: boolean;
  disabled: boolean;
  costRange: SparkEstimateRange | null;
  onGenerate: () => void;
  onCustomize: () => void;
}) {
  const hasTitle = title.trim().length > 0;

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
          Create front &amp; back covers
        </p>
        <h3 className="mt-1 line-clamp-2 text-lg font-semibold leading-tight text-ink-900">
          {hasTitle ? title : "Add your book title"}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          We&apos;ll paint one connected scene across both covers. Your title stays editable.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
          <Sparkles className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink-800">One wraparound illustration</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">
            The back continues naturally from the front for a polished, cohesive book cover.
          </p>
        </div>
      </div>

      {!hasTitle && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Add a title under Customize before creating the cover.
        </p>
      )}

      <Button
        className="w-full"
        loading={loading}
        disabled={disabled || !hasTitle}
        leftIcon={<Sparkles className="size-4" />}
        onClick={onGenerate}
      >
        {loading ? "Creating front & back…" : "Create front & back"}
        <SparkEstimateCost range={costRange} action="coverIllustration" />
      </Button>

      <button
        type="button"
        disabled={disabled}
        onClick={onCustomize}
        className="w-full text-center text-xs font-medium text-ink-500 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Customize before creating
      </button>
    </div>
  );
}
