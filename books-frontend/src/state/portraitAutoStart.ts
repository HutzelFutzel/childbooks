/**
 * Portraits start from the choice that makes them possible: the style tap, or a
 * person's look tap once the book has a style. That choice shows the price
 * first, and a start never goes above it; anything else (a higher price, too
 * few Sparks, no estimate, a missing age) leaves the portraits button in the
 * chat, which shows the real quote, under a line that says why.
 *
 * While a choice is deciding, and until a started portrait's task arrives from
 * the server, the journey counts those people as drawing
 * (`usePortraitStartStore`), so the portraits button never flashes up in the
 * gap between saving the choice and the job existing.
 */
import { create } from "zustand";
import type { GenerationQuoteUnit } from "../core/billing/generationQuote";
import { cappedReferenceCount, plannedPortraitReferences } from "../core/billing/referencePlan";
import { CUSTOMER_IMAGE_TIER } from "../core/config/modelConfig";
import { joinGuideNames } from "../core/guide/copy";
import { personNeedsStatedAge } from "../core/guide/agent/requirements";
import { lookDecided, portraitReferencePlan, portraitsToDraw } from "../core/guide/portrait";
import { authoringOf } from "../core/guide/projectState";
import { LIKENESS_PHOTOS_MAX, type Project, type StoryCastMember } from "../core/types";
import { tierSparkRange } from "../ui/hooks/useTierEstimate";
import { useAppConfigStore } from "./appConfigStore";
import { portraitUnits, startPortraits } from "./chatGeneration";
import { quoteKey, useChatStudio, type TapOutcome } from "./chatStudio";
import { useJobsStore } from "./jobsStore";
import { campaignMultiplierFor, usePriceOverridesStore } from "./priceOverridesStore";
import { useProjectsStore } from "./projectsStore";
import { clientReferenceLimits } from "./referenceLimits";
import { useSparksStore } from "./sparksStore";
import { currentActionMultiplier } from "./subscriptionStore";

interface PortraitStartState {
  /** Choices still deciding whether they start portraits. */
  deciding: number;
  /** People whose portraits were just started, by start time, until their task shows up. */
  started: Record<string, number>;
}

export const usePortraitStartStore = create<PortraitStartState>(() => ({ deciding: 0, started: {} }));

/** A job that never shows up must not hide the portraits button for good. */
const STARTED_GRACE_MS = 60_000;

function pruneStarted(): void {
  const { started } = usePortraitStartStore.getState();
  const entries = Object.entries(started);
  if (entries.length === 0) return;
  const { activeUnitIds, failedUnits } = useJobsStore.getState();
  const now = Date.now();
  const kept = entries.filter(
    ([id, at]) => !activeUnitIds.has(id) && !((failedUnits[id]?.at ?? 0) >= at) && now - at < STARTED_GRACE_MS,
  );
  if (kept.length !== entries.length) usePortraitStartStore.setState({ started: Object.fromEntries(kept) });
}

useJobsStore.subscribe(pruneStarted);

export function markStarted(ids: readonly string[]): void {
  const at = Date.now();
  usePortraitStartStore.setState((s) => ({
    started: { ...s.started, ...Object.fromEntries(ids.map((id) => [id, at])) },
  }));
  pruneStarted();
  setTimeout(pruneStarted, STARTED_GRACE_MS + 50);
}

/**
 * Save a choice, then start the portraits it makes possible at no more than
 * `capSparks`. The portraits button stays hidden while this decides.
 */
export async function chooseAndStartPortraits(
  choose: () => Promise<unknown>,
  capSparks: number | null,
): Promise<TapOutcome> {
  if (capSparks === null) {
    await choose();
    return {};
  }
  usePortraitStartStore.setState((s) => ({ deciding: s.deciding + 1 }));
  try {
    await choose();
    return await autoStartPortraits(capSparks);
  } finally {
    usePortraitStartStore.setState((s) => ({ deciding: Math.max(0, s.deciding - 1) }));
  }
}

function hasAge(member: StoryCastMember): boolean {
  return !personNeedsStatedAge(member);
}

/**
 * Who a start would draw: settled look, an age, no current portrait, not
 * already drawing. `assumeStyled` answers for the moment right after the style
 * tap; `alsoDecided` for the person whose look is being chosen.
 */
export function portraitsToAutoStart(
  project: Project,
  options: { assumeStyled?: boolean; alsoDecided?: readonly string[] } = {},
): StoryCastMember[] {
  if (authoringOf(project).lockedAt) return [];
  if (!options.assumeStyled && project.config.styleReady === false) return [];
  const active = useJobsStore.getState().activeUnitIds;
  const started = usePortraitStartStore.getState().started;
  const deciding = new Set(options.alsoDecided ?? []);
  return portraitsToDraw(project).filter(
    (m) => hasAge(m) && !active.has(m.id) && !(m.id in started) && (deciding.has(m.id) || lookDecided(project, m)),
  );
}

/**
 * What the style tap will start, as quote units: the book as a preset leaves
 * it (no reference drawing), so the quote shown is the one the start reuses.
 */
export function styleChoiceStartUnits(project: Project): { names: string[]; units: GenerationQuoteUnit[] } {
  const people = portraitsToAutoStart(project, { assumeStyled: true });
  const styled: Project = {
    ...project,
    config: { ...project.config, artStyle: { ...project.config.artStyle, referenceArt: undefined }, styleReady: true },
  };
  return {
    names: people.map((m) => m.name.trim()),
    units: portraitUnits(
      styled,
      people.map((m) => m.id),
    ),
  };
}

function portraitPrice(refs: number): number | null {
  const { sparks, modelCosts, imageCostStats, generationTuning } = useAppConfigStore.getState();
  if (!sparks.enabled) return 0;
  const overrides = usePriceOverridesStore.getState().actions;
  const multiplier =
    currentActionMultiplier("portrait") * campaignMultiplierFor(overrides, "portrait", CUSTOMER_IMAGE_TIER);
  const range = tierSparkRange(
    sparks,
    modelCosts,
    imageCostStats,
    generationTuning,
    "portrait",
    CUSTOMER_IMAGE_TIER,
    multiplier,
    "fresh",
    refs,
  );
  return range ? range.maxSparks : null;
}

/**
 * The most choosing a look for `castId` may start, whichever source is picked:
 * that person's portrait (priced for up to three photos) plus anyone else
 * already waiting. Null when it can't be priced, or would start nothing.
 */
export function lookChoiceStartEstimate(
  project: Project,
  castId: string,
): { names: string[]; maxSparks: number } | null {
  const people = portraitsToAutoStart(project, { alsoDecided: [castId], assumeStyled: true });
  const member = people.find((m) => m.id === castId);
  if (!member) return null;
  const limits = clientReferenceLimits("portrait");
  // A first drawing becomes the style itself, so it is never sent twice.
  const style = project.config.styleReady === false ? 0 : portraitReferencePlan(project, member).style.length;
  const options = [style, 1 + style, LIKENESS_PHOTOS_MAX + style];
  const own = options.map((refs) => portraitPrice(cappedReferenceCount(refs, limits, { required: refs > 0 })));
  if (own.some((price) => price === null)) return null;
  const others = othersPrice(project, people, [castId], limits);
  if (others === null) return null;
  return { names: people.map((m) => m.name.trim()), maxSparks: Math.max(...(own as number[])) + others };
}

/** What letting the story decide for `castIds` may start, with anyone already waiting. */
export function storyLooksStartEstimate(
  project: Project,
  castIds: readonly string[],
): { names: string[]; maxSparks: number } | null {
  if (project.config.styleReady === false) return null;
  const people = portraitsToAutoStart(project, { alsoDecided: castIds });
  if (people.length === 0) return null;
  const total = othersPrice(project, people, [], clientReferenceLimits("portrait"));
  return total === null ? null : { names: people.map((m) => m.name.trim()), maxSparks: total };
}

function othersPrice(
  project: Project,
  people: readonly StoryCastMember[],
  skip: readonly string[],
  limits: ReturnType<typeof clientReferenceLimits>,
): number | null {
  let total = 0;
  for (const other of people) {
    if (skip.includes(other.id)) continue;
    const price = portraitPrice(plannedPortraitReferences(project, other.id, limits));
    if (price === null) return null;
    total += price;
  }
  return total;
}

/**
 * Start everyone who can be drawn now, if the quote is within `capSparks` (the
 * price the reader was shown) and the balance covers it. Returns what the tap
 * should report; nothing when it left the choice to the portraits button.
 */
export async function autoStartPortraits(capSparks: number | null): Promise<TapOutcome> {
  if (capSparks === null) return {};
  const project = useProjectsStore.getState().current();
  if (!project) return {};
  const people = portraitsToAutoStart(project);
  if (people.length === 0) return {};
  const units = portraitUnits(
    project,
    people.map((m) => m.id),
  );
  const key = quoteKey("portraits", units);
  const names = joinGuideNames(people.map((m) => m.name.trim()));
  const declined = (reason: "portraitsNeedSparks" | "portraitsPriceChanged" | "portraitsNotStarted"): TapOutcome => ({
    reply: [{ key: reason, priority: "question", vars: { names } }],
  });
  const chat = useChatStudio.getState();
  await chat.ensureQuote(key, "portraits", units);
  const slot = useChatStudio.getState().quotes[key];
  if (slot?.status !== "ready") return declined("portraitsNotStarted");
  if (slot.quote.maximumSparks > capSparks) return declined("portraitsPriceChanged");
  const { balance, loading } = useSparksStore.getState();
  if (loading) return declined("portraitsNotStarted");
  if (balance < slot.quote.maximumSparks) return declined("portraitsNeedSparks");
  let started = false;
  try {
    await chat.confirm(key, async (quote) => {
      started = await startPortraits(quote);
      return started;
    });
  } catch {
    started = false;
  }
  if (!started) return declined("portraitsNotStarted");
  markStarted(people.map((m) => m.id));
  return {
    spent: true,
    reply: [{ key: "portraitsStarting", priority: "result", vars: { names } }],
  };
}
