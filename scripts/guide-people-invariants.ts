/**
 * Invariants for information that must never be lost, and never land on the wrong person.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - "Dad", "papas", "Papa's" and "Vater" find Papa; two fathers ask which one;
 * - a look said before its person is in the book is held, attached to exactly that
 *   person the moment they are added, and given to nobody else;
 * - saying the same look twice in other words does not stack it up;
 * - a book that heard people named but saved none offers them back, never a blank "who?";
 * - the guide's own reply is never taken as proof something was saved;
 * - the parent's own words are kept (even short facts), and trimming never removes the
 *   only place somebody is mentioned;
 * - a draft that leaves out a friend or pet the parent asked for is caught.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { resolvePerson } from "../books-frontend/src/core/guide/agent/resolve";
import { castWithAlias } from "../books-frontend/src/core/guide/aliases";
import { DEFAULT_GUIDE_COPY, GUIDE_COPY_HELP } from "../books-frontend/src/core/guide/copy";
import { isKinWord, kinRole } from "../books-frontend/src/core/guide/kinship";
import { joinLook } from "../books-frontend/src/core/guide/lookNotes";
import { claimsUnsavedPeople, likelyPeople } from "../books-frontend/src/core/guide/mentions";
import { applyGuidePatch, guidePatchContext } from "../books-frontend/src/core/guide/patch";
import {
  pendingLooksOf,
  placedLooks,
  reconcilePendingLooks,
  unaskedPendingLooks,
  withPendingLook,
  withPendingLooksAsked,
  withoutPendingLook,
} from "../books-frontend/src/core/guide/pending";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { renamePersonEverywhere } from "../books-frontend/src/core/guide/rename";
import { describeMissingPeople } from "../books-frontend/src/core/pipeline/guideInterpret";
import { inspectDraft, mentionedNames } from "../books-frontend/src/core/pipeline/storyValidate";
import { briefOf, castPromptLines, createDefaultStoryBrief, storyBriefSchema } from "../books-frontend/src/core/story/brief";
import {
  SOURCE_TEXT_MAX,
  isKeepable,
  isStoryTelling,
  sourceNotes,
  withSourceText,
} from "../books-frontend/src/core/story/sourceText";
import { createDefaultConfig, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const patchContext = guidePatchContext({});

function book(cast: StoryCastMember[], sourceText?: string): Project {
  return withAuthoring(
    {
      id: "people-book",
      title: "",
      createdAt: 0,
      updatedAt: 0,
      stage: "setup",
      furthestStage: "setup",
      config: {
        ...createDefaultConfig(),
        storyText: "",
        styleReady: false,
        storyBrief: { ...createDefaultStoryBrief("guided"), cast, ...(sourceText ? { sourceText } : {}) },
      },
    },
    { entry: "guided" },
  );
}

const member = (id: string, name: string, extra: Partial<StoryCastMember> = {}): StoryCastMember => ({ id, name, ...extra });
const namesOf = (project: Project): string[] => (briefOf(project.config).cast ?? []).map((m) => m.name);
const castOfBook = (project: Project, name: string): StoryCastMember | undefined =>
  (briefOf(project.config).cast ?? []).find((m) => m.name === name);

{
  // --- Family words and names -------------------------------------------------
  check(kinRole("my dad") === "father" && kinRole("Vater") === "father" && kinRole("Papa") === "father", "Family words do not map to a role.");
  check(kinRole("Aren") === null && kinRole("Anne") === null, "A given name was taken for a family word.");
  check(kinRole("the big dog") === null, "A phrase of several words was taken for a family word.");
  check(isKinWord("oma") && !isKinWord("Luca"), "isKinWord is wrong.");

  const family = book([member("a", "Aren", { age: 2 }), member("p", "Papa"), member("n", "Anne")]);
  for (const said of ["papa", "Papa", "Papa's", "papas", "dad", "Dad", "my dad", "Vater", "der Papa"]) {
    const found = resolvePerson(family, said);
    check(found.kind === "one" && found.value.name === "Papa", `"${said}" did not find Papa.`);
  }
  check(resolvePerson(family, "grandma").kind === "none", "A role nobody has was matched to somebody.");
  check(resolvePerson(family, "Aren").kind === "one", "A plain name no longer resolves.");

  const twoFathers = book([member("p", "Papa"), member("d", "Dad"), member("n", "Anne")]);
  check(resolvePerson(twoFathers, "father").kind === "many", "Two fathers did not ask which one.");
  check(resolvePerson(twoFathers, "Papa").kind === "one", "A name lost to a role when two people share it.");

  const aliased = book([member("n", "Anne", { aliases: ["mama"] }), member("p", "Papa")]);
  const mom = resolvePerson(aliased, "mom");
  check(mom.kind === "one" && mom.value.name === "Anne", "An alias that names a role was not found by a synonym.");
  check(resolvePerson(aliased, "mama").kind === "one", "An alias was not found by itself.");

  // A word two people share identifies neither.
  const shared = castWithAlias([member("a", "Aren", { aliases: ["boss"] }), member("b", "Bo")], "b", "Boss");
  check(!shared[1]!.aliases?.length, "A word that already belongs to somebody became a second person's alias.");

  // A rename keeps the old name findable.
  const renamed = renamePersonEverywhere(family, "p", "Dad");
  check(!("refused" in renamed), "Renaming Papa was refused.");
  if (!("refused" in renamed)) {
    const dad = castOfBook(renamed.project, "Dad");
    check(Boolean(dad?.aliases?.includes("Papa")), "The name a person had before a rename is not kept as an alias.");
    const found = resolvePerson(renamed.project, "papa");
    check(found.kind === "one" && found.value.name === "Dad", "The old name no longer finds the renamed person.");
    check(!castPromptLines(briefOf(renamed.project.config)).includes("Papa"), "An alias reached the story prompt.");
  }

  // --- Looks stay on their owner, and are held until they have one ----------------
  const heldFor = withPendingLook(book([]), "papa", "wears a gray cap");
  check(pendingLooksOf(heldFor).length === 1, "A look for nobody in the book was not held.");
  check(pendingLooksOf(withPendingLook(heldFor, "Papa", "a gray cap")).length === 1, "The same look was held twice.");
  check(reconcilePendingLooks(heldFor) === heldFor, "Reconciling with nobody in the book changed the book.");

  const added = applyGuidePatch(heldFor, { heroes: ["Aren", "Papa"] }, patchContext);
  check(added.applied.includes("heroes"), "The cast could not be written.");
  const placed = reconcilePendingLooks(added.project);
  const papa = castOfBook(placed, "Papa");
  check(Boolean(papa?.appearance?.includes("gray cap")), "A held look did not reach Papa once he was added.");
  check(!castOfBook(placed, "Aren")?.appearance, "Papa's cap went to somebody else.");
  check(pendingLooksOf(placed).length === 0, "A look that was placed is still held.");
  check(reconcilePendingLooks(placed) === placed, "Reconciling twice changed the book again.");
  check(
    placedLooks(added.project, placed).some((item) => item.name === "Papa" && /gray cap/.test(item.look)),
    "The chat cannot say who a held look went to.",
  );

  // A word that could mean two people stays held.
  const ambiguous = reconcilePendingLooks(withPendingLook(twoFathers, "father", "wears a gray cap"));
  check(pendingLooksOf(ambiguous).length === 1, "A look for 'father' was given to one of two fathers.");
  check(!castOfBook(ambiguous, "Papa")?.appearance && !castOfBook(ambiguous, "Dad")?.appearance, "An ambiguous look was written to somebody.");

  // The word used is learned, so the person is found the same way next time.
  const byRole = reconcilePendingLooks(withPendingLook(family, "dad", "has a red scarf"));
  check(Boolean(castOfBook(byRole, "Papa")?.appearance?.includes("red scarf")), "A look said for 'dad' did not reach Papa.");
  check(Boolean(castOfBook(byRole, "Papa")?.aliases?.some((a) => a.toLowerCase() === "dad")), "The word 'dad' was not learned as an alias.");

  // Asked once.
  check(unaskedPendingLooks(heldFor).length === 1, "A new held look counts as already asked.");
  const asked = withPendingLooksAsked(heldFor);
  check(unaskedPendingLooks(asked).length === 0 && pendingLooksOf(asked).length === 1, "Asking about a held look dropped it or asked twice.");
  check(withoutPendingLook(heldFor, "gray cap, wearing").valueOf() !== undefined, "withoutPendingLook failed.");
  check(pendingLooksOf(withoutPendingLook(heldFor, "a gray cap")).length === 0, "A look given to somebody properly stays held.");

  // Stored state is repaired, never trusted.
  const damaged = { ...heldFor, authoringState: { ...heldFor.authoringState!, pendingLooks: [{ words: "", look: "x" }, { words: "papa" }, null, { words: "oma", look: "has a blue hat", asked: true }] } } as unknown as Project;
  const repaired = pendingLooksOf(damaged);
  check(repaired.length === 1 && repaired[0]!.words === "oma" && repaired[0]!.asked === true, "A malformed held look was not repaired away.");

  // The describePerson skill holds a look for somebody who is not there, and places it for somebody who is.
  const viaSkill = GUIDE_COMMANDS.describePerson.run(book([member("a", "Aren")]), { person: "papa", look: "wears a gray cap" }, ctx);
  check(viaSkill.kind === "write" && pendingLooksOf((viaSkill as { project: Project }).project).length === 1, "describePerson refused a look for somebody not in the book yet.");
  check(!castOfBook((viaSkill as { project: Project }).project, "Aren")?.appearance, "describePerson gave an unknown person's look to the only person there.");
  const direct = GUIDE_COMMANDS.describePerson.run(family, { person: "dad", look: "wears a gray cap" }, ctx);
  const directBook = direct.kind === "write" ? (direct as { project: Project }).project : null;
  check(Boolean(directBook && castOfBook(directBook, "Papa")?.appearance?.includes("gray cap")), "describePerson did not find Papa by 'dad'.");
  check(Boolean(directBook && !castOfBook(directBook, "Anne")?.appearance && !castOfBook(directBook, "Aren")?.appearance), "describePerson put Papa's look on someone else.");
  if (directBook) {
    const again = GUIDE_COMMANDS.describePerson.run(directBook, { person: "papas", look: "cap is gray" }, ctx);
    const againBook = again.kind === "write" ? (again as { project: Project }).project : null;
    const text = againBook ? castOfBook(againBook, "Papa")?.appearance ?? "" : "";
    check((text.match(/cap/g) ?? []).length === 1, `The same look said twice stacked up: "${text}".`);
    const more = GUIDE_COMMANDS.describePerson.run(directBook, { person: "papa", look: "and glasses" }, ctx);
    const moreBook = more.kind === "write" ? (more as { project: Project }).project : null;
    check(/glasses/.test(moreBook ? castOfBook(moreBook, "Papa")?.appearance ?? "" : ""), "A new detail about the same person was dropped.");
  }

  check(joinLook("a gray cap", "gray cap") === "a gray cap", "joinLook added a duplicate.");
  check(joinLook("a gray cap", "gray cap with a blue stripe") === "gray cap with a blue stripe", "joinLook did not keep the fuller wording.");
  check(joinLook("a gray cap", "glasses") === "a gray cap; glasses", "joinLook lost a new look.");
  check(joinLook("a gray cap", "papas cap is gray", 400, ["Papa"]) === "a gray cap", "joinLook counted the owner's name as part of the look.");

  // --- Traits stay on one person ---------------------------------------------------
  const trait = applyGuidePatch(book([member("m", "Maya", { age: 6 }), member("l", "Leo", { age: 3 })]), { heroes: [{ name: "Maya", note: "loves dinosaurs" }, "Leo"] }, patchContext);
  check(castOfBook(trait.project, "Maya")?.note === "loves dinosaurs" && !castOfBook(trait.project, "Leo")?.note, "A trait did not stay on the person it was said about.");
  const again = applyGuidePatch(trait.project, { heroes: [{ name: "Maya", note: "she loves dinosaurs" }, "Leo"] }, patchContext);
  check(castOfBook(again.project, "Maya")?.note === "loves dinosaurs", "Saying a trait twice stacked it up.");
  check(storyBriefSchema.safeParse(briefOf(trait.project.config)).success, "A brief with aliases or notes does not satisfy its own schema.");
}

{
  // --- The bug: people named, nobody saved ---------------------------------------
  const message =
    "we are moving from california to germany. my twins Aren and Amira are 2, papa and anne come too. last day at the redwood room daycare, saying goodbye to our friends Luca and Nile";
  const reply = "I have the twins Aren and Amira, Papa, and Anne set up for a story about their move from California to Germany.";
  const heard = likelyPeople(message, { reply });
  check(heard.join(",") === "Aren,Amira,Papa,Anne", `The people heard were ${heard.join(",")}.`);
  check(!heard.some((name) => /california|germany|redwood|luca|nile/i.test(name)), "A place or a friend named in passing was offered as the cast.");

  const lower = likelyPeople("the twins aren and amira are 2, papa and anne come too", {});
  check(lower.join(",") === "Papa,Anne", `A lowercase message without a reply gave ${lower.join(",")}; only family words and their companions can be told apart then.`);
  const lowerWithReply = likelyPeople("the twins aren and amira are 2, papa and anne come too", { reply });
  check(lowerWithReply.join(",") === "Aren,Amira,Papa,Anne", `A lowercase message with the reply gave ${lowerWithReply.join(",")}.`);
  check(likelyPeople(message, { reply, known: ["Aren", "Papa"] }).join(",") === "Amira,Anne", "People already in the book were offered again.");
  check(likelyPeople("we fly from Hamburg to Berlin on Monday").length === 0, "Places and days were offered as people.");
  check(likelyPeople("make it rhyme and keep it short please").length === 0, "Ordinary words were offered as people.");

  check(claimsUnsavedPeople(reply, message, []), "A reply naming unsaved people was not recognised as claiming them.");
  check(!claimsUnsavedPeople(reply, message, ["Aren", "Amira", "Papa", "Anne"]), "A reply naming saved people was held back.");
  check(!claimsUnsavedPeople("Sorry, could you say that again?", message, []), "A reply naming nobody was held back.");

  // The retry: asked for when a telling produced no people, and never otherwise.
  const empty = book([]);
  const none = { claims: [], refused: [], intent: "answer" as const, reply };
  const problem = describeMissingPeople(none, { project: empty, message });
  check(/heroes/.test(problem) && /Aren/.test(problem) && /Papa/.test(problem), "The missing people were not described to the model.");
  check(!/Luca|Nile|California/.test(problem), "The retry asked for a friend or a place.");
  check(describeMissingPeople({ ...none, claims: [{ slot: "heroes" }] }, { project: empty, message }) === "", "A claimed cast was asked for again.");
  check(describeMissingPeople({ ...none, refused: [{ slot: "heroes" }] }, { project: empty, message }) === "", "A refused cast was described twice.");
  check(describeMissingPeople({ ...none, intent: "question" as const }, { project: empty, message }) === "", "A question was treated as a telling.");
  check(describeMissingPeople(none, { project: book([member("a", "Aren")]), message }) === "", "A book that has people was asked for people.");
  check(describeMissingPeople(none, { project: empty, message: "yes" }) === "", "A one-word answer was treated as a telling.");
  const own = { ...empty, config: { ...empty.config, storyBrief: createDefaultStoryBrief("own") } };
  check(describeMissingPeople(none, { project: own, message }) === "", "The parent's own story was asked for a cast.");

  // The offered question exists, names the people, and is explained for the admin.
  check(DEFAULT_GUIDE_COPY.confirmPeople.includes("{names}") && /yes/i.test(DEFAULT_GUIDE_COPY.confirmPeople), "The confirmation question does not name the people or say how to answer.");
  for (const key of ["confirmPeople", "lookPending", "lookPlaced", "lookPendingAsk"] as const) {
    check(Boolean(DEFAULT_GUIDE_COPY[key]) && DEFAULT_GUIDE_COPY[key].length <= 200, `${key} is missing or too long.`);
    check(Boolean(GUIDE_COPY_HELP[key]), `${key} has no admin hint.`);
  }
}

{
  // --- The parent's words are kept, and nobody is lost to trimming ---------------
  check(isKeepable("Papa wears a gray cap") && !isStoryTelling("Papa wears a gray cap"), "A short fact about somebody was not kept.");
  check(isKeepable("Luca is Aren's best friend"), "A short fact with a family or friend word was not kept.");
  for (const noise of ["yes", "ok go ahead", "no thanks", "2", "go"]) {
    check(!isKeepable(noise), `"${noise}" was kept as a note.`);
  }
  const brief = { ...createDefaultStoryBrief("guided"), cast: [member("a", "Aren")] };
  check(sourceNotes(withSourceText(brief, "Papa wears a gray cap")).length === 1, "A short fact did not reach the kept words.");
  check(!("sourceText" in withSourceText(brief, "yes")), "An answer was added to the kept words.");

  // Over the limit, the oldest note goes, except the only one that mentions somebody.
  const filler = (n: number) => `Day ${n}. ${"The bus goes by the old bridge every single morning. ".repeat(27)}`.slice(0, 1400);
  let grown = withSourceText(brief, "Aren is afraid of the dark and loves his green dinosaur very much indeed.");
  for (let i = 0; i < 6; i += 1) grown = withSourceText(grown, filler(i));
  const text = grown.sourceText ?? "";
  check(sourceNotes(grown).length > 2, "The trimming test never filled the kept words.");
  check(text.length <= SOURCE_TEXT_MAX, `The kept words outgrew their limit (${text.length}).`);
  check(/Aren/.test(text), "Trimming removed the only mention of a person in the book.");
  check(/afraid of the dark/.test(text), "Trimming cut the sentence that names the person.");
  const nobody = { ...createDefaultStoryBrief("guided"), cast: [] };
  let plain = withSourceText(nobody, "Once upon a time there was a bus that went by the bridge every day.");
  for (let i = 0; i < 6; i += 1) plain = withSourceText(plain, filler(i));
  check((plain.sourceText ?? "").length <= SOURCE_TEXT_MAX && !/Once upon a time/.test(plain.sourceText ?? ""), "With nobody to protect, the oldest note was not the first to go.");

  // --- A draft that leaves out a friend or a pet is caught ------------------------
  const told = { ...createDefaultStoryBrief("guided"), cast: [member("a", "Aren"), member("m", "Amira")], heroNames: ["Aren", "Amira"], sourceText: "The twins Aren and Amira say goodbye at the Redwood room to their friends Luca and Nile, and our dog Rex waits." };
  check(mentionedNames(told).join(",") === "Luca,Nile,Rex", `The names asked for were ${mentionedNames(told).join(",")}.`);
  const rules = { minWords: 1, maxWords: 10000, maxSentenceWords: 0 } as never;
  const without = inspectDraft("Aren and Amira said goodbye at the Redwood room. Rex waited.", told, rules);
  check(without.missingMentioned.join(",") === "Luca,Nile" && /Luca/.test(without.repairInstruction), "A draft without the friends was not caught.");
  const complete = inspectDraft("Aren and Amira said goodbye to Luca and Nile. Rex waited.", told, rules);
  check(complete.missingMentioned.length === 0 && complete.repairInstruction === "", "A draft with everyone was flagged.");
  check(!/Redwood/.test(without.missingMentioned.join(",")), "A place was demanded in the story.");
}

report.push("People: names and family words, held looks, kept words and drafts");
notes.push("People: family words, aliases, held looks, restated looks, the missing-people retry, kept words and the draft's friends checked");

export function checkGuidePeople(): CheckResult {
  return { failures, notes, report, cases };
}
