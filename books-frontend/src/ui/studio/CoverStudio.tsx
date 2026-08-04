/**
 * Cover-specific tools (text, bake-into-art, continuous wrap, variations).
 * Nested under the Edit sheet's Cover tab when the active page is a cover.
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
import { applyCoverBakeText, buildDesignPages } from "../design/designInit";
import { spanTierRanges, useTierSparkEstimate } from "../hooks/useTierEstimate";
import { SparkEstimateCost } from "../layout/SparkCost";
import { cn } from "../lib/cn";
import { notify } from "../lib/notify";
import { useStudio } from "./StudioContext";

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

/** Cover text, bake, wrap, and generate controls — nested inside Edit on covers. */
export function CoverToolsPanel({ embedded = false }: { embedded?: boolean }) {
  const { project, setPageGenerating, selectIllustration } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const setBookTitle = useProjectsStore((s) => s.setBookTitle);
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
  const setCostRange = wrap
    ? scaleRange(rangeForTier(frontTier), versionCount)
    : sumRange(frontCostRange, backCostRange);

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
    await patchCover(COVER_FRONT_ID, {
      subtitle: baked.subtitle ?? "",
      author: baked.author ?? "",
    });
  }

  async function genCover(coverId: string, count: number, tier: ImageTier) {
    const spec = coverId === COVER_FRONT_ID ? doc?.frontCover : doc?.backCover;
    if (!spec) return;
    selectIllustration(coverId);
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
    if (!front || !back) return;
    const anchorIds = Array.from(new Set([...(front.anchorIds ?? []), ...(back.anchorIds ?? [])]));
    const alreadyLinked = back.illustration.includes(CONTINUATION_MARKER);
    const illustration = alreadyLinked
      ? back.illustration
      : [
          back.illustration.trim(),
          `Continue the same setting, colour palette, characters and art style as the front cover — this is the ${CONTINUATION_MARKER} of the same book.`,
          front.illustration.trim() ? `The front cover shows: ${front.illustration.trim()}` : "",
          "Keep the bottom-right corner calm and simple — plain, uncluttered background there with no objects, symbols or graphics.",
        ]
          .filter(Boolean)
          .join(" ");
    await patchCover(COVER_BACK_ID, { anchorIds, illustration });
  }

  async function generateFront() {
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
    const tier = frontBake ? "premium" : await requireImageTier();
    if (!tier) return;
    setBusy("set");
    // Materialize frames for busy veils; keep selection on the front (usual start).
    selectIllustration(COVER_BACK_ID);
    selectIllustration(COVER_FRONT_ID);
    setPageGenerating(COVER_FRONT_ID, true);
    setPageGenerating(COVER_BACK_ID, true);
    try {
      for (let i = 0; i < versionCount; i++) {
        const ok = await generateCoverWrap({ tier });
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

  return (
    <div className={cn("space-y-3", !embedded && "p-4")}>
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
            value={project.title}
            onChange={(e) => void setBookTitle(project.id, e.target.value)}
            placeholder="Your book's title"
          />
        </Field>
        <Field label="Subtitle">
          <Input
            value={front?.subtitle ?? ""}
            onChange={(e) => void patchCover(COVER_FRONT_ID, { subtitle: e.target.value })}
            placeholder="Optional"
          />
        </Field>
        <Field label="Author">
          <Input
            value={front?.author ?? ""}
            onChange={(e) => void patchCover(COVER_FRONT_ID, { author: e.target.value })}
            placeholder="Optional"
          />
        </Field>
        <Field label="Back blurb">
          <Textarea
            rows={2}
            value={back?.title ?? ""}
            onChange={(e) => void patchCover(COVER_BACK_ID, { title: e.target.value })}
            placeholder="Optional"
          />
        </Field>
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
            <p className="text-xs font-medium text-ink-700">Continuous wrap</p>
            <p className="text-[11px] text-ink-400">One art for front &amp; back</p>
          </div>
          <Toggle checked={wrap} onChange={setWrap} label="Generate as one wrap" />
        </div>
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
          {wrap ? "Matching wrap" : "Matching set"}
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
