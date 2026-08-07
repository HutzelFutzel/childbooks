/**
 * Buyer roles — who the person paying is, as distinct from who the book is for.
 *
 * Its own module because two otherwise unrelated systems need it: the survey
 * config, which collects it by tagging answer options, and the campaign engine,
 * which targets on it. Putting it in either one would make that one import the
 * other, and `surveys` already borrows the campaign engine's stable hash.
 *
 * "My grandchild" tells you two things at once — who the book is for, and that the
 * buyer is a grandparent. That second fact is the one marketing runs on, and until
 * it's written down as a value it lives only in the head of whoever reads the
 * chart, which breaks the moment an option is reworded or a new one added.
 */
export const BUYER_ROLES = [
  "parent",
  "grandparent",
  "relative",
  "friend",
  "educator",
  "self",
] as const;

export type BuyerRole = (typeof BUYER_ROLES)[number];

/** Admin-facing: names the BUYER, which is what a report column is about. */
export const BUYER_ROLE_LABELS: Record<BuyerRole, string> = {
  parent: "Parent",
  grandparent: "Grandparent",
  relative: "Aunt, uncle or cousin",
  friend: "Friend or colleague",
  educator: "Teacher or group leader",
  self: "Buying for themselves",
};

/**
 * Customer-facing: names the RECIPIENT, because that's the half of the
 * relationship the customer thinks in. "Buying for a grandchild", never "buying as
 * a Grandparent".
 */
export const BUYER_ROLE_PHRASES: Record<BuyerRole, string> = {
  parent: "your own child",
  grandparent: "a grandchild",
  relative: "a niece, nephew or cousin",
  friend: "a friend's child",
  educator: "a class or group",
  self: "yourself",
};
