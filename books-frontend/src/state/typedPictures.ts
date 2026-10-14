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
import { agedPortraits } from "../core/guide/pictureSettling";
import { redrawModeFor, type RedrawMode } from "../core/guide/redrawMode";
import type { GuideTarget } from "../core/guide/target";
import type { Project } from "../core/types";
import { useAppConfigStore } from "./appConfigStore";
import { illustrationActionFor, portraitUnits, redrawUnits, startPortraits, startRedraw } from "./chatGeneration";
import { quoteKey, useChatStudio, type RedrawRequest } from "./chatStudio";
import { useJobsStore } from "./jobsStore";
import { clientReferenceLimits } from "./referenceLimits";
import { markStarted, portraitsToAutoStart, usePortraitStartStore } from "./portraitAutoStart";
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

/** A request split into one per picture: the target, then each person changed with it. */
export function redrawEach(request: RedrawRequest): RedrawRequest[] {
  const { more, ...first } = request;
  return [
    first,
    ...(more ?? []).map(
      (person): RedrawRequest => ({
        target: { kind: "person", castId: person.castId, name: person.name },
        instruction: person.instruction,
        ...(person.mode ? { mode: person.mode } : {}),
      }),
    ),
  ];
}

/** The names a request is about, in the order asked. */
export function redrawNames(request: RedrawRequest): string[] {
  return redrawEach(request).map((each) => (each.target.kind === "person" ? each.target.name : redrawSubject(each.target)));
}

/** What each picture changes by: one sentence for one picture, else one per person. */
export function redrawInstructions(request: RedrawRequest): string | Record<string, string> {
  if (!request.more?.length) return request.instruction;
  const out: Record<string, string> = {};
  for (const each of redrawEach(request)) {
    if (each.target.kind === "person") out[each.target.castId] = each.instruction;
  }
  return out;
}

/** What a redraw is quoted as, so the button and the automatic start share one quote. */
export function redrawQuoteParts(
  project: Project,
  request: RedrawRequest,
): { units: GenerationQuoteUnit[]; extraKey: string; mode: RedrawMode } {
  const parts = redrawEach(request).map((each) => {
    const { target, instruction } = each;
    const mode = redrawModeOf(project, each);
    return {
      units:
        target.kind === "person"
          ? redrawUnits(project, target.castId, "portrait", mode)
          : redrawUnits(project, target.unitId, illustrationActionFor(target.unitId), mode),
      extraKey: `${mode}:${instruction.slice(0, 40)}`,
      mode,
    };
  });
  return {
    units: parts.flatMap((part) => part.units),
    extraKey: parts.map((part) => part.extraKey).join("|"),
    mode: parts[0]!.mode,
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
    const outcome = await autoStart("redraw", units, extraKey, (quote) => startRedraw(quote, redrawInstructions(request)));
    if (outcome === "started") {
      markStarted(
        redrawEach(request).flatMap((each) => (each.target.kind === "person" ? [each.target.castId] : [])),
      );
    }
    return outcome;
  });
}

/** What a message started without being asked to, for the line that says so. */
export interface SettledPictures {
  line: "redrawStarting" | "portraitsStarting";
  names: string[];
}

/**
 * Start the pictures a typed message made necessary, if they are cheap and
 * affordable: the portrait of somebody whose age or kind now looks different
 * (`agedPortraits`), else the portraits a look or a style choice made possible
 * (`chose`), which is what tapping the same choice does.
 *
 * At most one start per message, and only through the gate every typed picture
 * change goes through (`autoStart`): the admin's `autoSpendSparks`, the
 * balance, nothing already drawing. Anything else leaves the button the chat
 * already shows for those pictures, so the worst case is today's behavior.
 *
 * `before` is the book as the message found it: a picture counts only when it
 * was fine then and is not now, so a book that was already waiting for a
 * portrait is never started by a message about something else.
 */
export async function autoStartAfterTurn(args: {
  before: Project;
  /** People a skill of this message already draws. */
  skip?: readonly string[];
  /** The message chose a look or a style. */
  chose: boolean;
}): Promise<SettledPictures | null> {
  try {
    const project = useProjectsStore.getState().current();
    if (!project) return null;
    const skip = new Set(args.skip ?? []);
    const active = useJobsStore.getState().activeUnitIds;
    const aged = agedPortraits(args.before, project).filter((person) => !skip.has(person.castId) && !active.has(person.castId));
    if (aged.length > 0) {
      const [first, ...more] = aged as [(typeof aged)[number], ...(typeof aged)[number][]];
      const request: RedrawRequest = {
        target: { kind: "person", castId: first.castId, name: first.name },
        instruction: "",
        mode: "new",
        ...(more.length > 0
          ? { more: more.map((person) => ({ castId: person.castId, name: person.name, instruction: "", mode: "new" as const })) }
          : {}),
      };
      return (await autoStartRedraw(request)) === "started"
        ? { line: "redrawStarting", names: aged.map((person) => person.name) }
        : null;
    }
    if (!args.chose) return null;
    const waiting = new Set(portraitsToAutoStart(args.before).map((member) => member.id));
    const ready = portraitsToAutoStart(project).filter((member) => !waiting.has(member.id) && !skip.has(member.id));
    if (ready.length === 0) return null;
    return (await autoStartNamedPortraits(ready.map((member) => member.id))) === "started"
      ? { line: "portraitsStarting", names: ready.map((member) => member.name.trim()) }
      : null;
  } catch {
    return null;
  }
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
