/**
 * People the reader said share an age.
 *
 * The link is data, not a phrase list. The interpreter may propose it only by
 * quoting the reader's words; this module applies the consequence. A missed
 * link costs one more question. A copied age the reader did not mean is the
 * failure this refuses: ages that already disagree dissolve the group instead
 * of overwriting anyone.
 */
import type { Project, StoryCastMember } from "../types";
import { briefOf, namedCast } from "../story/brief";
import { authoringOf, withAuthoring } from "./projectState";
import { turningOf } from "./turning";

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

function ageSignature(member: StoryCastMember): string | null {
  if (member.ageMonths !== undefined) return `m:${member.ageMonths}`;
  if (member.age !== undefined) return `y:${member.age}`;
  return null;
}

function giveAge(target: StoryCastMember, source: StoryCastMember): void {
  if (source.ageMonths !== undefined) {
    target.ageMonths = source.ageMonths;
    delete target.age;
  } else if (source.age !== undefined) {
    target.age = source.age;
    delete target.ageMonths;
  }
  // "Both almost 3": the twin was almost 3 too.
  if (turningOf(source) !== undefined) target.turning = source.turning;
  else delete target.turning;
}

/**
 * Copy a known age across each stored group, and drop a group whose members
 * no longer agree or are no longer in the cast.
 *
 * Returns the same project when nothing changes.
 */
export function copySharedAges(project: Project): Project {
  const groups = authoringOf(project).sameAge ?? [];
  if (groups.length === 0) return project;
  const brief = briefOf(project.config);
  const cast = (brief.cast ?? []).map((member) => ({ ...member }));
  const byKey = new Map(cast.map((member) => [keyOf(member.name), member]));
  let changed = false;
  const kept: string[][] = [];

  for (const group of groups) {
    const members = [
      ...new Map(
        group
          .map((name) => byKey.get(keyOf(name)))
          .filter((member): member is StoryCastMember => Boolean(member))
          .map((member) => [member.id, member]),
      ).values(),
    ];
    if (members.length < 2) continue;
    const signatures = new Set(
      members.map(ageSignature).filter((signature): signature is string => Boolean(signature)),
    );
    if (signatures.size > 1) continue;
    const source = members.find((member) => ageSignature(member));
    if (source) {
      for (const member of members) {
        if (ageSignature(member)) continue;
        giveAge(member, source);
        changed = true;
      }
    }
    kept.push(members.map((member) => member.name));
  }

  const groupsSame = JSON.stringify(kept) === JSON.stringify(groups);
  if (!changed && groupsSame) return project;
  let next = changed ? { ...project, config: { ...project.config, storyBrief: { ...brief, cast } } } : project;
  if (!groupsSame) next = withAuthoring(next, { sameAge: kept.length > 0 ? kept : undefined });
  return next;
}

/**
 * Remember groups the reader just said share an age. Names the book has never
 * heard are reported and left out. A group whose ages already disagree is left
 * out rather than forcing one of them.
 */
export function linkSameAge(
  project: Project,
  proposed: readonly (readonly string[])[],
): { project: Project; unknown: string[] } {
  const cast = namedCast(briefOf(project.config));
  const byKey = new Map(cast.map((member) => [keyOf(member.name), member]));
  const unknown: string[] = [];
  const groups: string[][] = [...(authoringOf(project).sameAge ?? [])];

  for (const proposedGroup of proposed) {
    const members: StoryCastMember[] = [];
    for (const name of proposedGroup) {
      const found = byKey.get(keyOf(name));
      if (!found) {
        const trimmed = name.trim();
        if (trimmed && !unknown.some((item) => keyOf(item) === keyOf(trimmed))) unknown.push(trimmed);
        continue;
      }
      if (!members.some((member) => member.id === found.id)) members.push(found);
    }
    if (members.length < 2) continue;
    const signatures = new Set(
      members.map(ageSignature).filter((signature): signature is string => Boolean(signature)),
    );
    if (signatures.size > 1) continue;
    const names = members.map((member) => member.name);
    const keys = new Set(names.map(keyOf));
    const existing = groups.findIndex(
      (group) => group.length === names.length && group.every((name) => keys.has(keyOf(name))),
    );
    if (existing >= 0) groups[existing] = names;
    else groups.push(names);
  }

  const linked = withAuthoring(project, { sameAge: groups.length > 0 ? groups : undefined });
  const copied = copySharedAges(linked);
  const sameGroups =
    JSON.stringify(authoringOf(copied).sameAge ?? []) === JSON.stringify(authoringOf(project).sameAge ?? []);
  const sameAges =
    namedCast(briefOf(copied.config))
      .map((member) => `${member.id}:${member.age ?? ""}:${member.ageMonths ?? ""}:${member.turning ?? ""}`)
      .join("|") ===
    namedCast(briefOf(project.config))
      .map((member) => `${member.id}:${member.age ?? ""}:${member.ageMonths ?? ""}:${member.turning ?? ""}`)
      .join("|");
  if (sameGroups && sameAges) return { project, unknown };
  return { project: copied, unknown };
}
