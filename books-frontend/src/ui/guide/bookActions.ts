/**
 * Direct edits the reader makes on the book pane. Typing on the book never
 * redraws a picture; each of these only changes the book, and the journey
 * follows from it.
 */
import { authoringOf, withAuthoring } from "../../core/guide/projectState";
import type { CoverLines } from "../../core/book/coverLines";
import { coverCardLines } from "../../core/guide/coverWords";
import { manuscriptHash, withCastResolved } from "../../core/guide/ownWords";
import { noteStyleChange, withLooksDecided, withPresetStyle, withStyleReverted } from "../../core/guide/portrait";
import {
  assignStyleSource,
  keepStyleSourceOnly,
  stageStyleSource,
  styleSourceAsNewCast,
} from "../../core/guide/styleSource";
import { briefOf, namedCast, newCastMember } from "../../core/story/brief";
import { relationsOf, withRelation } from "../../core/story/relations";
import type {
  ArtStyleSelection,
  HardcoverDecision,
  Project,
  SourceArtRef,
  StoryCastMember,
} from "../../core/types";
import { illustrationWithVersion, neighbourVersion, pictureHistory, withPortraitVersion } from "../../core/guide/history";
import type { GuideTarget } from "../../core/guide/target";
import { applyBookTitle, applyCoverLine, useProjectsStore } from "../../state/projectsStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { startStoryRevision } from "../../platform/storyRevisions";
import { notify } from "../lib/notify";
import { changePersonAge, withAgeMates, type AgeValue } from "../../core/guide/ageSync";
import { withMemberChanges } from "../../core/guide/agent/commands/shared";
import { cleanName, renamePersonEverywhere, type RenameRefusal } from "../../core/guide/rename";
import { foldName } from "../../core/guide/agent/resolve";
import { bookSizeFromAspect } from "../../core/config/options";
import type { CompositionMode } from "../../core/book/layouts";

function patch(mutator: (project: Project) => Project): Promise<void> {
  return useProjectsStore.getState().patchCurrent(mutator);
}

/**
 * Take a preset as the book's look. When the look was a drawing's, the drawing
 * stops being the book's style with it (one change, never half of it); the
 * reader was asked first, here and in the chat.
 */
export function chooseStyle(presetId: string): Promise<void> {
  const generationReference = useAppConfigStore
    .getState()
    .artStyles.styles.find((style) => style.id === presetId)
    ?.generationReference;
  return patch((p) =>
    withPresetStyle(p, {
      presetId,
      origin: "preset",
      ...(generationReference ? { generationReference } : {}),
    }),
  );
}

export function chooseDerivedStyle(style: ArtStyleSelection): Promise<void> {
  return patch((p) =>
    withAuthoring(
      noteStyleChange(p, {
        ...p,
        config: { ...p.config, artStyle: style, styleReady: true },
      }),
      { retiredArtwork: undefined },
    ),
  );
}

/** "Keep the old look": the style the portraits were drawn in comes back, at no cost. */
export function keepOldLook(): Promise<void> {
  return patch(withStyleReverted);
}

export function stageDrawingForStyle(ref: SourceArtRef): Promise<void> {
  return patch((p) => stageStyleSource(p, ref));
}

export function assignStagedDrawing(castId: string): Promise<void> {
  return patch((p) => assignStyleSource(p, castId));
}

export function keepStagedDrawingForStyleOnly(): Promise<void> {
  return patch(keepStyleSourceOnly);
}

export function makeStagedDrawingNewCast(): Promise<void> {
  return patch(styleSourceAsNewCast);
}

/** "Let the story decide": these people are drawn from the story, and the chat stops asking. */
export function decideLooksFromStory(castIds: readonly string[]): Promise<void> {
  return patch((p) => withLooksDecided(p, castIds));
}

/** Whether twins are drawn alike: the one question the looks step asks about them. */
export function decideTwinsLook(ids: readonly string[], lookAlike: "identical" | "different"): Promise<void> {
  return patch((p) => {
    const brief = briefOf(p.config);
    const relation = relationsOf(brief).find(
      (item) => item.type === "twins" && item.ids.length === ids.length && ids.every((id) => item.ids.includes(id)),
    );
    if (!relation) return p;
    return { ...p, config: { ...p.config, storyBrief: withRelation(brief, { ...relation, lookAlike }) } };
  });
}

export function decideHardcover(decision: HardcoverDecision): Promise<void> {
  return patch((p) => withAuthoring(p, { hardcover: decision }));
}

/** One format command shared by every Chat and book-pane surface. */
export function chooseBookFormat(
  productSku: string,
  aspect: number,
): Promise<void> {
  return patch((p) => {
    const setup = authoringOf(p).bookSetup;
    const formatChanged = p.config.productSku !== productSku;
    return withAuthoring(
      {
        ...p,
        config: {
          ...p.config,
          productSku,
          bookSize: bookSizeFromAspect(aspect),
        },
      },
      {
        bookSetup: {
          formatConfirmedAt: Date.now(),
          // A different shape can change which layouts are available. Ask the
          // reader to review the visible result again instead of carrying a
          // confirmation across an incompatible format.
          layoutConfirmedAt: formatChanged
            ? undefined
            : setup?.layoutConfirmedAt,
        },
        planRequestedFor: undefined,
        planBasis:
          formatChanged && setup?.formatConfirmedAt
            ? undefined
            : authoringOf(p).planBasis,
      },
    );
  });
}

/** One layout command shared by every Chat and book-pane surface. */
export function chooseBookLayout(
  layoutId: string,
  compositionMode: CompositionMode,
): Promise<void> {
  return patch((p) => {
    const layoutChanged =
      p.config.layoutId !== layoutId ||
      p.config.compositionMode !== compositionMode;
    return withAuthoring(
      {
        ...p,
        config: { ...p.config, layoutId, compositionMode },
      },
      {
        bookSetup: {
          ...authoringOf(p).bookSetup,
          layoutConfirmedAt: Date.now(),
        },
        planRequestedFor: undefined,
        planBasis: layoutChanged
          ? authoringOf(p).planBasis ?? (p.screenplay ? "setup-changed" : undefined)
          : authoringOf(p).planBasis,
      },
    );
  });
}

export async function setTitle(title: string): Promise<void> {
  const store = useProjectsStore.getState();
  const id = store.currentId;
  if (!id) return;
  await store.setBookTitle(id, title);
  await patch((p) => withAuthoring(p, { cover: { ...p.authoringState?.cover, titleEdited: true } }));
}

export async function setSubtitle(subtitle: string): Promise<void> {
  const store = useProjectsStore.getState();
  if (!store.currentId) return;
  await store.setCoverSubtitle(store.currentId, subtitle);
}

export async function setAuthor(author: string): Promise<void> {
  const store = useProjectsStore.getState();
  if (!store.currentId) return;
  await store.setCoverAuthor(store.currentId, author);
}

/**
 * Settle the cover's words. Given lines are the card's; without them, what the
 * card shows now. Either way the cover says exactly what the reader saw: a
 * subtitle or author left empty is written as "none", never read from the plan.
 */
export async function confirmCoverWords(lines?: Partial<CoverLines>): Promise<void> {
  const store = useProjectsStore.getState();
  const project = store.current();
  if (!project) return;
  await store.settleCoverWords(project.id, { ...coverCardLines(project), ...lines });
}

function withCast(p: Project, map: (cast: StoryCastMember[]) => StoryCastMember[]): Project {
  const brief = briefOf(p.config);
  return { ...p, config: { ...p.config, storyBrief: { ...brief, cast: map(brief.cast ?? []) } } };
}

export function updateCastMember(
  id: string,
  changes: Partial<StoryCastMember>,
  options: { mates?: boolean } = {},
): Promise<void> {
  return patch((p) => {
    const previous = briefOf(p.config).cast?.find((member) => member.id === id);
    const next = withMemberChanges(p, id, changes);
    const setsAge = typeof changes.age === "number" || typeof changes.ageMonths === "number";
    if (!setsAge || !previous || options.mates === false) return next;
    return withAgeMates(
      next,
      id,
      { age: previous.age, ageMonths: previous.ageMonths },
      { age: changes.age, ageMonths: changes.ageMonths },
    ).project;
  });
}

export type CastRenameOutcome =
  | { ok: true }
  | { ok: false; reason: RenameRefusal | "busy" };

/**
 * Give a cast member a new name, in the cast and everywhere the old one is
 * written: the story, the page plan, the title and subtitle, the pictures'
 * references. The card, the story and the chat all come here (or to the same
 * `renamePersonEverywhere`), so the book never names someone two ways.
 */
export async function renameCastMember(id: string, rawName: string): Promise<CastRenameOutcome> {
  const project = useProjectsStore.getState().current();
  const member = project ? briefOf(project.config).cast?.find((candidate) => candidate.id === id) : undefined;
  if (!project || !member) return { ok: false, reason: "unknown" };
  const name = cleanName(rawName);
  if (!name) return { ok: false, reason: "empty" };
  const previous = member.name.trim();
  if (!previous) {
    // Nobody has been called anything yet: there is nothing to carry through the book.
    const taken = namedCast(briefOf(project.config)).some(
      (other) => other.id !== id && foldName(other.name) === foldName(name),
    );
    if (taken) return { ok: false, reason: "taken" };
    await updateCastMember(id, { name });
    return { ok: true };
  }
  // The story text is being written or revised under the name: wait for it, rather than lose either.
  if (authoringOf(project).storyRun?.status === "running") return { ok: false, reason: "busy" };
  const preview = renamePersonEverywhere(project, id, name);
  if ("refused" in preview) return { ok: false, reason: preview.refused };
  await patch((p) => {
    const renamed = renamePersonEverywhere(p, id, name);
    if ("refused" in renamed) return p;
    let next = withCastResolved(renamed.project);
    if (renamed.title !== null) {
      next = applyBookTitle(next, renamed.title);
      next = withAuthoring(next, { cover: { ...authoringOf(next).cover, titleEdited: true } });
    }
    if (renamed.subtitle !== null) next = applyCoverLine(next, "subtitle", renamed.subtitle);
    return next;
  });
  return { ok: true };
}

/**
 * Set a cast member's age (or clear it), in the cast, the anchors and the
 * portrait's inputs. When the story states a different age for them, ask for
 * the story to be revised to match: the reader reviews each change before it lands.
 */
export async function setCastMemberAge(id: string, age: AgeValue): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project) return;
  const changed = changePersonAge(project, id, age);
  if (!changed) return;
  await patch((p) => changePersonAge(p, id, age)?.project ?? p);
  if (changed.revise) await reviseStoryFor(changed.revise);
}

/** Start a reviewed change to the story, and take the reader to it. */
export async function reviseStoryFor(instruction: string): Promise<void> {
  const project = useProjectsStore.getState().current();
  if (!project || !project.config.storyText.trim()) return;
  try {
    await startStoryRevision(project, instruction);
  } catch (error) {
    notify.error(error);
    return;
  }
  const { useChatStudio } = await import("../../state/chatStudio");
  const studio = useChatStudio.getState();
  studio.setView("story");
  studio.say([{ key: "storyRevising", priority: "result" }], { unprompted: true });
}

export async function addCastMember(): Promise<string> {
  const member = newCastMember();
  await patch((p) => withCast(p, (cast) => [...cast, member]));
  return member.id;
}

export function removeCastMember(id: string): Promise<void> {
  return patch((p) =>
    withCastResolved(withCast(p, (cast) => cast.filter((m) => m.id !== id))),
  );
}

export function confirmCastMembers(): Promise<void> {
  return patch(withCastResolved);
}

export async function addCastMemberManually(): Promise<string> {
  const member = newCastMember();
  await patch((p) => {
    const next = withCast(p, (cast) => [...cast, member]);
    return withAuthoring(next, {
      extraction: {
        storyHash: manuscriptHash(next.config.storyText),
        at: Date.now(),
        names: namedCast(briefOf(next.config)).map((item) => item.name.trim()),
        unresolved: [],
      },
    });
  });
  return member.id;
}

/**
 * Show another version of a picture in the book, and make it the book's. Free:
 * nothing is drawn, and the versions it steps past are kept. A portrait takes
 * the description it was drawn from back with it (`withPortraitVersion`).
 */
export async function choosePictureVersion(target: GuideTarget, versionId: string): Promise<void> {
  if (target.kind === "person") {
    await patch((p) => withPortraitVersion(p, target.castId, versionId));
    return;
  }
  const project = useProjectsStore.getState().current();
  const tree = project ? illustrationWithVersion(project, target.unitId, versionId) : null;
  if (tree) await useProjectsStore.getState().setIllustration(target.unitId, tree);
}

/** One step through a picture's versions: -1 for the earlier one, 1 for the later one. */
export async function stepPicture(target: GuideTarget, delta: number): Promise<boolean> {
  const project = useProjectsStore.getState().current();
  const history = project ? pictureHistory(project, target) : null;
  const next = history ? neighbourVersion(history, delta) : null;
  if (!next) return false;
  await choosePictureVersion(target, next);
  return true;
}
