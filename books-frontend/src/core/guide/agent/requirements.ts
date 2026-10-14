/**
 * What a skill needs before it can run, checked against the book.
 *
 * Specifications, not flow: each requirement is a pure predicate plus the
 * remedy that gets past it. "Draw the book" needs portraits; the chat answers
 * with the missing step and the skill that does it, instead of failing or
 * pretending. The server runs the same predicates before a paid job starts
 * (`functions/src/jobs.ts`), so a request that skips the chat is held to them too.
 */
import { authoringOf } from "../projectState";
import { coverWordsSettled } from "../coverWords";
import { storyHandedOver } from "../ownWords";
import { currentPortrait, portraitStatus } from "../portrait";
import { briefOf, namedCast } from "../../story/brief";
import { isPerson, missingDetails } from "../../story/castKinds";
import { joinGuideNames } from "../copy";
import type { GuideLineCandidate } from "../speech";
import type { Project, StoryCastMember } from "../../types";
import type { CommandContext, Remedy, RequirementId } from "./types";

function cast(project: Project) {
  return namedCast(briefOf(project.config)).filter((member) => member.name.trim());
}

/**
 * A person nobody has an age for: not the reader, not the story, and not the
 * drawing estimate the cast card shows beside the name. An estimate is enough
 * to draw from, so it is never asked about; the reader changes it on the card
 * or in the chat if it is wrong.
 */
export function personNeedsStatedAge(
  member: Pick<StoryCastMember, "kind" | "bodyPlan" | "age" | "ageMonths" | "visualAge">,
): boolean {
  return (
    isPerson(member) &&
    member.age === undefined &&
    member.ageMonths === undefined &&
    member.visualAge === undefined
  );
}

/** People still missing a stated age. Portraits need one; an animal, toy or creature doesn't. */
export function peopleNeedingStatedAge(project: Project): ReturnType<typeof cast> {
  return cast(project).filter((member) => personNeedsStatedAge(member));
}

/** People still missing an age. Portraits need one; an animal, toy or creature doesn't. */
export function peopleWithoutAge(project: Project): string[] {
  return peopleNeedingStatedAge(project).map((member) => member.name.trim());
}

/** The line that asks for ages nobody has given or estimated, before any portrait. */
export function castAgesAskLine(people: readonly { name: string }[]): GuideLineCandidate {
  const names = people.map((person) => person.name);
  return {
    key: people.length > 1 ? "castAgesAskMany" : "castAgesAsk",
    priority: "question",
    vars: { names },
  };
}

/** Animals, toys and creatures nobody has said the kind of yet. Their portrait needs it. */
export function charactersWithoutSpecies(project: Project): string[] {
  return cast(project)
    .filter((member) => missingDetails(member).includes("species"))
    .map((member) => member.name.trim());
}

/** People whose portrait is missing or out of date. */
export function peopleWithoutPortrait(project: Project): { id: string; name: string }[] {
  return cast(project)
    .filter((member) => !currentPortrait(project, member.id) || portraitStatus(project, member.id) !== "current")
    .map((member) => ({ id: member.id, name: member.name.trim() }));
}

interface RequirementSpec {
  /** Plain description, for the admin skills table and the help sheet. */
  label: string;
  met: (project: Project, ctx: Pick<CommandContext, "guest">) => boolean;
  remedy: (project: Project) => Omit<Remedy, "requirement">;
}

export const REQUIREMENTS: Record<RequirementId, RequirementSpec> = {
  notLocked: {
    label: "The pages have not started",
    met: (p) => authoringOf(p).lockedAt === undefined,
    remedy: () => ({
      what: "the pages are already being drawn, so changes now happen on the pages themselves.",
      view: "pages",
    }),
  },
  pagesStarted: {
    label: "The pages have been drawn",
    met: (p) => authoringOf(p).lockedAt !== undefined,
    remedy: () => ({ what: "the pages of the book. They come after the book is drawn.", view: "pages" }),
  },
  storyIdle: {
    label: "The story is not being written right now",
    met: (p) => authoringOf(p).storyRun?.status !== "running",
    remedy: () => ({ what: "the story to finish writing. It'll only take a moment.", view: "story" }),
  },
  hasStory: {
    label: "There is a story",
    met: (p) => p.config.storyText.trim().length > 0,
    remedy: () => ({ what: "a story. Tell me who it's for and what should happen, or paste your own.", view: "story" }),
  },
  hasCast: {
    label: "Someone is in the book",
    met: (p) => cast(p).length > 0,
    remedy: () => ({ what: "someone in the book. Who should be in the story?", command: "addPerson", view: "cast" }),
  },
  castAges: {
    label: "Every person has an age, and every other character a kind",
    met: (p) => peopleWithoutAge(p).length === 0 && charactersWithoutSpecies(p).length === 0,
    remedy: (p) => {
      const ages = peopleWithoutAge(p);
      if (ages.length > 0) {
        return { what: `an age for ${joinGuideNames(ages)}, so the pictures look right.`, command: "setPersonAge", view: "cast" };
      }
      return {
        what: `to know what ${joinGuideNames(charactersWithoutSpecies(p))} is, so I draw the right thing.`,
        command: "setPersonKind",
        view: "cast",
      };
    },
  },
  styleChosen: {
    label: "The book has a look",
    met: (p) => p.config.styleReady !== false && Boolean(p.config.artStyle?.presetId || p.config.artStyle?.origin),
    remedy: () => ({ what: "a look for the book. Pick one of the styles.", command: "setStyle", view: "style" }),
  },
  portraitsDrawn: {
    label: "Everyone has a current portrait",
    met: (p) => cast(p).length > 0 && peopleWithoutPortrait(p).length === 0,
    remedy: (p) => {
      const missing = peopleWithoutPortrait(p).map((m) => m.name);
      return {
        what: missing.length > 0
          ? `portraits of ${joinGuideNames(missing)}, so everyone looks the same on every page.`
          : "someone in the book to draw.",
        command: "drawPortraits",
        view: "cast",
      };
    },
  },
  bookSetup: {
    label: "The book's size and page layout are chosen",
    met: (p) => {
      const setup = authoringOf(p).bookSetup;
      return Boolean(setup?.formatConfirmedAt && setup.layoutConfirmedAt);
    },
    remedy: () => ({ what: "the book's size and page layout. I'll ask about them next." }),
  },
  storyAccepted: {
    label: "The reader said their own story is done",
    met: (p) => storyHandedOver(p),
    remedy: () => ({
      what: "your finished story. Tap My story is ready when it's done, and I'll read it.",
      command: "finishStory",
      view: "story",
    }),
  },
  coverWords: {
    label: "The words on the cover are settled",
    met: (p) => coverWordsSettled(p),
    remedy: () => ({ what: "a quick look at the words on the cover. Tap Looks good when they're right." }),
  },
  signedIn: {
    label: "The reader has an account",
    met: (_p, ctx) => !ctx.guest,
    remedy: () => ({ what: "an account, so the book is saved to you.", command: "signIn" }),
  },
};

/** The first requirement that is not met, as a remedy; null when all are. */
export function firstUnmet(
  project: Project,
  requires: readonly RequirementId[],
  ctx: Pick<CommandContext, "guest">,
): Remedy | null {
  for (const id of requires) {
    const spec = REQUIREMENTS[id];
    if (!spec.met(project, ctx)) return { requirement: id, ...spec.remedy(project) };
  }
  return null;
}
