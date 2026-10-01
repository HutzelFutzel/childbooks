/**
 * Invariants for how each person's look is settled in the Chat, and when the
 * People tab and the style picker appear.
 *
 * The claims worth checking are the ones a parent would notice:
 *
 * - no empty People tab: it arrives with the first portrait (or when names
 *   need fixing), never right after names and ages;
 * - once the story is written, the chat asks where each person's look comes
 *   from, one person at a time, before the style and before any portrait;
 * - a description copied from the story is not the parent's choice, their own
 *   words are, and so are a photo, a drawing and "let the story decide";
 * - the style picker waits for the looks, and a drawing that set the style
 *   means the picker is never shown;
 * - asking in words ("I have a photo of Leo") opens the card on that person.
 *
 * Offline and deterministic: pure functions over synthesized books.
 */
import { derivedStyleSelection } from "../books-frontend/src/core/book/sourceArt";
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import { availableViews, deriveJourney, styleChoiceOpen } from "../books-frontend/src/core/guide/journey";
import { manuscriptHash } from "../books-frontend/src/core/guide/ownWords";
import {
  likenessPhotosOf,
  lookDecided,
  lookFocusOf,
  looksToDecide,
  portraitInputs,
  portraitIsCurrent,
  portraitReferencePlan,
  withLooksDecided,
  withoutUsedPhotos,
} from "../books-frontend/src/core/guide/portrait";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import { createDefaultConfig, LIKENESS_PHOTOS_MAX, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import type { CheckResult } from "./guide-agent-invariants";

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function check(condition: boolean, message: string): void {
  cases += 1;
  if (!condition) failures.push(message);
}

const policies = createDefaultGuideFactPolicies();
const ctx: CommandContext = { now: 1, guest: false, styles: [], languages: [] };
const STORY = "Maya and her brother Leo built a fort out of blankets and found a map inside.";

function book(cast: StoryCastMember[], storyText = STORY, entry: "guided" | "own" = "guided"): Project {
  const project: Project = {
    id: "looks-book",
    title: "",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: {
      ...createDefaultConfig(),
      storyText,
      styleReady: false,
      storyBrief: { ...createDefaultStoryBrief(entry === "own" ? "own" : "guided"), cast },
    },
  };
  return withAuthoring(project, {
    entry,
    askedFacts: ["names", "ages"],
    ...(entry === "own"
      ? {
          extraction: { storyHash: manuscriptHash(storyText), at: 1, names: cast.map((m) => m.name), unresolved: [] },
          // Asked once after the reading; settled here so the looks come next.
          answeredFacts: ["readingAge"],
          skippedFacts: ["pictureNotes"],
        }
      : {}),
  });
}

const maya: StoryCastMember = { id: "c1", name: "Maya", age: 5 };
const leo: StoryCastMember = { id: "c2", name: "Leo", age: 3 };
const journey = (project: Project) => deriveJourney(project, policies);
const withMember = (project: Project, id: string, changes: Partial<StoryCastMember>): Project => ({
  ...project,
  config: {
    ...project.config,
    storyBrief: {
      ...project.config.storyBrief!,
      cast: (project.config.storyBrief?.cast ?? []).map((m) => (m.id === id ? { ...m, ...changes } : m)),
    },
  },
});
const withPortraits = (project: Project): Project =>
  withAuthoring(project, {
    portraits: Object.fromEntries(
      (project.config.storyBrief?.cast ?? []).map((m, index) => [
        m.id,
        createVersionTree({ blobId: `p-${m.id}`, mimeType: "image/png", createdAt: index + 1, inputs: portraitInputs(project, m) }),
      ]),
    ),
  });

// --- The People tab arrives with the pictures ---------------------------------------------------------

{
  const named = book([maya, leo], "");
  check(!availableViews(named).includes("cast"), "The People tab shows right after names and ages, before any portrait.");
  check(journey(named).suggestedView !== "cast", "The book pane points at an empty People tab.");
  const written = book([maya, leo]);
  check(!availableViews(written).includes("cast"), "The People tab shows before any portrait exists.");
  check(availableViews(withPortraits(withLooksDecided(written, ["c1", "c2"]))).includes("cast"), "The People tab doesn't arrive with the portraits.");
  const unsure = withAuthoring(book([maya, leo], STORY, "own"), {
    extraction: { storyHash: manuscriptHash(STORY), at: 1, names: ["Maya", "Leo"], unresolved: ["Leo"] },
  });
  check(availableViews(unsure).includes("cast"), "Names that need fixing have nowhere to be fixed: the People tab is hidden.");
}

// --- One person at a time, before the style ----------------------------------------------------------

{
  const written = book([maya, leo]);
  const first = journey(written).well;
  check(first?.kind === "castLooks" && first.castId === "c1" && first.remaining === 2, "The looks aren't asked, first person first, once the story is written.");
  check(!styleChoiceOpen(written, journey(written)), "The style picker shows before everyone's look is settled.");
  check(journey(book([maya, leo], "")).well?.kind !== "castLooks", "The looks are asked before the story exists.");

  const copied = withMember(written, "c1", { appearance: "curly hair, red boots", appearanceFromStory: true });
  check(!lookDecided(copied, briefCast(copied)[0]!), "A description copied from the story counts as the parent's choice.");
  const described = withMember(written, "c1", { appearance: "curly hair, red boots", appearanceFromStory: false, lookSource: "describe" });
  check(lookDecided(described, briefCast(described)[0]!), "The parent's own description doesn't settle the look.");
  const next = journey(described).well;
  check(next?.kind === "castLooks" && next.castId === "c2" && next.remaining === 1, "After one person, the next one isn't asked.");

  const photo = withMember(written, "c1", { likenessPhoto: { createdAt: 1, expiresAt: 2, consentVersion: "v1" }, lookSource: "photo" });
  check(lookDecided(photo, briefCast(photo)[0]!), "A photo doesn't settle the look.");
  check(lookDecided(withLooksDecided(written, ["c1"]), maya), "'Let the story decide' doesn't settle the look.");
  check(lookDecided(withPortraits(written), maya), "A drawn portrait still gets asked about.");

  const settled = withLooksDecided(written, ["c1", "c2"]);
  check(looksToDecide(settled).length === 0, "Settled looks are asked again.");
  check(styleChoiceOpen(settled, journey(settled)), "The style picker doesn't follow once everyone's look is settled.");

  const drawn = withMember(settled, "c1", { sourceArt: [{ blobId: "art-1", mimeType: "image/png", createdAt: 1 }], lookSource: "drawing" });
  const derived: Project = {
    ...drawn,
    config: { ...drawn.config, styleReady: true, artStyle: derivedStyleSelection({ stylePrompt: "crayon", derivedFromNames: ["Maya"] }) },
  };
  check(!styleChoiceOpen(derived, journey(derived)), "The style picker shows although a drawing already set the style.");
  check(journey(derived).well?.kind === "portraits", "After the drawing set the style, the portraits aren't next.");

  const own = book([maya, leo], STORY, "own");
  check(journey(own).well?.kind === "castLooks", "An own-words book isn't asked about looks once the story is read.");
  const unread = withAuthoring(own, { extraction: undefined });
  check(!styleChoiceOpen(unread, journey(unread)), "The style picker shows while the own-words story is still being read.");
}

// --- Asking in words ------------------------------------------------------------------------------------

{
  const skill = GUIDE_COMMANDS.choosePersonLook;
  const written = book([maya, leo]);
  const all = skill.run(written, { source: "story" }, ctx);
  check(all.kind === "write" && looksToDecide(all.project).length === 0, "'Make them all up' doesn't settle everyone.");
  const photo = skill.run(written, { person: "Leo", source: "photo" }, ctx);
  check(photo.kind === "write", "'I have a photo of Leo' changes nothing.");
  if (photo.kind === "write") {
    check(lookFocusOf(photo.project)?.castId === "c2" && lookFocusOf(photo.project)?.source === "photo", "'I have a photo of Leo' doesn't open the photo option.");
    const well = journey(photo.project).well;
    check(well?.kind === "castLooks" && well.castId === "c2", "The looks card doesn't move to the person asked about.");
    check(!lookDecided(photo.project, leo), "Asking for a photo settles the look before a photo exists.");
    const after = withLooksDecided(photo.project, ["c2"]);
    check(!authoringOf(after).lookFocus, "The looks card stays pointed at someone already settled.");
  }
  const one = skill.run(written, { person: "Maya", source: "story" }, ctx);
  check(one.kind === "write" && lookDecided(one.project, maya) && !lookDecided(one.project, leo), "Letting the story decide for one person settles someone else.");
  const again = skill.run(withLooksDecided(written, ["c1"]), { person: "Maya", source: "photo" }, ctx);
  check(again.kind === "noop" && again.beat.key === "lookOnPlate", "A settled person isn't pointed to their card for a change.");
}

// --- Portraits start from the choice ------------------------------------------------------------------
// A look tap on a styled book starts that portrait, so the next look is asked
// while it draws, and the portraits button (the fallback) never offers anyone
// already drawing.

{
  const styled: Project = { ...book([maya, leo]), config: { ...book([maya, leo]).config, styleReady: true } };
  const mayaSettled = withLooksDecided(styled, ["c1"]);
  const drawingMaya = deriveJourney(mayaSettled, policies, { activeUnitIds: new Set(["c1"]) }).well;
  check(drawingMaya?.kind === "castLooks" && drawingMaya.castId === "c2", "Leo's look waits until Maya's portrait is done.");

  const bothSettled = withLooksDecided(styled, ["c1", "c2"]);
  const fallback = deriveJourney(bothSettled, policies, { activeUnitIds: new Set(["c1"]) }).well;
  check(
    fallback?.kind === "portraits" && fallback.castIds.length === 1 && fallback.castIds[0] === "c2",
    "The portraits button offers someone who is already being drawn.",
  );
  const everyoneDrawing = deriveJourney(bothSettled, policies, { activeUnitIds: new Set(["c1", "c2"]) }).well;
  check(everyoneDrawing?.kind !== "portraits", "The portraits button shows while everyone is being drawn.");
}

// --- Up to three photos --------------------------------------------------------------------------------

{
  const photo = (createdAt: number) => ({ createdAt, expiresAt: createdAt + 1, consentVersion: "v1" });
  const three = withMember(book([maya, leo]), "c1", {
    likenessPhoto: photo(1),
    moreLikenessPhotos: [photo(2), photo(3)],
    lookSource: "photo",
  });
  const member = briefCast(three)[0]!;
  check(likenessPhotosOf(member).length === LIKENESS_PHOTOS_MAX, "A person's photos aren't all used.");
  check(portraitReferencePlan(three, member).photos === 3, "The portrait's reference plan doesn't count every photo.");
  const inputs = portraitInputs(three, member);
  const used = withoutUsedPhotos(three, "c1", inputs);
  const after = briefCast(used)[0]!;
  check(!after.likenessPhoto && !after.moreLikenessPhotos, "A finished portrait leaves its photo receipts behind.");
  const addedLater = withMember(three, "c1", { likenessPhoto: photo(4), moreLikenessPhotos: [photo(2)] });
  const kept = briefCast(withoutUsedPhotos(addedLater, "c1", inputs))[0]!;
  check(
    kept.likenessPhoto?.createdAt === 4 && !kept.moreLikenessPhotos,
    "A photo added while the portrait drew is dropped with the used ones.",
  );
  const image = { blobId: "p-c1", mimeType: "image/png", createdAt: 1, inputs };
  check(portraitIsCurrent(used, image), "Dropping the used photos makes the portrait look outdated.");
}

function briefCast(project: Project): StoryCastMember[] {
  return project.config.storyBrief?.cast ?? [];
}

report.push("People and looks");
report.push("  People tab with the first portrait; looks asked one person at a time, before the style");
report.push("  a look tap starts that portrait; up to three photos, dropped once drawn");
notes.push("People and looks: tab timing, looks order, style gate, choosePersonLook, auto-start fallback and photos checked");

export function checkGuideLooks(): CheckResult {
  return { failures, notes, report, cases };
}
