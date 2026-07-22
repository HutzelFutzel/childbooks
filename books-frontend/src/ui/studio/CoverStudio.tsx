/**
 * The Cover tools drawer: text fields + the cover generation flow (matching
 * wrap / front / back, optional bake-into-art, and a 1–3 variation picker),
 * shown in a side drawer over the canvas. The covers themselves are edited
 * directly on the canvas like any other page — this drawer is just the
 * cover-specific controls, so the editor never feels like a separate mode.
 */
import { useState } from "react";
import { Info, RefreshCw, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import {
  COVER_BACK_ID,
  COVER_FRONT_ID,
  type CoverSpec,
  type ScreenplayDoc,
} from "../../core/types";
import {
  DEFAULT_IMAGE_TIER,
  DEFAULT_IMAGE_TIER_LABELS,
  type ImageTier,
} from "../../core/config/modelConfig";
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
import { Drawer } from "../components/Drawer";
import { Field, Input, Textarea } from "../components/Input";
import { Toggle } from "../components/Toggle";
import { VersionThumb } from "../components/VersionThumb";
import { useTierSparkEstimate } from "../hooks/useTierEstimate";
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

/** The cover-specific tools, shown in a side drawer over the canvas. */
export function CoverToolsDrawer() {
  const { project, coverStudioOpen, closeCoverStudio, setPageGenerating } = useStudio();
  const setScreenplay = useProjectsStore((s) => s.setScreenplay);
  const setBookTitle = useProjectsStore((s) => s.setBookTitle);
  const setDesign = useProjectsStore((s) => s.setDesign);

  const [versionCount, setVersionCount] = useState<1 | 2 | 3>(1);
  const [wrap, setWrap] = useState(true);
  const [busy, setBusy] = useState<null | "front" | "back" | "set">(null);

  // Tier display names follow the admin config (renaming "Fast"/"High-Quality"
  // in the dashboard updates this copy automatically).
  const tierLabels = useAppConfigStore((s) => s.modelConfig.imageTierLabels);
  const premiumLabel = tierLabels?.premium?.trim() || DEFAULT_IMAGE_TIER_LABELS.premium;
  const quickLabel = tierLabels?.quick?.trim() || DEFAULT_IMAGE_TIER_LABELS.quick;

  // Cost estimates track the tier that will ACTUALLY be used (baking forces the
  // premium tier) and the number of variations requested.
  const userTier = usePreferredImageTier() ?? DEFAULT_IMAGE_TIER;
  const quickRange = useTierSparkEstimate("coverIllustration", "quick");
  const premiumRange = useTierSparkEstimate("coverIllustration", "premium");
  const rangeForTier = (t: ImageTier) => (t === "premium" ? premiumRange : quickRange);

  const doc = project.screenplay ? getCursor(project.screenplay).content : null;
  const front = doc?.frontCover;
  const back = doc?.backCover;
  const frontBake = Boolean(front?.bakeText);
  const frontDrift = coverTextDrift(project, COVER_FRONT_ID);

  const frontTier: ImageTier = frontBake ? "premium" : userTier;
  const frontCostRange = scaleRange(rangeForTier(frontTier), versionCount);
  const backCostRange = scaleRange(rangeForTier(userTier), versionCount);
  const setCostRange = wrap
    ? scaleRange(rangeForTier(frontTier), versionCount)
    : sumRange(frontCostRange, backCostRange);

  /** Patch a cover spec on the current screenplay doc (single writer). */
  async function patchCover(coverId: string, patch: Partial<CoverSpec>) {
    const tree = project.screenplay;
    if (!tree) return;
    const next = structuredClone(getCursor(tree).content) as ScreenplayDoc;
    const key = coverId === COVER_FRONT_ID ? "frontCover" : "backCover";
    const base: CoverSpec = next[key] ?? { title: "", subtitle: "", illustration: "", anchorIds: [] };
    next[key] = { ...base, ...patch };
    await setScreenplay(updateNodeContent(tree, tree.cursorId, next));
  }

  /** Toggle baked text on the front cover, syncing the overlay text boxes. */
  async function setFrontBake(on: boolean) {
    await patchCover(COVER_FRONT_ID, { bakeText: on });
    const design = useProjectsStore.getState().current()?.design;
    if (!design) return;
    const nextPages = { ...design.pages };
    if (on) {
      const pd = nextPages[COVER_FRONT_ID];
      if (pd) {
        nextPages[COVER_FRONT_ID] = {
          ...pd,
          textBoxes: pd.textBoxes.filter(
            (b) => b.role !== "book-title" && b.role !== "book-subtitle",
          ),
        };
      }
    } else {
      delete nextPages[COVER_FRONT_ID];
    }
    await setDesign({ ...design, pages: nextPages });
  }

  /** Revert the title/subtitle/author fields back to what the artwork shows. */
  async function revertCoverText(baked: { title?: string; subtitle?: string; author?: string }) {
    await setBookTitle(project.id, baked.title ?? "");
    await patchCover(COVER_FRONT_ID, {
      subtitle: baked.subtitle ?? "",
      author: baked.author ?? "",
    });
  }

  /** Generate `count` variations of one cover at `tier`, sequentially. */
  async function genCover(coverId: string, count: number, tier: ImageTier) {
    const spec = coverId === COVER_FRONT_ID ? doc?.frontCover : doc?.backCover;
    if (!spec) return;
    setPageGenerating(coverId, true);
    try {
      for (let i = 0; i < count; i++) {
        await generateIllustrationVersion(coverSpread(coverId, spec), { tier });
      }
    } finally {
      setPageGenerating(coverId, false);
    }
  }

  /** Make the back cover continue the front: shared subjects + continuation brief. */
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
    const tier = frontBake ? "premium" : requireImageTier();
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
    const tier = requireImageTier();
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

  /** One continuous artwork, split into front + back — guaranteed to match. */
  async function generateWrapSet() {
    const tier = frontBake ? "premium" : requireImageTier();
    if (!tier) return;
    setBusy("set");
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
    const tier = requireImageTier();
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

  return (
    <Drawer
      open={coverStudioOpen}
      onClose={closeCoverStudio}
      side="right"
      title="Cover tools"
      widthClass="max-w-md"
    >
      {!doc ? (
        <div className="p-6 text-center text-sm text-ink-400">
          Draft your book first — the covers appear here once the screenplay is ready.
        </div>
      ) : (
        <div className="space-y-5 p-4">
          <p className="text-xs leading-relaxed text-ink-500">
            Edit the covers right on the page — click the art to reposition it, or add and style text
            boxes. Use the tools below to write the cover text and generate matching artwork.
          </p>

          {frontDrift && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2.5">
                <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-700" />
                <div className="min-w-0 flex-1 space-y-2.5">
                  <p className="text-sm text-amber-800">
                    The cover text changed since the artwork was made. The title is now{" "}
                    <span className="font-semibold">“{frontDrift.current.title || "—"}”</span>, but the
                    cover still shows{" "}
                    <span className="font-semibold">“{frontDrift.baked.title || "—"}”</span>. Because
                    the title is painted into the art, it only updates when you regenerate.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={busy === "set"}
                      disabled={anyBusy}
                      leftIcon={<Sparkles className="size-4" />}
                      onClick={() => void generateSet()}
                    >
                      Regenerate cover
                      <SparkEstimateCost range={setCostRange} />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={anyBusy}
                      leftIcon={<RotateCcw className="size-4" />}
                      onClick={() => void revertCoverText(frontDrift.baked)}
                    >
                      Revert text to the artwork
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Text fields */}
          <section className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
            <div>
              <h3 className="text-sm font-semibold text-ink-800">Cover text</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Only the book title is required — the subtitle, author and blurb are all optional.
              </p>
            </div>
            <Field label="Book title" required hint="Shown on the front cover and used everywhere.">
              <Input
                value={project.title}
                onChange={(e) => void setBookTitle(project.id, e.target.value)}
                placeholder="Your book's title"
              />
            </Field>
            <Field label="Subtitle (optional)">
              <Input
                value={front?.subtitle ?? ""}
                onChange={(e) => void patchCover(COVER_FRONT_ID, { subtitle: e.target.value })}
                placeholder="A gentle bedtime adventure"
              />
            </Field>
            <Field label="Author (optional)">
              <Input
                value={front?.author ?? ""}
                onChange={(e) => void patchCover(COVER_FRONT_ID, { author: e.target.value })}
                placeholder="by …"
              />
            </Field>
            <Field label="Back-cover blurb (optional)">
              <Textarea
                rows={3}
                value={back?.title ?? ""}
                onChange={(e) => void patchCover(COVER_BACK_ID, { title: e.target.value })}
                placeholder="A short blurb for the back of the book…"
              />
            </Field>
          </section>

          {/* Baked text */}
          <section className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-800">Render the title into the artwork</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                  Let the illustrator draw the title (plus subtitle &amp; author, if set) as part of
                  the cover art, instead of a plain text overlay.
                </p>
              </div>
              <Toggle checked={frontBake} onChange={(v) => void setFrontBake(v)} label="Bake title into art" />
            </div>
            {frontBake && (
              <Callout tone="brand" icon={Info}>
                Baked-in text needs the {premiumLabel} model, so the front cover will be generated at{" "}
                {premiumLabel} even if your default is {quickLabel}.
              </Callout>
            )}
          </section>

          {/* Continuous wrap */}
          <section className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-800">Continuous wrap</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                  Paint the front &amp; back as one continuous artwork so the covers flow into each
                  other — it also costs a single generation instead of two.
                </p>
              </div>
              <Toggle checked={wrap} onChange={setWrap} label="Generate as one wrap" />
            </div>
          </section>

          {/* Variations */}
          <section className="space-y-3 rounded-2xl border border-ink-100 bg-white p-4">
            <h3 className="text-sm font-semibold text-ink-800">Variations to generate</h3>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setVersionCount(n)}
                  className={cn(
                    "flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    versionCount === n
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-ink-200 text-ink-500 hover:border-brand-300",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-400">
              Generate up to three options per cover, then pick your favourite below.
            </p>
          </section>

          {/* Actions */}
          <section className="space-y-2">
            <Button
              className="w-full"
              loading={busy === "set"}
              disabled={anyBusy}
              leftIcon={<Sparkles className="size-4" />}
              onClick={() => void generateSet()}
            >
              {wrap ? "Generate matching wrap cover" : "Generate matching cover set"}
              <SparkEstimateCost range={setCostRange} />
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                loading={busy === "front"}
                disabled={anyBusy || wrap}
                leftIcon={<Wand2 className="size-4" />}
                onClick={() => void generateFront()}
              >
                Front only
                <SparkEstimateCost range={frontCostRange} />
              </Button>
              <Button
                variant="secondary"
                loading={busy === "back"}
                disabled={anyBusy || wrap}
                leftIcon={<Wand2 className="size-4" />}
                onClick={() => void generateBack()}
              >
                Back only
                <SparkEstimateCost range={backCostRange} />
              </Button>
            </div>
            {wrap && (
              <p className="text-center text-xs text-ink-400">
                Turn off “Continuous wrap” to generate a single cover on its own.
              </p>
            )}
          </section>

          {/* Version pickers */}
          <CoverVersions coverId={COVER_FRONT_ID} label="Front cover options" />
          <CoverVersions coverId={COVER_BACK_ID} label="Back cover options" />
        </div>
      )}
    </Drawer>
  );
}

/** Version-history strip for one cover, so the user can pick the best option. */
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
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink-800">{label}</h3>
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
