/** Skills for the people in the book and the places and things that get drawn. */
import { briefOf, namedCast, newCastMember } from "../../../story/brief";
import type { CastKind, CastRelation, CastRelationType, Project, StoryCastMember } from "../../../types";
import { CAST_KINDS, CAST_KIND_SPECS, castKindPhrase, isCastKind, missingDetails } from "../../../story/castKinds";
import {
  CAST_RELATION_TYPES,
  relationChip,
  relationSentence,
  relationsOf,
  twinGroups,
  withRelation,
} from "../../../story/relations";
import { linkSameAge } from "../../sameAge";
import { changePersonAge } from "../../ageSync";
import { cleanName, renameMentions, renamePersonEverywhere } from "../../rename";
import { manuscriptHash, withCastResolved } from "../../ownWords";
import {
  currentPortrait,
  lookDecided,
  lookSourceOf,
  looksToDecide,
  portraitStatus,
  withLooksDecided,
} from "../../portrait";
import { hasEarlier, pictureSubject } from "../../history";
import { authoringOf, withAuthoring } from "../../projectState";
import type { GuideTarget } from "../../target";
import { peopleWithoutPortrait } from "../requirements";
import { castOf, countMentions, foldName, resolveAnchor, resolvePerson } from "../resolve";
import type { CommandDef, CommandResult, Impact } from "../types";
import {
  whenAgeToSet,
  whenCast,
  whenEarlierPage,
  whenEarlierPortrait,
  whenNamedPerson,
  whenPortraitDrawn,
  whenPortraitsToDraw,
  whenSeveralPeople,
  whenStory,
  whenUndescribed,
} from "./relevance";
import {
  arg,
  askFor,
  beat,
  formatAge,
  parseAge,
  personFrom,
  withCast,
  withMemberChanges,
  withPersonAsk,
  withRemovedName,
} from "./shared";

const MAX_CAST = 12;

function hasCurrentPortrait(project: Project, id: string): boolean {
  return portraitStatus(project, id) === "current";
}

/** Changing who someone is (age, role, look) leaves a drawn portrait out of date. */
function outdates(project: Project, member: StoryCastMember): Impact {
  return hasCurrentPortrait(project, member.id)
    ? { level: "reversible", effects: [{ kind: "outdatesPortraits", names: [member.name.trim()] }] }
    : { level: "none", effects: [] };
}

function withExtractionNames(project: Project): Project {
  const extraction = authoringOf(project).extraction;
  if (!extraction) return project;
  return withAuthoring(project, {
    extraction: {
      ...extraction,
      storyHash: manuscriptHash(project.config.storyText),
      names: namedCast(briefOf(project.config)).map((member) => member.name.trim()),
    },
  });
}

function joinNote(previous: string | undefined, next: string, max = 400): string {
  return [previous?.trim(), next.trim()].filter(Boolean).join("; ").slice(0, max);
}

/** A look change before any portrait exists: it shapes the first drawing. */
function withLookNote(project: Project, member: StoryCastMember, look: string): Project {
  const source = lookSourceOf(member);
  const changes: Partial<StoryCastMember> =
    source === "photo" || source === "drawing"
      ? { portraitNote: joinNote(member.portraitNote, look) }
      : { appearance: joinNote(member.appearance, look, 600), lookSource: "describe" as const, appearanceFromStory: false };
  return withPersonAsk(withMemberChanges(project, member.id, changes), member.id, "look");
}

function lookChange(project: Project, member: StoryCastMember, change: string, restart = false): CommandResult {
  const name = member.name.trim();
  if (!currentPortrait(project, member.id)) {
    return {
      kind: "write",
      project: withLookNote(project, member, change),
      beat: beat("lookNoted", { names: name }, { mustSay: [name] }),
      view: "cast",
    };
  }
  const next = withPersonAsk(
    withMemberChanges(project, member.id, { portraitNote: joinNote(member.portraitNote, change) }),
    member.id,
    "look",
  );
  return {
    kind: "write",
    project: next,
    beat: beat("redrawReady", undefined, { priority: "result" }),
    // The picture that is there is changed; a new one only when the reader asked for it.
    then: { kind: "redraw", castId: member.id, name, instruction: change, ...(restart ? { mode: "new" as const } : {}) },
    view: "cast",
  };
}

function kindArg(args: Record<string, string>): { kind?: CastKind; species?: string } {
  const kind = arg(args, "kind").toLowerCase();
  const species = arg(args, "species").slice(0, 80);
  return { ...(isCastKind(kind) ? { kind } : {}), ...(species ? { species } : {}) };
}

/** The member fields a stated kind changes; empty when it's what they already are. */
function kindChanges(member: StoryCastMember, stated: { kind?: CastKind; species?: string }): Partial<StoryCastMember> {
  const changes: Partial<StoryCastMember> = {};
  if (stated.kind && stated.kind !== member.kind) changes.kind = stated.kind;
  const kind = stated.kind ?? member.kind;
  if (kind === "person") {
    if (member.species) changes.species = undefined;
  } else if (stated.species && stated.species !== member.species) {
    changes.species = stated.species;
  }
  return changes;
}

export const PEOPLE_COMMANDS: CommandDef[] = [
  {
    id: "addPerson",
    area: "people",
    suggest: [{ id: "addPerson", lead: true, relevant: whenCast }],
    summary:
      "Add a new character to the book: a person, a pet, a toy or a creature. Pass their kind, age, role and look only when the reader said them.",
    args: [
      { name: "name", kind: "text", required: true, hint: "the name, as written" },
      { name: "kind", kind: "choice", required: false, hint: "what they are; leave empty for a person", options: [...CAST_KINDS] },
      { name: "species", kind: "text", required: false, hint: "for an animal, toy or creature: which one, like 'dog' or 'teddy bear'" },
      { name: "age", kind: "age", required: false, hint: "age as a number of years, or 'N months'" },
      { name: "role", kind: "text", required: false, hint: "who they are to the child, like 'big sister' or 'our dog'" },
      { name: "look", kind: "text", required: false, hint: "how they look, only if described" },
    ],
    examples: ["Add another character named Brian", "Put Grandma Rose in the book, she's 70", "Add our dog Max", "Her teddy Fluffy should be in it"],
    help: "Adds a character to the book: a person, a pet, a toy or a creature. I'll ask a person's age, or what kind of animal or toy it is, since the pictures need it.",
    requires: ["notLocked"],
    prepare: (args) => (args.id ? args : { ...args, id: newCastMember().id }),
    run: (project, args) => {
      const name = arg(args, "name").slice(0, 60);
      if (!name) return askFor("name", "askName");
      const age = arg(args, "age") ? parseAge(arg(args, "age")) : null;
      const role = arg(args, "role").slice(0, 80);
      const look = arg(args, "look").slice(0, 400);
      const kind = kindArg(args);
      const existing = castOf(project).find((member) => foldName(member.name) === foldName(name));
      if (existing) {
        const changes: Partial<StoryCastMember> = {
          ...(age ? age : {}),
          ...(role && role !== existing.role ? { role } : {}),
          ...kindChanges(existing, kind),
        };
        if (Object.keys(changes).length === 0 && !look) return { kind: "noop", beat: beat("alreadyThat") };
        let next = Object.keys(changes).length > 0 ? withMemberChanges(project, existing.id, changes) : project;
        if (look) next = withLookNote(next, existing, look);
        return { kind: "write", project: next, beat: beat("done"), view: "cast" };
      }
      if (castOf(project).length >= MAX_CAST) {
        return { kind: "invalid", reason: `A book can have at most ${MAX_CAST} characters.`, say: true };
      }
      const member: StoryCastMember = {
        id: args.id || newCastMember().id,
        name,
        ...(kind.kind ? { kind: kind.kind } : {}),
        ...(kind.species && kind.kind !== "person" ? { species: kind.species } : {}),
        ...(age ?? {}),
        ...(role ? { role } : {}),
        ...(look ? { appearance: look, lookSource: "describe" as const, appearanceFromStory: false as const } : {}),
      };
      let next = withCast(project, (cast) => [...cast.filter((m) => m.name.trim()), member]);
      next = withExtractionNames(withRemovedName(next, name, false));
      if (role) next = withPersonAsk(next, member.id, "role");
      if (look) next = withPersonAsk(next, member.id, "look");
      return {
        kind: "write",
        project: next,
        beat: beat("personAdded", { names: name }, { mustSay: [name], receipt: `Added: ${name}` }),
        view: "cast",
      };
    },
  },
  {
    id: "removePerson",
    area: "people",
    suggest: false, // removing someone is never a thing to nudge toward
    summary: "Take a person out of the book. Runs at once and Undo brings them back; if the story mentions them, the reader first chooses whether the story is rewritten.",
    args: [
      { name: "person", kind: "person", required: true, hint: "who to remove" },
      { name: "story", kind: "choice", required: false, hint: "never set this; the confirmation card sets it", options: ["rewrite", "keep"] },
    ],
    examples: ["Remove Brian", "Take Grandpa out of the book", "Leo shouldn't be in it"],
    help: "Takes someone out of the book. Their portrait is kept in the history, so undo brings them back. If the story mentions them, you choose whether I rewrite it.",
    requires: ["notLocked"],
    undoable: true,
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      if (found.kind !== "one") return { level: "reversible", effects: [] };
      const name = found.value.name.trim();
      const mentions = countMentions(project.config.storyText, name);
      return {
        // Only a story that names them is a decision; otherwise Undo is the safety.
        level: mentions > 0 ? "destructive" : "reversible",
        effects: [
          { kind: "removesPerson", name, hasPortrait: Boolean(currentPortrait(project, found.value.id)) },
          ...(mentions > 0 ? [{ kind: "storyMentions" as const, name, count: mentions }] : []),
        ],
      };
    },
    choices: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      if (found.kind !== "one" || countMentions(project.config.storyText, found.value.name.trim()) === 0) return null;
      return [
        { label: "rewriteWithout", args: { story: "rewrite" } },
        { label: "keepStoryAsIs", args: { story: "keep" } },
      ];
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const { member } = picked;
      const name = member.name.trim();
      const key = foldName(name);
      let next = withCastResolved(withCast(project, (cast) => cast.filter((m) => m.id !== member.id)));
      next = withRemovedName(next, name, true);
      if (next.anchors) {
        next = {
          ...next,
          anchors: next.anchors.map((anchor) =>
            anchor.type === "character" && [anchor.name, ...(anchor.aliasNames ?? [])].some((n) => foldName(n) === key)
              ? { ...anchor, include: false }
              : anchor,
          ),
        };
      }
      const rewrite = arg(args, "story") === "rewrite" && countMentions(project.config.storyText, name) > 0;
      return {
        kind: "write",
        project: next,
        beat: beat("personRemoved", { names: name }, { mustSay: [name], receipt: `Removed: ${name}` }),
        ...(rewrite
          ? {
              then: {
                kind: "reviseStory" as const,
                instruction: `Remove ${name} from the story completely. Keep everything else as close to the original as possible.`,
              },
            }
          : {}),
        view: rewrite ? "story" : "cast",
      };
    },
  },
  {
    id: "renamePerson",
    area: "people",
    suggest: [{ id: "renamePerson", relevant: whenNamedPerson }],
    summary:
      "Give a person a new name everywhere: the cast, the story text, the page plan, the title and their portrait.",
    args: [
      { name: "person", kind: "person", required: true, hint: "the current name" },
      { name: "newName", kind: "text", required: true, hint: "the new name" },
    ],
    examples: ["Rename Arthur to Artie", "Call Brian 'Bri' instead", "Change Maya's name to Mia in the story too"],
    help: "Renames someone everywhere: in the cast, the story, the page plan and the title. Their portrait stays the same.",
    requires: ["notLocked", "storyIdle"],
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      const to = cleanName(arg(args, "newName"));
      if (found.kind !== "one" || !to) return { level: "reversible", effects: [] };
      const from = found.value.name.trim();
      const count = renameMentions(project, from);
      return { level: "reversible", effects: count > 0 ? [{ kind: "renamesInStory", from, to, count }] : [] };
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const { member } = picked;
      const to = cleanName(arg(args, "newName"));
      if (!to) return askFor("newName", "askNewName");
      const renamed = renamePersonEverywhere(project, member.id, to);
      if ("refused" in renamed) {
        if (renamed.refused === "same") return { kind: "noop", beat: beat("alreadyThat") };
        if (renamed.refused === "taken") return { kind: "invalid", reason: `Someone called ${to} is already in the book.`, say: true };
        return { kind: "invalid", reason: "That person could not be renamed.", say: true };
      }
      const { from, title, subtitle } = renamed;
      return {
        kind: "write",
        project: renamed.project,
        beat: beat("personRenamed", { names: to }, { mustSay: [to], receipt: `${from} → ${to}` }),
        ...(title !== null || subtitle !== null
          ? { then: { kind: "coverText" as const, ...(title !== null ? { title } : {}), ...(subtitle !== null ? { subtitle } : {}) } }
          : {}),
        view: "cast",
      };
    },
  },
  {
    id: "setPersonAge",
    area: "people",
    suggest: [{ id: "setAge", lead: true, relevant: whenAgeToSet }],
    summary:
      "Set or change how old a person is. When the story states a different age for them, the story is revised to match.",
    args: [
      { name: "person", kind: "person", required: true, hint: "whose age" },
      { name: "age", kind: "age", required: true, hint: "years as a number, or 'N months' for babies" },
    ],
    examples: ["Amanda is 2 years old", "Make Leo 5", "The baby is 9 months"],
    help: "Sets someone's age. The pictures follow it, and if the story says another age for them, I'll update the story too and you'll see each change before it lands.",
    requires: ["notLocked"],
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      return found.kind === "one" ? outdates(project, found.value) : { level: "none", effects: [] };
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const { member } = picked;
      const name = member.name.trim();
      const age = parseAge(arg(args, "age"));
      if (!age) return askFor("age", "missingAges", [], { names: name });
      if (member.age === age.age && member.ageMonths === age.ageMonths) {
        return { kind: "noop", beat: beat("alreadyThat") };
      }
      const changed = changePersonAge(project, member.id, age);
      if (!changed) return { kind: "invalid", reason: "That person is not in the book.", say: true };
      const shown = formatAge(age);
      return {
        kind: "write",
        project: changed.project,
        beat: beat(changed.revise ? "ageSetStory" : "ageSet", { names: name, n: shown }, { mustSay: [name], receipt: `${name}: ${shown}` }),
        ...(changed.revise ? { then: { kind: "reviseStory" as const, instruction: changed.revise } } : {}),
        view: "cast",
      };
    },
  },
  {
    id: "setPersonKind",
    area: "people",
    suggest: false, // the character card asks when it needs to know
    summary:
      "Say what a character is: a person, an animal, a toy or a creature, and which one (a golden retriever, a teddy bear, a dragon).",
    args: [
      { name: "person", kind: "person", required: true, hint: "which character" },
      { name: "kind", kind: "choice", required: false, hint: "what they are", options: [...CAST_KINDS] },
      { name: "species", kind: "text", required: false, hint: "which animal, toy or creature, in the reader's words" },
    ],
    examples: ["Bello is a golden retriever", "Fluffy is her teddy bear", "Spark is a little dragon", "Grandpa Joe is a person"],
    help: "Tells me what a character is, so they're written and drawn as a dog, a teddy or a dragon rather than as a child.",
    requires: ["notLocked"],
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      return found.kind === "one" ? outdates(project, found.value) : { level: "none", effects: [] };
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const { member } = picked;
      const name = member.name.trim();
      const stated = kindArg(args);
      const kind = stated.kind ?? (stated.species ? (member.kind && member.kind !== "person" ? member.kind : "animal") : undefined);
      if (!kind) {
        return askFor("kind", "missingKind", CAST_KINDS.map((id) => ({ id, label: CAST_KIND_SPECS[id].noun })), {
          names: name,
          what: "character",
        });
      }
      const changes = kindChanges(member, { kind, species: stated.species });
      if (Object.keys(changes).length === 0) return { kind: "noop", beat: beat("alreadyThat") };
      const next = { ...member, ...changes };
      if (missingDetails(next).includes("species")) {
        return {
          kind: "write",
          project: withMemberChanges(project, member.id, changes),
          beat: beat("missingKind", { names: name, what: CAST_KIND_SPECS[kind].noun }, { priority: "question", mustSay: [name] }),
          view: "cast",
        };
      }
      const what = kind === "person" ? "a person" : castKindPhrase(next);
      return {
        kind: "write",
        project: withMemberChanges(project, member.id, changes),
        beat: beat("kindSet", { names: name, what }, { mustSay: [name], receipt: `${name}: ${next.species ?? CAST_KIND_SPECS[kind].noun}` }),
        view: "cast",
      };
    },
  },
  {
    id: "setRelation",
    area: "people",
    suggest: [{ id: "relatePeople", relevant: whenSeveralPeople }],
    summary:
      "Say how characters belong together: twins, siblings, friends, family, or a pet or toy and who it belongs to. For twins, whether they look alike.",
    args: [
      { name: "people", kind: "text", required: true, hint: "comma-separated names, two or more; for 'owner' the owner first" },
      { name: "type", kind: "choice", required: true, hint: "how they belong together", options: [...CAST_RELATION_TYPES] },
      { name: "lookAlike", kind: "choice", required: false, hint: "twins only, only when said", options: ["identical", "different"] },
      { name: "note", kind: "text", required: false, hint: "their own words, when the type alone doesn't say it" },
    ],
    examples: ["Myla and Shilo are twins", "They're identical twins", "Bello is Maya's dog", "Tom is her best friend"],
    help: "Remembers how characters belong together, so the story and the pictures keep it: twins stay twins, a dog stays with its owner.",
    requires: ["notLocked"],
    run: (project, args) => {
      const names = arg(args, "people")
        .split(/,| and | und | & /i)
        .map((name) => name.trim())
        .filter(Boolean);
      const ids: string[] = [];
      for (const name of names) {
        const found = resolvePerson(project, name);
        if (found.kind === "one" && !ids.includes(found.value.id)) ids.push(found.value.id);
      }
      const type = arg(args, "type") as CastRelationType;
      if (!(CAST_RELATION_TYPES as readonly string[]).includes(type)) {
        return { kind: "invalid", reason: `Unknown relation "${arg(args, "type")}".` };
      }
      if (ids.length < 2) {
        const known = castOf(project).map((member) => ({ id: member.name.trim(), label: member.name.trim() }));
        return askFor("people", "whichName", known);
      }
      const lookAlike = arg(args, "lookAlike");
      const note = arg(args, "note").slice(0, 120);
      const brief = briefOf(project.config);
      const relation: CastRelation = {
        ids,
        type,
        ...(note ? { label: note } : {}),
        ...(type === "twins" && (lookAlike === "identical" || lookAlike === "different") ? { lookAlike } : {}),
      };
      const nextBrief = withRelation(brief, relation);
      if (JSON.stringify(nextBrief.relations) === JSON.stringify(brief.relations)) {
        return { kind: "noop", beat: beat("alreadyThat") };
      }
      let next: Project = { ...project, config: { ...project.config, storyBrief: nextBrief } };
      if (type === "twins") next = linkSameAge(next, twinGroups(nextBrief)).project;
      const stored = relationsOf(nextBrief).find((item) => item.ids.join() === ids.join()) ?? relation;
      const sentence = relationSentence(nextBrief, stored);
      return {
        kind: "write",
        project: next,
        beat: beat("relationSet", { what: sentence }, { receipt: relationChip(nextBrief, stored) }),
        view: "cast",
      };
    },
  },
  {
    id: "setPersonRole",
    area: "people",
    suggest: false, // the character card asks once per person
    summary: "Say who a person is: their relationship or role (big sister, grandpa, our cat, best friend).",
    args: [
      { name: "person", kind: "person", required: true, hint: "who" },
      { name: "role", kind: "text", required: true, hint: "the role, in the reader's words" },
    ],
    examples: ["Brian is Amanda's big brother", "Rose is our neighbor", "Max is our dog"],
    help: "Tells me who someone is, so the story and pictures get them right.",
    requires: ["notLocked"],
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      return found.kind === "one" ? outdates(project, found.value) : { level: "none", effects: [] };
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const { member } = picked;
      const role = arg(args, "role").slice(0, 80);
      if (!role) return askFor("role", "askPersonDetail", [], { names: member.name.trim() });
      if ((member.role ?? "").trim() === role) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "write",
        project: withPersonAsk(withMemberChanges(project, member.id, { role }), member.id, "role"),
        beat: beat("done", undefined, { receipt: `${member.name.trim()}: ${role}` }),
        view: "cast",
      };
    },
  },
  {
    id: "describePerson",
    area: "people",
    suggest: [{ id: "describePerson", relevant: whenUndescribed }],
    summary:
      "Describe how a person looks (hair, glasses, clothes) before or instead of a photo. If a portrait is already drawn, use editPersonLook.",
    args: [
      { name: "person", kind: "person", required: true, hint: "who" },
      { name: "look", kind: "text", required: true, hint: "the description, in the reader's words" },
    ],
    examples: ["Amanda has curly red hair and freckles", "Brian wears glasses", "Max is a small black poodle"],
    help: "Tells me how someone looks, so their portrait matches.",
    requires: ["notLocked"],
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      return found.kind === "one" ? outdates(project, found.value) : { level: "none", effects: [] };
    },
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const look = arg(args, "look").slice(0, 400);
      if (!look) {
        const name = picked.member.name.trim();
        return {
          kind: "write",
          project: withAuthoring(project, { lookFocus: `${picked.member.id}:describe` }),
          beat: beat("lookChoose", { names: name }, { mustSay: [name] }),
        };
      }
      return lookChange(project, picked.member, look);
    },
  },
  {
    id: "choosePersonLook",
    area: "people",
    suggest: false, // the looks card offers the choices
    summary:
      "Say where someone's look comes from before their portrait: a photo, a drawing, a description, or let the story decide. " +
      "Leave person empty with 'story' to let the story decide for everyone. For an actual description, use describePerson.",
    args: [
      { name: "person", kind: "person", required: false, hint: "who; empty with source 'story' means everyone" },
      { name: "source", kind: "choice", required: true, hint: "where the look comes from", options: ["photo", "drawing", "describe", "story"] },
    ],
    examples: ["I have a photo of Amanda", "I'd like to use my son's drawing of Leo", "Just make them all up from the story"],
    help: "Chooses where someone's look comes from: a photo, a drawing, your own description, or the story. Photos and drawings are added with the button I show.",
    requires: ["notLocked", "hasCast", "storyAccepted"],
    run: (project, args) => {
      const source = arg(args, "source");
      if (source === "story" && !arg(args, "person")) {
        const open = looksToDecide(project);
        if (open.length === 0) return { kind: "noop", beat: beat("alreadyThat") };
        return { kind: "write", project: withLooksDecided(project, open.map((m) => m.id)), beat: beat("looksFromStory") };
      }
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const member = picked.member;
      const name = member.name.trim();
      if (lookDecided(project, member)) {
        return { kind: "noop", beat: beat("lookOnPlate", { names: name }, { mustSay: [name] }) };
      }
      if (source === "story") {
        return { kind: "write", project: withLooksDecided(project, [member.id]), beat: beat("lookFromStory", { names: name }, { mustSay: [name] }) };
      }
      if (source !== "photo" && source !== "drawing" && source !== "describe") {
        return { kind: "invalid", reason: `Unknown look source "${source}".` };
      }
      return {
        kind: "write",
        project: withAuthoring(project, { lookFocus: `${member.id}:${source}` }),
        beat: beat("lookChoose", { names: name }, { mustSay: [name] }),
      };
    },
  },
  {
    id: "editPersonLook",
    area: "people",
    suggest: [{ id: "editPortrait", relevant: whenPortraitDrawn }],
    summary:
      "Change someone's drawn portrait ('make Amanda's hair darker', 'give Leo glasses'). Changes the portrait that is drawn (only the change; the person stays the same) and keeps the old one in the history. Set mode 'new' only to start over.",
    args: [
      { name: "person", kind: "person", required: true, hint: "whose portrait" },
      { name: "change", kind: "text", required: true, hint: "the change, in the reader's words" },
      {
        name: "mode",
        kind: "choice",
        required: false,
        hint: "'new' only when the reader asks to start over or wants a completely different picture; otherwise leave empty so the drawn portrait is changed",
        options: ["edit", "new"],
      },
    ],
    examples: ["Make Amanda's hair darker", "Give Leo glasses", "Brian should look a bit older"],
    help: "Changes someone's portrait. I change the portrait that is there, so the person stays the same and only your change is made. You see the price first unless it's small, and the old version stays in the history.",
    requires: ["notLocked"],
    paid: true,
    run: (project, args) => {
      const picked = personFrom(project, args);
      if ("result" in picked) return picked.result;
      const change = arg(args, "change").slice(0, 400);
      if (!change) return askFor("change", "askWhatChange");
      return lookChange(project, picked.member, change, arg(args, "mode") === "new");
    },
  },
  {
    id: "drawPortraits",
    area: "generation",
    suggest: [{ id: "drawPortraits", views: ["cast"], lead: true, relevant: whenPortraitsToDraw }],
    summary: "Draw the portraits of the people in the book (everyone missing one, or the people named). Shows the paid button.",
    args: [
      { name: "people", kind: "text", required: false, hint: "comma-separated names, or empty for everyone missing a portrait" },
    ],
    examples: ["Draw everyone", "Make the portraits", "Draw Amanda"],
    help: "Draws the people in the book in the chosen look. You see the price on the button before anything starts.",
    requires: ["notLocked", "hasCast", "storyAccepted", "castAges", "styleChosen"],
    paid: true,
    run: (project, args) => {
      const unresolved = authoringOf(project).extraction?.unresolved ?? [];
      if (unresolved.length > 0) {
        return { kind: "blocked", remedy: { requirement: "hasCast", what: "a quick look at a few names first.", view: "cast" } };
      }
      const wanted = arg(args, "people")
        .split(/,| and | und /i)
        .map((name) => name.trim())
        .filter(Boolean);
      const missing = peopleWithoutPortrait(project);
      let targets = missing;
      if (wanted.length > 0) {
        const picked: { id: string; name: string }[] = [];
        for (const name of wanted) {
          const found = resolvePerson(project, name);
          if (found.kind === "one") picked.push({ id: found.value.id, name: found.value.name.trim() });
        }
        targets = picked.filter((m) => missing.some((x) => x.id === m.id));
        if (picked.length > 0 && targets.length === 0) return { kind: "noop", beat: beat("alreadyThat") };
      }
      if (targets.length === 0) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "effect",
        effect: { kind: "portraits", castIds: targets.map((m) => m.id) },
        beat: beat("quoteReady"),
      };
    },
  },
  {
    id: "restorePicture",
    area: "people",
    suggest: [
      { id: "earlierPortrait", views: ["cast"], relevant: whenEarlierPortrait },
      { id: "earlierPage", views: ["pages"], relevant: whenEarlierPage },
    ],
    summary:
      "Go back to an earlier picture of a person, a page or the cover ('I liked the old one better', 'go back to the earlier portrait'). " +
      "Every redraw is kept, so this is free and draws nothing. Leave person empty for the selected picture.",
    args: [
      { name: "person", kind: "person", required: false, hint: "whose portrait; empty for the selected page, cover or person" },
    ],
    examples: ["Go back to the earlier picture", "I liked Amanda's old portrait better", "Bring back the previous version"],
    help: "Takes a picture back to an earlier version. Every redraw is kept, so nothing is lost, and going back is free. You can also step through them with the arrows on the picture.",
    requires: [],
    run: (project, args, ctx) => {
      const wanted = arg(args, "person");
      let target: GuideTarget | null = null;
      if (wanted) {
        const found = resolvePerson(project, wanted);
        if (found.kind === "one") target = { kind: "person", castId: found.value.id, name: found.value.name.trim() };
      }
      if (!target && ctx.chip) target = ctx.chip;
      if (!target) {
        const options = castOf(project)
          .filter((m) => hasEarlier(project, { kind: "person", castId: m.id, name: m.name.trim() }))
          .map((m) => ({ id: m.name.trim(), label: m.name.trim() }));
        if (options.length === 1) {
          const only = castOf(project).find((m) => m.name.trim() === options[0]!.id)!;
          target = { kind: "person", castId: only.id, name: only.name.trim() };
        } else if (options.length > 1) {
          return askFor("person", "whichName", options);
        } else {
          return { kind: "noop", beat: beat("noEarlierPicture") };
        }
      }
      if (!hasEarlier(project, target)) return { kind: "noop", beat: beat("noEarlierPicture") };
      const subject = pictureSubject(target);
      return {
        kind: "effect",
        effect: { kind: "picture", target, delta: -1 },
        beat: beat("pictureBack", { names: subject }, target.kind === "person" ? { mustSay: [subject] } : {}),
        };
    },
  },
  {
    id: "confirmCast",
    area: "people",
    suggest: false, // the characters card has the button
    summary: "The reader says the list of people is right (after the guide found names in their story).",
    args: [],
    examples: ["Yes, that's everyone", "The names are right"],
    help: "Confirms the people I found in your story.",
    requires: ["notLocked", "hasCast"],
    run: (project) => {
      if ((authoringOf(project).extraction?.unresolved ?? []).length === 0) {
        return { kind: "noop", beat: beat("castConfirmed") };
      }
      return { kind: "write", project: withCastResolved(project), beat: beat("castConfirmed") };
    },
  },
  {
    id: "deletePhoto",
    area: "people",
    suggest: false, // deleting a photo is never a thing to nudge toward
    summary: "Delete the photo uploaded for a person. Permanent; always confirmed.",
    args: [{ name: "person", kind: "person", required: true, hint: "whose photo" }],
    examples: ["Delete Amanda's photo", "Remove the photo I uploaded"],
    help: "Deletes a photo you uploaded. This can't be undone, but finished portraits stay.",
    requires: [],
    alwaysConfirm: true,
    impact: (project, args) => {
      const found = resolvePerson(project, arg(args, "person"));
      return {
        level: "irreversible",
        effects: found.kind === "one" ? [{ kind: "deletesPhoto", name: found.value.name.trim() }] : [],
      };
    },
    run: (project, args) => {
      const withPhoto = castOf(project).filter((member) => member.likenessPhoto);
      const picked = arg(args, "person")
        ? personFrom(project, args)
        : withPhoto.length === 1
          ? { member: withPhoto[0]! }
          : personFrom(project, args);
      if ("result" in picked) return picked.result;
      if (!picked.member.likenessPhoto) {
        return { kind: "invalid", reason: `${picked.member.name.trim()} has no photo.`, say: true };
      }
      return { kind: "effect", effect: { kind: "deletePhoto", castId: picked.member.id }, beat: beat("photoDeleted") };
    },
  },
  {
    id: "describeAnchor",
    area: "places",
    suggest: [{ id: "describePlace", relevant: whenStory }],
    summary: "Describe how a place or object in the story should look ('the house is blue with a red door').",
    args: [
      { name: "anchor", kind: "anchor", required: true, hint: "the place or object's name" },
      { name: "description", kind: "text", required: true, hint: "how it looks, in the reader's words" },
    ],
    examples: ["The house should be blue with a red door", "Make the treehouse bigger"],
    help: "Tells me how a place or thing in the story looks, so every page draws it the same way.",
    requires: ["notLocked"],
    run: (project, args) => {
      const found = resolveAnchor(project, arg(args, "anchor"));
      if (found.kind === "none") return { kind: "invalid", reason: `No place or thing called ${arg(args, "anchor")}.`, say: true };
      if (found.kind === "many") {
        return askFor("anchor", "askWhich", found.values.map((a) => ({ id: a.name, label: a.name })));
      }
      const description = arg(args, "description").slice(0, 600);
      if (!description) return askFor("description", "askWhatChange");
      const anchor = found.value;
      return {
        kind: "write",
        project: {
          ...project,
          anchors: (project.anchors ?? []).map((a) =>
            a.id === anchor.id
              ? { ...a, description, descriptionUserEdited: true, mode: "describe" as const, userGuidance: description }
              : a,
          ),
        },
        beat: beat("done", undefined, { receipt: `${anchor.name}: ${description.slice(0, 60)}` }),
      };
    },
  },
  {
    id: "excludeAnchor",
    area: "places",
    suggest: false, // too rare to suggest
    summary: "Stop (or start again) drawing a separate reference for a place or object.",
    args: [
      { name: "anchor", kind: "anchor", required: true, hint: "the place or object's name" },
      { name: "include", kind: "choice", required: false, hint: "'no' to stop drawing it (default), 'yes' to draw it again", options: ["no", "yes"] },
    ],
    examples: ["Don't draw the kitchen separately", "Leave out the car"],
    help: "Leaves a place or thing out of the reference drawings. You can bring it back.",
    requires: ["notLocked"],
    impact: (project, args) => {
      const found = resolveAnchor(project, arg(args, "anchor"));
      return found.kind === "one" && arg(args, "include") !== "yes"
        ? { level: "reversible", effects: [{ kind: "removesPlace", name: found.value.name }] }
        : { level: "none", effects: [] };
    },
    run: (project, args) => {
      const found = resolveAnchor(project, arg(args, "anchor"));
      if (found.kind === "none") return { kind: "invalid", reason: `No place or thing called ${arg(args, "anchor")}.`, say: true };
      if (found.kind === "many") {
        return askFor("anchor", "askWhich", found.values.map((a) => ({ id: a.name, label: a.name })));
      }
      const include = arg(args, "include") === "yes";
      if (found.value.include === include) return { kind: "noop", beat: beat("alreadyThat") };
      return {
        kind: "write",
        project: {
          ...project,
          anchors: (project.anchors ?? []).map((a) => (a.id === found.value.id ? { ...a, include } : a)),
        },
        beat: include ? beat("done") : beat("placeExcluded", { names: found.value.name }, { mustSay: [found.value.name] }),
      };
    },
  },
];
