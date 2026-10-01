/**
 * Pure book edits and result builders shared by the skills.
 *
 * These mirror the book-pane actions in `ui/guide/bookActions.ts` without the
 * store, so a skill can run on a copy of the book during planning and again on
 * the live book when it is written.
 */
import { effectiveCharacterAgeYears } from "../../../book/characterAge";
import { normalizeAnchorName } from "../../../book/anchorRefs";
import { briefOf } from "../../../story/brief";
import type { Project, StoryCastMember } from "../../../types";
import { withCastResolved } from "../../ownWords";
import { authoringOf, withAuthoring } from "../../projectState";
import type { GuideLineKey } from "../../copy";
import type { GuideCopyVars } from "../../copy";
import type { StoryFitCard } from "../../session";
import { castOf, resolvePerson } from "../resolve";
import type { AskOption, Beat, BeatPriority, CommandArgs, CommandResult } from "../types";

export function beat(
  key: GuideLineKey,
  vars?: GuideCopyVars,
  extra: { priority?: BeatPriority; mustSay?: string[]; receipt?: string; fit?: StoryFitCard; text?: string } = {},
): Beat {
  return {
    key,
    priority: extra.priority ?? "result",
    ...(vars ? { vars } : {}),
    ...(extra.text ? { text: extra.text } : {}),
    ...(extra.mustSay?.length ? { mustSay: extra.mustSay } : {}),
    ...(extra.receipt ? { receipt: extra.receipt } : {}),
    ...(extra.fit ? { fit: extra.fit } : {}),
  };
}

export function askFor(arg: string, key: GuideLineKey, options: AskOption[] = [], vars?: GuideCopyVars): CommandResult {
  return { kind: "ask", arg, beat: beat(key, vars, { priority: "question" }), options };
}

export function arg(args: CommandArgs, name: string): string {
  return (args[name] ?? "").trim();
}

/** Resolve the `person` arg to one cast member, or the ask/invalid result that replaces the run. */
export function personFrom(
  project: Project,
  args: CommandArgs,
  name = "person",
): { member: StoryCastMember } | { result: CommandResult } {
  const wanted = arg(args, name);
  const cast = castOf(project);
  const options = cast.map((member) => ({ id: member.name.trim(), label: member.name.trim() }));
  if (!wanted) {
    if (cast.length === 1) return { member: cast[0]! };
    return { result: askFor(name, "whichName", options) };
  }
  const found = resolvePerson(project, wanted);
  if (found.kind === "one") return { member: found.value };
  if (found.kind === "many") {
    return {
      result: askFor(
        name,
        "whichName",
        found.values.map((member) => ({ id: member.name.trim(), label: member.name.trim() })),
      ),
    };
  }
  return cast.length > 0
    ? { result: askFor(name, "whichName", options) }
    : { result: { kind: "invalid", reason: `No one named ${wanted} is in the book.`, say: true } };
}

/** Parse "4", "4 years", "18 months", "vier" is left to the interpreter. */
export function parseAge(raw: string): { age?: number; ageMonths?: number } | null {
  const text = raw.trim().toLowerCase();
  const match = text.match(/^(\d{1,3}(?:[.,]\d)?)\s*(m|mo|month|months|monat|monate|monaten)?\b/);
  if (!match) return null;
  const value = Number(match[1]!.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) return null;
  if (match[2]) {
    const months = Math.round(value);
    if (months > 36) return { age: Math.floor(months / 12) };
    return { ageMonths: months };
  }
  if (value > 120) return null;
  if (value < 1 && value > 0) return { ageMonths: Math.round(value * 12) };
  return { age: Math.round(value) };
}

export function formatAge(age: { age?: number; ageMonths?: number }): string {
  if (age.ageMonths !== undefined && age.age === undefined) return `${age.ageMonths} months`;
  return String(age.age ?? "");
}

export function withCast(project: Project, map: (cast: StoryCastMember[]) => StoryCastMember[]): Project {
  const brief = briefOf(project.config);
  return { ...project, config: { ...project.config, storyBrief: { ...brief, cast: map(brief.cast ?? []) } } };
}

/** `updateCastMember` from the book pane, as a pure function: ages clear estimates and reach the anchors. */
export function withMemberChanges(project: Project, id: string, changes: Partial<StoryCastMember>): Project {
  const clearsEstimate = typeof changes.age === "number" || typeof changes.ageMonths === "number";
  const nextChanges = clearsEstimate ? { ...changes, visualAge: undefined } : changes;
  const previous = briefOf(project.config).cast?.find((member) => member.id === id);
  let next = withCastResolved(
    withCast(project, (cast) => cast.map((member) => (member.id === id ? { ...member, ...nextChanges } : member))),
  );
  const ageChanged = "age" in changes || "ageMonths" in changes || "visualAge" in changes;
  if (!ageChanged || !previous || !next.anchors) return next;
  const member = briefOf(next.config).cast?.find((candidate) => candidate.id === id);
  if (!member) return next;
  const years = effectiveCharacterAgeYears(member);
  const names = new Set([previous.name, member.name].map(normalizeAnchorName).filter(Boolean));
  next = {
    ...next,
    anchors: next.anchors.map((anchor) =>
      anchor.type === "character" &&
      [normalizeAnchorName(anchor.name), ...(anchor.aliasNames ?? []).map(normalizeAnchorName)].some((name) =>
        names.has(name),
      )
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
}

/** Mark a per-person follow-up as asked or skipped, so it is never asked again. */
export function withPersonAsk(project: Project, personId: string, field: string, skipped = false): Project {
  const marks = new Set(authoringOf(project).personAsks ?? []);
  marks.add(`${personId}:${field}`);
  if (skipped) marks.add(`${personId}:${field}:skipped`);
  return withAuthoring(project, { personAsks: [...marks] });
}

export function withRemovedName(project: Project, name: string, removed: boolean): Project {
  const key = name.trim().toLowerCase();
  const current = (authoringOf(project).removedNames ?? []).filter((item) => item.trim().toLowerCase() !== key);
  return withAuthoring(project, { removedNames: removed ? [...current, name.trim()] : current });
}
