/**
 * Pictures the reader asked for in words start on their own.
 *
 * "Make Dad's hair blue" is a clear request, so a priced button that repeats it
 * is only a second tap. The price is still honest: the quote is fetched first,
 * and a start never goes above the admin's `autoSpendSparks`, never past the
 * balance, and never while the same picture is already drawing. Anything else
 * (a dearer picture, too few Sparks, no estimate) leaves the priced button in
 * the chat, which says why. The earlier picture always stays in the history,
 * so a redraw the reader doesn't like is one tap to take back.
 *
 * Drawing the whole book never starts this way.
 */
import type { GenerationQuote, GenerationQuoteUnit } from "../core/billing/generationQuote";
import { pictureSubject } from "../core/guide/history";
import { redrawModeFor, type RedrawMode } from "../core/guide/redrawMode";
import type { GuideTarget } from "../core/guide/target";
import type { Project } from "../core/types";
import { useAppConfigStore } from "./appConfigStore";
import { illustrationActionFor, portraitUnits, redrawUnits, startPortraits, startRedraw } from "./chatGeneration";
import { quoteKey, useChatStudio, type RedrawRequest } from "./chatStudio";
import { useJobsStore } from "./jobsStore";
import { clientReferenceLimits } from "./referenceLimits";
import { markStarted, usePortraitStartStore } from "./portraitAutoStart";
import { useProjectsStore } from "./projectsStore";
import { useSparksStore } from "./sparksStore";

export type TypedStart = "started" | "needsSparks" | "declined";

/** What the change does: the reader's word for it, else the rule (`redrawModeFor`). */
export function redrawModeOf(project: Project, request: RedrawRequest): RedrawMode {
  const action = request.target.kind === "person" ? "portrait" : illustrationActionFor(request.target.unitId);
  const canEdit = clientReferenceLimits(action).referenceEditing;
  if (request.mode === "new") return "new";
  return redrawModeFor(project, request.target, { canEdit: request.target.kind === "person" ? canEdit : true });
}

/** What a redraw is quoted as, so the button and the automatic start share one quote. */
export function redrawQuoteParts(
  project: Project,
  request: RedrawRequest,
): { units: GenerationQuoteUnit[]; extraKey: string; mode: RedrawMode } {
  const { target, instruction } = request;
  const mode = redrawModeOf(project, request);
  return {
    units:
      target.kind === "person"
        ? redrawUnits(project, target.castId, "portrait", mode)
        : redrawUnits(project, target.unitId, illustrationActionFor(target.unitId), mode),
    extraKey: `${mode}:${instruction.slice(0, 40)}`,
    mode,
  };
}

/** Who or what a redraw is about, in the words a line uses. */
export const redrawSubject = pictureSubject;

async function autoStart(
  purpose: GenerationQuote["purpose"],
  units: GenerationQuoteUnit[],
  extraKey: string,
  start: (quote: GenerationQuote) => Promise<boolean>,
): Promise<TypedStart> {
  const cap = useAppConfigStore.getState().guide.agent.turn.autoSpendSparks;
  if (cap <= 0 || units.length === 0) return "declined";
  const active = useJobsStore.getState().activeUnitIds;
  if (units.some((unit) => active.has(unit.id))) return "declined";
  const key = quoteKey(purpose, units, extraKey);
  const chat = useChatStudio.getState();
  await chat.ensureQuote(key, purpose, units);
  const slot = useChatStudio.getState().quotes[key];
  if (slot?.status !== "ready") return "declined";
  const price = slot.quote.maximumSparks;
  if (price > cap) return "declined";
  const { balance, loading } = useSparksStore.getState();
  if (loading) return "declined";
  if (balance < price) return "needsSparks";
  let started = false;
  try {
    await chat.confirm(key, async (quote) => {
      started = await start(quote);
      return started;
    });
  } catch {
    started = false;
  }
  return started ? "started" : "declined";
}

/** Run `work` while the portraits button is held back, so it never flashes up in between. */
async function whileDeciding<T>(work: () => Promise<T>): Promise<T> {
  usePortraitStartStore.setState((s) => ({ deciding: s.deciding + 1 }));
  try {
    return await work();
  } finally {
    usePortraitStartStore.setState((s) => ({ deciding: Math.max(0, s.deciding - 1) }));
  }
}

/** Start a picture change the reader typed, if it is cheap and affordable. */
export async function autoStartRedraw(request: RedrawRequest): Promise<TypedStart> {
  const project = useProjectsStore.getState().current();
  if (!project) return "declined";
  const { units, extraKey } = redrawQuoteParts(project, request);
  return whileDeciding(async () => {
    const outcome = await autoStart("redraw", units, extraKey, (quote) => startRedraw(quote, request.instruction));
    if (outcome === "started" && request.target.kind === "person") markStarted([request.target.castId]);
    return outcome;
  });
}

/** Start the portraits the reader named ("draw Amanda"), if they are cheap and affordable. */
export async function autoStartNamedPortraits(castIds: readonly string[]): Promise<TypedStart> {
  const project = useProjectsStore.getState().current();
  if (!project) return "declined";
  const units = portraitUnits(project, castIds);
  return whileDeciding(async () => {
    const outcome = await autoStart("portraits", units, "", (quote) => startPortraits(quote));
    if (outcome === "started") markStarted(castIds);
    return outcome;
  });
}
