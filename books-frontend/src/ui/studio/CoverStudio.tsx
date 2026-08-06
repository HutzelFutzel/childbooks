/**
 * Cover-specific tools (text, bake-into-art, matching front/back, variations).
 * Used as the empty-cover refine sheet, or as a secondary “Cover setup”
 * disclosure once art exists (page-like tweaks live in ImageEditPanel).
 */
import { useState } from "react";
import { Info, RefreshCw, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  type CoverSpec,
  type ScreenplayDoc,
} from "../../core/types";
import { DEFAULT_IMAGE_TIER_LABELS, type ImageTier } from "../../core/config/modelConfig";
import type { SparkEstimateRange } from "../../core/config/sparks";
import { getCursor, selectVersion, updateNodeContent, allVersions } from "../../core/versioning";
import { coverTextDrift, generateCoverWrap, generateIllustrationVersion } from "../../state/ai";
import { useAppConfigStore } from "../../state/appConfigStore";
import { coverSpread } from "../../state/bookUnits";
import { usePreferredImageTier } from "../../state/imageTier";
import { requireImageTier } from "../../state/imageTierPrompt";
import { useProjectsStore } from "../../state/projectsStore";
import { Button } from "../components/Button";
import { Callout } from "../components/Callout";
import { Field, Input, Textarea } from "../components/Input";
import { Toggle } from "../components/Toggle";
import { VersionThumb } from "../components/VersionThumb";
import { CastPicker } from "../design/CastPicker";
import { applyCoverBakeText, buildDesignPages } from "../design/designInit";
import { useBufferedText } from "../hooks/useBufferedText";
import { spanTierRanges, useTierSparkEstimate } from "../hooks/useTierEstimate";
import { SparkEstimateCost } from "../layout/SparkCost";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";
import { usePageIllustration } from "./usePageIllustration";

const CONTINUATION_MARKER = "wrap-around back panel";

/** Scale a spark range by a version count (null-safe). */
function scaleRange(r: SparkEstimateRange | null, n: number): SparkEstimateRange | null {
  if (!r) return null;
  return { minSparks: r.minSparks * n, maxSparks: r.maxSparks * n };
}

/** Sum two spark ranges (null-safe: a null side contributes nothing). */
function sumRange(
  a: SparkEstimateRange | null,
  b: SparkEstimateRange | null,
): SparkEstimateRange | null {
  if (!a) return b;
  if (!b) return a;
  return { minSparks: a.minSparks + b.minSparks, maxSparks: a.maxSparks + b.maxSparks };
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
  const { project, selection, setPageGenerating, selectIllustration } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const setBookTitle = useProjectsStore((s) => s.setBookTitle);
  const setCoverSubtitle = useProjectsStore((s) => s.setCoverSubtitle);
  const setDesign = useProjectsStore((s) => s.setDesign);

  const [versionCount, setVersionCount] = useState<1 | 2 | 3>(1);
  const [wrap, setWrap] = useState(true);
  const [busy, setBusy] = useState<null | "front" | "back" | "set">(null);

  const tierLabels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const premiumLabel = tierLabels?.premium?.trim() || DEFAULT_IMAGE_TIER_LABELS.premium;
  const quickLabel = tierLabels?.quick?.trim() || DEFAULT_IMAGE_TIER_LABELS.quick;

  const userTier = usePreferredImageTier();
  const quickRange = useTierSparkEstimate("coverIllustration", "quick");
  const premiumRange = useTierSparkEstimate("coverIllustration", "premium");
  const rangeForTier = (t: ImageTier | null) =>
    t === "premium" ? premiumRange : t === "quick" ? quickRange : spanTierRanges([quickRange, premiumRange]);

  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const front = doc?.frontCover;
  const back = doc?.backCover;
  const frontBake = Boolean(front?.bakeText);
  const frontDrift = coverTextDrift(project, COVER_FRONT_ID);

  const frontTier: ImageTier | null = frontBake ? "premium" : userTier;
  const frontCostRange = scaleRange(rangeForTier(frontTier), versionCount);
  const backCostRange = scaleRange(rangeForTier(userTier), versionCount);
  // The matching-pair flow (`generateCoverWrap`) is TWO full renders under the
  // hood — front, then a true outpaint continuation of it for the back. The
  // continuation needs a mask-capable model, which only the premium tier
  // offers, so the WHOLE pair always renders at premium regardless of the
  // user's saved preference (see `generateWrapSet`) — its estimate is double a
  // premium-tier render, not scaled to whatever tier the user last picked.
  const wrapCostRange = scaleRange(rangeForTier("premium"), versionCount * 2);
  const setCostRange = wrap ? wrapCostRange : sumRange(frontCostRange, backCostRange);

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

  async function genCover(coverId: string, count: number, tier: ImageTier) {
    // Always read the latest screenplay — buffered scene/title edits may have
    // just flushed in this same tick.
    const live = useProjectsStore.getState().current();
    const liveDoc = live?.screenplay ? getCursor(live.screenplay).content : null;
    const spec = coverId === COVER_FRONT_ID ? liveDoc?.frontCover : liveDoc?.backCover;
    if (!spec) return;
    selectIllustration(coverId, { createIfMissing: true });
    setPageGenerating(coverId, true);
    try {
      for (let i = 0; i < count; i++) {
        await generateIllustrationVersion(coverSpread(coverId, spec), { tier });
      }
    } finally {
      setPageGenerating(coverId, false);
    }
  }

  async function makeBackContinueFront() {
    const live = useProjectsStore.getState().current();
    const liveDoc = live?.screenplay ? getCursor(live.screenplay).content : null;
    const liveFront = liveDoc?.frontCover;
    const liveBack = liveDoc?.backCover;
    if (!liveFront || !liveBack) return;
    const anchorIds = Array.from(
      new Set([...(liveFront.anchorIds ?? []), ...(liveBack.anchorIds ?? [])]),
    );
    const alreadyLinked = liveBack.illustration.includes(CONTINUATION_MARKER);
    const illustration = alreadyLinked
      ? liveBack.illustration
      : [
          liveBack.illustration.trim(),
          `Continue the same setting, colour palette, characters and art style as the front cover — this is the ${CONTINUATION_MARKER} of the same book.`,
          liveFront.illustration.trim()
            ? `The front cover shows: ${liveFront.illustration.trim()}`
            : "",
          "Keep the bottom-right corner calm and simple — plain, uncluttered background there with no objects, symbols or graphics.",
        ]
          .filter(Boolean)
          .join(" ");
    await patchCover(COVER_BACK_ID, { anchorIds, illustration });
  }

  async function generateFront() {
    flushTextFields();
    const tier = frontBake ? "premium" : await requireImageTier();
    if (!tier) return;
    setBusy("front");
    try {
      await genCover(COVER_FRONT_ID, versionCount, tier);
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function generateBack() {
    flushTextFields();
    const tier = await requireImageTier();
    if (!tier) return;
    setBusy("back");
    try {
      await genCover(COVER_BACK_ID, versionCount, tier);
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function generateWrapSet() {
    flushTextFields();
    // The back cover is a true outpaint continuation of the front's real edge
    // pixels, which needs a mask-capable model — only the premium tier offers
    // that (see `renderCoverContinuation`). Forced unconditionally, like baked
    // text, rather than asking `requireImageTier()` for the user's saved
    // preference: a quick-tier "match" would silently fall back to a lesser
    // (non-continuous) result.
    const tier: ImageTier = "premium";
    setBusy("set");
    // Materialize frames for busy veils; keep selection on the front (usual start).
    selectIllustration(COVER_BACK_ID, { createIfMissing: true });
    selectIllustration(COVER_FRONT_ID, { createIfMissing: true });
    try {
      for (let i = 0; i < versionCount; i++) {
        // Only the cover actually in flight shows a loading veil: front while
        // it renders, then back once the front settles — never both for the
        // whole pair, or a finished front would sit there looking "stuck".
        setPageGenerating(COVER_FRONT_ID, true);
        const ok = await generateCoverWrap({
          tier,
          onFrontSettled: () => setPageGenerating(COVER_FRONT_ID, false),
          onBackStart: () => setPageGenerating(COVER_BACK_ID, true),
        });
        setPageGenerating(COVER_BACK_ID, false);
        if (!ok) break;
      }
    } catch (err) {
      notify.error(err);
    } finally {
      setPageGenerating(COVER_FRONT_ID, false);
      setPageGenerating(COVER_BACK_ID, false);
      setBusy(null);
    }
  }

  async function generateSet() {
    if (wrap) return generateWrapSet();
    flushTextFields();
    const tier = await requireImageTier();
    if (!tier) return;
    const setFrontTier: ImageTier = frontBake ? "premium" : tier;
    setBusy("set");
    try {
      await genCover(COVER_FRONT_ID, versionCount, setFrontTier);
      await makeBackContinueFront();
      await genCover(COVER_BACK_ID, versionCount, tier);
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  if (!doc) {
    return (
      <p className={cn("text-xs leading-relaxed text-ink-400", !embedded && "p-4")}>
        Draft your book first — cover tools appear once the screenplay is ready.
      </p>
    );
  }

  const setupOnly = variant === "setup";

  return (
    <div className={cn("space-y-3", !embedded && "p-4")}>
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
              <SparkEstimateCost range={coverIllo.sparkRange} />
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
                  loading={busy === "set"}
                  disabled={anyBusy}
                  leftIcon={<Sparkles className="size-3.5" />}
                  onClick={() => void generateSet()}
                >
                  Regenerate
                  <SparkEstimateCost range={setCostRange} />
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-700">Bake title into art</p>
            <p className="text-[11px] text-ink-400">Painted in the illustration</p>
          </div>
          <Toggle checked={frontBake} onChange={(v) => void setFrontBake(v)} label="Bake title into art" />
        </div>
        {frontBake && (
          <Callout tone="brand" icon={Info}>
            Uses {premiumLabel} (not {quickLabel}).
          </Callout>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink-700">Match back to front</p>
            <p className="text-[11px] text-ink-400">Back continues the front's scene</p>
          </div>
          <Toggle checked={wrap} onChange={setWrap} label="Generate a matching back cover" />
        </div>
        {wrap && (
          <Callout tone="brand" icon={Info}>
            Uses {premiumLabel} (not {quickLabel}) — a true continuation needs it.
          </Callout>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-ink-700">Variations</p>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setVersionCount(n)}
                className={cn(
                  "size-8 rounded-lg border text-xs font-semibold transition",
                  versionCount === n
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-ink-200 text-ink-500 hover:border-brand-300",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <Button
          className="w-full"
          loading={busy === "set"}
          disabled={anyBusy}
          leftIcon={<Sparkles className="size-4" />}
          onClick={() => void generateSet()}
        >
          {wrap ? "Matching pair" : "Matching set"}
          <SparkEstimateCost range={setCostRange} />
        </Button>
        {!wrap && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              loading={busy === "front"}
              disabled={anyBusy}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void generateFront()}
            >
              Front
              <SparkEstimateCost range={frontCostRange} />
            </Button>
            <Button
              variant="secondary"
              loading={busy === "back"}
              disabled={anyBusy}
              leftIcon={<Wand2 className="size-4" />}
              onClick={() => void generateBack()}
            >
              Back
              <SparkEstimateCost range={backCostRange} />
            </Button>
          </div>
        )}
      </section>

      <CoverVersions coverId={COVER_FRONT_ID} label="Front options" />
      <CoverVersions coverId={COVER_BACK_ID} label="Back options" />
    </div>
  );
}

function CoverVersions({ coverId, label }: { coverId: string; label: string }) {
  const project = useProjectsStore((s) => s.current());
  const tree = project?.illustrations?.[coverId];
  if (!tree) return null;
  const versions = allVersions(tree);
  if (versions.length <= 1) return null;

  const pick = (nodeId: string) => {
    const p = useProjectsStore.getState().current();
    const t = p?.illustrations?.[coverId];
    if (t) void useProjectsStore.getState().setIllustration(coverId, selectVersion(t, nodeId));
  };
  const remove = (nodeId: string) => {
    void useProjectsStore.getState().deleteIllustrationVersion(coverId, nodeId);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-ink-700">{label}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {versions.map((node, i) => (
          <VersionThumb
            key={node.id}
            blobId={node.content.blobId}
            index={i + 1}
            active={node.id === tree.cursorId}
            onClick={() => pick(node.id)}
            onDelete={versions.length > 1 ? () => remove(node.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
