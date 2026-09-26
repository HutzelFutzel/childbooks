/**
 * Direct edits the reader makes on the book pane. Typing on the book never
 * redraws a picture; each of these only changes the book, and the journey
 * follows from it.
 */
import { authoringOf, withAuthoring } from "../../core/guide/projectState";
import { effectiveCharacterAgeYears } from "../../core/book/characterAge";
import { normalizeAnchorName } from "../../core/book/anchorRefs";
import { manuscriptHash, withCastResolved } from "../../core/guide/ownWords";
import {
  assignStyleSource,
  keepStyleSourceOnly,
  stageStyleSource,
  styleSourceAsNewCast,
} from "../../core/guide/styleSource";
import { briefOf, namedCast, newCastMember } from "../../core/story/brief";
import type {
  ArtStyleSelection,
  HardcoverDecision,
  Project,
  SourceArtRef,
  StoryCastMember,
} from "../../core/types";
import { useProjectsStore } from "../../state/projectsStore";
import { bookSizeFromAspect } from "../../core/config/options";
import type { CompositionMode } from "../../core/book/layouts";

function patch(mutator: (project: Project) => Project): Promise<void> {
  return useProjectsStore.getState().patchCurrent(mutator);
}

export function chooseStyle(presetId: string): Promise<void> {
  return patch((p) => ({
    ...p,
    config: { ...p.config, artStyle: { presetId, origin: "preset" }, styleReady: true },
  }));
}

export function chooseDerivedStyle(style: ArtStyleSelection): Promise<void> {
  return patch((p) => ({
    ...p,
    config: { ...p.config, artStyle: style, styleReady: true },
  }));
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
  await patch((p) => withAuthoring(p, { cover: { ...p.authoringState?.cover, subtitle } }));
  await store.setCoverSubtitle(store.currentId, subtitle);
}

export function setAuthor(author: string): Promise<void> {
  return patch((p) => withAuthoring(p, { cover: { ...p.authoringState?.cover, author } }));
}

function withCast(p: Project, map: (cast: StoryCastMember[]) => StoryCastMember[]): Project {
  const brief = briefOf(p.config);
  return { ...p, config: { ...p.config, storyBrief: { ...brief, cast: map(brief.cast ?? []) } } };
}

export function updateCastMember(id: string, changes: Partial<StoryCastMember>): Promise<void> {
  return patch((p) => {
    const clearsEstimate =
      typeof changes.age === "number" || typeof changes.ageMonths === "number";
    const nextChanges = clearsEstimate
      ? { ...changes, visualAge: undefined }
      : changes;
    const previous = briefOf(p.config).cast?.find((member) => member.id === id);
    let next = withCastResolved(
      withCast(p, (cast) =>
        cast.map((member) =>
          member.id === id ? { ...member, ...nextChanges } : member,
        ),
      ),
    );
    const ageChanged =
      "age" in changes || "ageMonths" in changes || "visualAge" in changes;
    if (!ageChanged || !previous || !next.anchors) return next;
    const member = briefOf(next.config).cast?.find((candidate) => candidate.id === id);
    if (!member) return next;
    const years = effectiveCharacterAgeYears(member);
    const names = new Set(
      [previous.name, member.name].map(normalizeAnchorName).filter(Boolean),
    );
    next = {
      ...next,
      anchors: next.anchors.map((anchor) =>
        anchor.type === "character" &&
        [normalizeAnchorName(anchor.name), ...(anchor.aliasNames ?? []).map(normalizeAnchorName)]
          .some((name) => names.has(name))
          ? {
              ...anchor,
              ageYears: years,
              ageSource:
                member.age !== undefined || member.ageMonths !== undefined
                  ? "author"
                  : member.visualAge?.source === "story"
                    ? "story"
                    : "suggested",
            }
          : anchor,
      ),
    };
    return next;
  });
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
