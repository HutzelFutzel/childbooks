/**
 * "Almost 3" is two.
 *
 * A child's `age` is the years they have completed, so a parent who says their
 * child is almost 3 gets a 2-year-old's pictures and a 2-year-old's age group.
 * What they said is kept apart, as `turning`: the age the child is about to
 * reach. Only the question about who the book is for reads it, because that is
 * where the parent may well want the older group; nothing about how the child
 * is drawn does.
 *
 * Nothing here reads words. Understanding "almost", "nearly", "knapp", "bald 3"
 * is the interpreter's job in whatever language was typed; this module checks
 * the numbers it sends back, so a model that rounds up (age 3, turning 3) or
 * one that fills only `turning` still lands on the same stored age.
 */
import type { StoryCastMember } from "../types";

export interface AgeFields {
  age?: number;
  ageMonths?: number;
  turning?: number;
}

/** Whole years the person has completed, or undefined when no age is known. */
export function completedYears(member: Pick<StoryCastMember, "age" | "ageMonths">): number | undefined {
  if (member.ageMonths !== undefined) return Math.floor(member.ageMonths / 12);
  return member.age;
}

/** The age the person is about to reach, only while it is still the next one after their stored age. */
export function turningOf(member: Pick<StoryCastMember, "age" | "ageMonths" | "turning">): number | undefined {
  const years = completedYears(member);
  return years !== undefined && member.turning === years + 1 ? member.turning : undefined;
}

/**
 * The stored form of an age the interpreter sent, with or without `turning`.
 * The result never holds a `turning` that disagrees with the age beside it.
 */
export function settleStatedAge(input: AgeFields): AgeFields {
  const { age, ageMonths, turning } = input;
  const plain: AgeFields = {
    ...(ageMonths !== undefined ? { ageMonths } : {}),
    ...(ageMonths === undefined && age !== undefined ? { age } : {}),
  };
  if (turning === undefined || !Number.isInteger(turning) || turning < 1 || turning > 120) return plain;

  let years: number;
  if (ageMonths !== undefined) {
    years = Math.floor(ageMonths / 12);
    if (turning !== years + 1) return plain;
  } else if (age !== undefined) {
    if (turning === age) years = age - 1; // The model repeated the number it heard instead of the one before it.
    else if (turning === age + 1) years = age;
    else return plain;
  } else {
    years = turning - 1;
  }
  if (years < 0) return plain;

  // Under two, months are how this app keeps an age: "almost 1" is 11 months.
  if (years === 0) return { ageMonths: ageMonths !== undefined && ageMonths < 12 ? ageMonths : 11, turning };
  if (ageMonths !== undefined && ageMonths < 24) return { ageMonths, turning };
  return { age: years, turning };
}

/** Write settled age fields onto a member in place. A member's `turning` follows only what was just said. */
export function applyAgeFields(member: StoryCastMember, fields: AgeFields): void {
  if (fields.ageMonths !== undefined) {
    member.ageMonths = fields.ageMonths;
    delete member.age;
  } else if (fields.age !== undefined) {
    member.age = fields.age;
    delete member.ageMonths;
  } else {
    return;
  }
  if (fields.turning !== undefined) member.turning = fields.turning;
  else delete member.turning;
}
