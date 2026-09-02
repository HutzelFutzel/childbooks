/**
 * Design · Style chapter: pick the art style before generating cast looks.
 * First visit after Story sets `styleReady: false`; confirming flips it true.
 * Later visits keep a draft selection so Cancel can discard. Changing style
 * with existing art opens a confirm that renews cast → pages when Sparks allow.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, Sparkles } from "lucide-react";
import type { ArtStyleSelection, BookConfig } from "../../core/types";
import { resolveArtStyleLabel } from "../../core/prompts/style";
import { useAppConfigStore } from "../../state/appConfigStore";
import { useProjectsStore } from "../../state/projectsStore";
import { useSparksStore } from "../../state/sparksStore";
import { useSparksUiStore } from "../../state/sparksUiStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { SparkEstimateCost, useImageBatchRange } from "../layout/SparkCost";
import { notify } from "../lib/notify";
import { isArtStyleChosen } from "../wizard/schema";
import { artStylesEqual, StyleStep } from "../wizard/steps/StyleStep";
import { useStudio } from "./StudioContext";
import {
  startStyleRenew,
  styleRenewCounts,
  styleRenewEstimateParts,
  styleRenewTargets,
} from "./styleRenew";

export function StyleSetup() {
  const { project, setStep, closeStyleSetup } = useStudio();
  const config = useProjectsStore((s) => s.current()?.config);
  const updateConfig = useProjectsStore((s) => s.updateConfig);
  const artStyles = useAppConfigStore((s) => s.artStyles);

  const committed = config?.artStyle ?? { presetId: "watercolor" };
  const [draft, setDraft] = useState<ArtStyleSelection>(committed);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Re-sync draft when reopening Style (or when committed changes externally).
  useEffect(() => {
    setDraft(committed);
  }, [committed.presetId, committed.customDescription]);

  if (!config) return null;

  const firstTime = config.styleReady === false;
  const draftConfig: BookConfig = { ...config, artStyle: draft };
  const chosen = isArtStyleChosen(draftConfig);
  const dirty = !artStylesEqual(draft, committed);
  const renew = styleRenewCounts(project);
  const hasArt = renew.cast > 0 || renew.pages > 0;
  const needsRenewWarn = dirty && hasArt && !firstTime;

  const committedLabel = committed.presetId
    ? resolveArtStyleLabel(committed.presetId, artStyles)
    : "Custom";
  const draftLabel = draft.presetId
    ? resolveArtStyleLabel(draft.presetId, artStyles)
    : "Custom";

  async function commitStyle(next: ArtStyleSelection) {
    const patch: Partial<BookConfig> = { artStyle: next };
    if (firstTime) patch.styleReady = true;
    await updateConfig(patch);
  }

  async function finishWithoutArt() {
    if (!chosen) {
      notify.info("Pick a look", "Choose an art style before continuing.");
      return;
    }
    setBusy(true);
    try {
      await commitStyle(draft);
      setConfirmOpen(false);
      closeStyleSetup();
      if (firstTime) setStep("edit");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Commit the style, then hand the transfer to the persisted cascade and get
   * out of the way: only the enqueue is awaited, so the reader keeps a usable
   * studio while each look and page renders with its own spinner.
   */
  async function confirmAndRenew() {
    if (!chosen) {
      notify.info("Pick a look", "Choose an art style before continuing.");
      return;
    }
    setBusy(true);
    try {
      await commitStyle(draft);
      const fresh = useProjectsStore.getState().current() ?? project;
      const started = await startStyleRenew(fresh, (err) => notify.error(err));
      // A refused gate (quality tier / Sparks) leaves the dialog open so the
      // reader can top up and confirm again — the style itself is already saved.
      if (!started) return;
      setConfirmOpen(false);
      closeStyleSetup();
      notify.success(
        "Updating your book",
        "New versions are being created in the new style. This can take a few minutes — you can keep working.",
      );
    } finally {
      setBusy(false);
    }
  }

  function onPrimary() {
    if (!chosen) {
      notify.info("Pick a look", "Choose an art style before opening your book.");
      return;
    }
    if (firstTime || !dirty) {
      void finishWithoutArt();
      return;
    }
    if (hasArt) {
      setConfirmOpen(true);
      return;
    }
    void finishWithoutArt();
  }

  function onCancel() {
    setDraft(committed);
    closeStyleSetup();
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-ink-50/30">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-white px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-ink-900">
            {firstTime ? "Pick a look for your book" : "Art style"}
          </h1>
          <p className="mt-0.5 hidden text-sm text-ink-500 sm:block">
            {firstTime
              ? "This sets the visual direction for every character and page."
              : "Choose a new look and we’ll update the existing artwork for you."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!firstTime && dirty && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            disabled={!chosen || busy}
            rightIcon={<ArrowRight className="size-4" />}
            onClick={onPrimary}
          >
            {firstTime ? "Choose page size" : dirty ? "Apply style" : "Done"}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-6">
          {needsRenewWarn && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 sm:text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1 leading-snug">
                <p className="font-semibold text-amber-950">Existing art will get new versions</p>
                <p className="mt-1 text-amber-900/85 text-xs sm:text-sm">
                  Your cast and pages were drawn in{" "}
                  <span className="font-medium text-amber-950">{committedLabel}</span>. Once you confirm{" "}
                  <span className="font-medium text-amber-950">{draftLabel}</span>, we’ll automatically create new
                  versions in the new style — cast looks first, then pages using those looks.
                </p>
                <p className="mt-1.5 text-xs font-semibold text-amber-800/90">
                  {[
                    renew.cast > 0 &&
                      `${renew.cast} cast look${renew.cast === 1 ? "" : "s"}`,
                    renew.pages > 0 &&
                      `${renew.pages} page${renew.pages === 1 ? "" : "s"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
          )}

          <StyleStep
            artStyle={draft}
            committedArtStyle={firstTime ? undefined : committed}
            onChange={setDraft}
          />
        </div>
      </div>

      <StyleRenewConfirm
        open={confirmOpen}
        busy={busy}
        committedLabel={committedLabel}
        draftLabel={draftLabel}
        castCount={renew.cast}
        pageIds={styleRenewTargets(project).pageIds}
        onClose={() => !busy && setConfirmOpen(false)}
        onConfirm={() => void confirmAndRenew()}
      />
    </div>
  );
}

function StyleRenewConfirm({
  open,
  busy,
  committedLabel,
  draftLabel,
  castCount,
  pageIds,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  committedLabel: string;
  draftLabel: string;
  castCount: number;
  pageIds: string[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const pageCount = pageIds.length;
  // Covers are priced as covers, so the quote matches what actually gets spent.
  const range = useImageBatchRange(styleRenewEstimateParts(castCount, pageIds));
  const sparks = useAppConfigStore((s) => s.sparks);
  const balance = useSparksStore((s) => s.balance);
  const openWallet = useSparksUiStore((s) => s.openWallet);

  const estimate = range?.maxSparks ?? 0;
  const sparksMatter = sparks.enabled && estimate > 0;
  const canAfford =
    !sparksMatter || balance - estimate >= -sparks.maxNegativeSparks;
  const shortfall = sparksMatter
    ? Math.max(1, Math.ceil(estimate - balance))
    : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Update art style?"
      size="max-w-md"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {canAfford ? (
            <Button loading={busy} onClick={onConfirm}>
              <span className="inline-flex items-center">
                Create new versions
                <SparkEstimateCost range={range} />
              </span>
            </Button>
          ) : (
            <Button
              leftIcon={<Sparkles className="size-4" />}
              onClick={() => openWallet(shortfall)}
            >
              Top up Sparks
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-ink-600">
        <p>
          Switch from <span className="font-semibold text-ink-800">{committedLabel}</span> to{" "}
          <span className="font-semibold text-ink-800">{draftLabel}</span>?
        </p>
        <p>
          Once you confirm, we’ll automatically create new versions in the new style — cast
          reference sheets first, then pages using those updated looks.
        </p>
        <ul className="list-inside list-disc text-ink-500">
          {castCount > 0 && (
            <li>
              {castCount} cast look{castCount === 1 ? "" : "s"}
            </li>
          )}
          {pageCount > 0 && (
            <li>
              {pageCount} page illustration{pageCount === 1 ? "" : "s"}
            </li>
          )}
        </ul>

        <p className="flex items-start gap-2 rounded-xl bg-ink-50 px-3 py-2 text-ink-700 ring-1 ring-ink-100">
          <Clock className="mt-0.5 size-4 shrink-0 text-ink-400" />
          <span>
            This usually takes a few minutes. Each look and page shows its own progress, and you
            can keep working while they render.
          </span>
        </p>

        {sparksMatter && (
          <div
            className={
              canAfford
                ? "rounded-xl bg-magic-50 px-3 py-2 text-magic-900 ring-1 ring-magic-200/60"
                : "rounded-xl bg-amber-50 px-3 py-2 text-amber-950 ring-1 ring-amber-200"
            }
          >
            <p className="flex flex-wrap items-center gap-1.5 font-medium">
              Estimated cost
              <SparkEstimateCost range={range} className="ml-0" />
            </p>
            <p className="mt-1 text-xs opacity-90">
              You have {balance.toLocaleString()} Spark{balance === 1 ? "" : "s"}
              {canAfford
                ? " — enough to start."
                : ` — you need about ${shortfall.toLocaleString()} more before we can change the style.`}
            </p>
            {!canAfford && (
              <p className="mt-1.5 text-xs font-medium">
                Top up to continue. The style won’t change until you have enough Sparks and confirm.
              </p>
            )}
            {canAfford && (
              <p className="mt-1 text-xs opacity-80">
                You can top up more anytime from your account.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
