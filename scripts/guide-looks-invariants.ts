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
import { collectSourceArtGroups, derivedStyleSelection, hasSourceArt } from "../books-frontend/src/core/book/sourceArt";
import { artworkStyleRole, settleOnFirstArtwork, styleArtworkName, styleIsFromArtwork } from "../books-frontend/src/core/guide/artworkStyle";
import { plannedPortraitReferences } from "../books-frontend/src/core/billing/referencePlan";
import { GUIDE_COMMANDS } from "../books-frontend/src/core/guide/agent/registry";
import { planTurn } from "../books-frontend/src/core/guide/agent/plan";
import type { CommandContext } from "../books-frontend/src/core/guide/agent/types";
import { createDefaultGuideAgentConfig } from "../books-frontend/src/core/config/guideAgent";
import { applyGuidePatch, captureGuideFacts, guidePatchContext } from "../books-frontend/src/core/guide/patch";
import { createDefaultGuidePlaylist, resolveGuidePlaylist } from "../books-frontend/src/core/guide/playlist";
import { describeClaimProblems, sanitizeGuideTurn, type SanitizeGuideTurnOptions } from "../books-frontend/src/core/pipeline/guideInterpret";
import { createDefaultGuideFactPolicies } from "../books-frontend/src/core/guide/factPolicy";
import { availableViews, BOOK_CHOICE_KINDS, deriveJourney, styleChoiceOpen, type Journey } from "../books-frontend/src/core/guide/journey";
import { manuscriptHash } from "../books-frontend/src/core/guide/ownWords";
import {
  likenessPhotosOf,
  lookDecided,
  lookFocusOf,
  lookSourceOf,
  looksToDecide,
  portraitInputs,
  portraitIsCurrent,
  portraitReferencePlan,
  portraitStatus,
  styleRevert,
  withLooksDecided,
  withoutUsedPhotos,
  withPresetStyle,
  withStyleReverted,
} from "../books-frontend/src/core/guide/portrait";
import { authoringOf, withAuthoring } from "../books-frontend/src/core/guide/projectState";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import { createDefaultConfig, LIKENESS_PHOTOS_MAX, type Project, type StoryCastMember } from "../books-frontend/src/core/types";
import type { CheckResult } from "./guide-agent-invariants";

/** The first open card about the people, past the book's own choices (format, layout, cover words). */
const askedAboutPeople = (journey: Pick<Journey, "open">) =>
  journey.open.find((item) => !BOOK_CHOICE_KINDS.has(item.kind));


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
  // A settled look is something to look at again: the plate, and with it the
  // editor, is reachable for any person before a single portrait is drawn
  // (otherwise a photo given for the first person could never be changed once
  // the second was asked).
  const oneSettled = withLooksDecided(written, ["c1"]);
  check(
    availableViews(oneSettled).includes("cast"),
    "A person whose look is settled has no plate to change it from before portraits exist.",
  );
  check(journey(oneSettled).suggestedView !== "cast", "A settled look pulls the book pane onto the People tab.");
  check(
    availableViews(
      withMember(written, "c2", { appearance: "Curly red hair", lookSource: "describe", appearanceFromStory: false }),
    ).includes("cast"),
    "A description given for someone does not open the People tab.",
  );
  check(
    !availableViews(withMember(written, "c2", { appearance: "Curly red hair", appearanceFromStory: true })).includes("cast"),
    "A description the story analysis wrote (not the reader) opens the People tab.",
  );
  const drawingPortraits = deriveJourney(withLooksDecided(written, ["c1", "c2"]), policies, {
    activeUnitIds: new Set(["c1"]),
  });
  check(
    drawingPortraits.views.includes("cast") && drawingPortraits.suggestedView === "cast",
    "The People tab doesn't open while the portraits are being drawn.",
  );
  check(availableViews(withPortraits(withLooksDecided(written, ["c1", "c2"]))).includes("cast"), "The People tab doesn't arrive with the portraits.");
  // Once the portraits are there they are what the book shows, not the story.
  const drawn = journey(withPortraits(withLooksDecided(written, ["c1", "c2"])));
  check(
    drawn.suggestedView === "cast",
    `The book points at the ${drawn.suggestedView ?? "no"} tab after the portraits arrive, not the people.`,
  );
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
  const styledViews = availableViews({
    ...settled,
    config: { ...settled.config, styleReady: true },
  });
  check(
    styledViews.indexOf("story") < styledViews.indexOf("style"),
    "The Style tab jumps in before the Story tab even though the story arrived first.",
  );

  const drawn = withMember(settled, "c1", { sourceArt: [{ blobId: "art-1", mimeType: "image/png", createdAt: 1 }], lookSource: "drawing" });
  const derived: Project = {
    ...drawn,
    config: { ...drawn.config, styleReady: true, artStyle: derivedStyleSelection({ stylePrompt: "crayon", derivedFromNames: ["Maya"] }) },
  };
  check(!styleChoiceOpen(derived, journey(derived)), "The style picker shows although a drawing already set the style.");
  check(journey(derived).well?.kind === "portraits", "After the drawing set the style, the portraits aren't next.");

  const own = book([maya, leo], STORY, "own");
  check(askedAboutPeople(journey(own))?.kind === "castLooks", "An own-words book isn't asked about looks once the story is read.");
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

  const withOldPortrait = withAuthoring(used, {
    portraits: {
      c1: createVersionTree(image),
    },
  });
  const restyled: Project = {
    ...withOldPortrait,
    config: {
      ...withOldPortrait.config,
      artStyle: {
        presetId: "ink",
        generationReference: {
          imageUrl: "https://example.com/ink.webp",
          storagePath: "public/artStyles/ink/generation-1.webp",
          mimeType: "image/webp",
          updatedAt: 2,
        },
      },
    },
  };
  const restylePlan = portraitReferencePlan(restyled, briefCast(restyled)[0]!);
  check(restylePlan.existing.length === 1, "A style redraw loses identity after its one-use photo was deleted.");
  check(restylePlan.catalogStyle.length === 1, "A preset's generation reference is missing from a portrait redraw.");
  const oneSlot = { maxReferenceImages: 1, maxImages: 1, referenceEditing: true };
  check(
    plannedPortraitReferences(restyled, "c1", oneSlot) === 1,
    "A one-reference model doesn't reserve its only portrait reference for identity.",
  );
  check(
    plannedPortraitReferences(restyled, "c1", { ...oneSlot, maxReferenceImages: 2, maxImages: 2 }) === 2,
    "A two-reference model doesn't plan both identity and style.",
  );
  const changedIdentity = withMember(restyled, "c1", { kind: "animal", species: "fox", bodyPlan: "quadruped" });
  check(
    portraitReferencePlan(changedIdentity, briefCast(changedIdentity)[0]!).existing.length === 0,
    "A portrait from the person's old species is reused after their identity changes.",
  );
}

// --- A drawing is the book's look, for whoever has the first one ----------------------------------------
// The first drawing on the book sets its look whichever person it is on; the
// others are drawn in it. Taking a preset instead takes the drawings off the
// book in the same change, and "keep the old look" puts both back.

{
  const art = (blobId: string, createdAt: number) => ({ blobId, mimeType: "image/png", createdAt });
  const leoArt = art("leo-art", 10);
  const mayaArt = art("maya-art", 20);
  const fromLeo = (project: Project): Project => {
    const withArt = withMember(project, "c2", { sourceArt: [leoArt], lookSource: "drawing", lookFromArt: "a small fox in a red scarf" });
    return {
      ...withArt,
      anchors: [{ id: "a-leo", type: "character", name: "Leo", sourceArt: [leoArt], lookFromArt: "a small fox in a red scarf" } as never],
      config: {
        ...withArt.config,
        styleReady: true,
        artStyle: derivedStyleSelection({ stylePrompt: "soft pencil", derivedFromNames: ["Leo"], referenceArt: [leoArt] }),
      },
    };
  };
  const styled = fromLeo(withLooksDecided(book([maya, leo]), ["c1", "c2"]));
  const [mayaMember, leoMember] = briefCast(styled) as [StoryCastMember, StoryCastMember];

  const mayaRole = artworkStyleRole(styled, mayaMember);
  check(mayaRole.kind === "follows" && mayaRole.name === "Leo", "A person without a drawing does not follow the drawing that set the look.");
  check(artworkStyleRole(styled, leoMember).kind === "sets", "The person whose drawing set the look can't replace it.");
  check(styleArtworkName(styled) === "Leo", "The Style tab can't name whose drawing the look comes from.");
  const noStyleYet = withMember(book([maya, leo]), "c2", { sourceArt: [leoArt], lookSource: "drawing" });
  check(artworkStyleRole(noStyleYet, mayaMember).kind === "sets", "The first drawing doesn't set the look while the book has none.");
  const presetBook: Project = { ...book([maya, leo]), config: { ...book([maya, leo]).config, styleReady: true, artStyle: { presetId: "ink", origin: "preset" } } };
  const presetRole = artworkStyleRole(presetBook, mayaMember);
  check(presetRole.kind === "sets" && presetRole.replaces === "ink", "A drawing on a preset book doesn't say it replaces the preset.");

  // Drawings that do not share a look still give one: the earliest drawing's.
  const both = withMember(withMember(book([maya, leo]), "c1", { sourceArt: [mayaArt], lookSource: "drawing" }), "c2", { sourceArt: [leoArt], lookSource: "drawing" });
  const clash = settleOnFirstArtwork(both, {
    status: "conflict",
    options: [
      { id: "c1", name: "Maya", stylePrompt: "bold ink" },
      { id: "c2", name: "Leo", stylePrompt: "soft pencil" },
    ],
  });
  check(
    clash.status === "resolved" && clash.style.customDescription === "soft pencil" && clash.style.referenceArt?.[0]?.blobId === "leo-art",
    "A clash of drawings is not settled by the earliest one.",
  );
  check(
    clash.status === "resolved" && clash.style.derivedFromNames?.join() === "Leo",
    "The look from a clash doesn't name the earliest drawing's person.",
  );

  // Taking a preset takes the drawings off the book, together with the look.
  const drawn = withPortraits(styled);
  check(portraitStatus(drawn, "c2") === "current", "The test book's portrait isn't current to begin with.");
  const preset = { presetId: "ink", origin: "preset" as const };
  const switched = withPresetStyle(drawn, preset);
  check(switched.config.artStyle.origin === "preset" && switched.config.artStyle.presetId === "ink", "The preset isn't the look after switching.");
  check(collectSourceArtGroups(switched).length === 0 && !hasSourceArt(switched), "A drawing is left on the book after the look moved to a preset.");
  const leoAfter = briefCast(switched)[1]!;
  check(lookSourceOf(leoAfter) !== "drawing" && !leoAfter.sourceArt, "A person is still drawn from a drawing the book no longer uses.");
  check(leoAfter.lookSource === "describe" && Boolean(leoAfter.appearance?.includes("fox")), "A retired drawing's description is lost.");
  check(portraitStatus(switched, "c2") !== "current", "A portrait drawn from the retired drawing still counts as current.");
  check((switched.anchors?.[0] as { sourceArt?: unknown } | undefined)?.sourceArt === undefined, "A character sheet still carries the retired drawing.");

  // ...and "keep the old look" puts them back.
  check(styleRevert(switched) !== null, "Taking back the drawing's look isn't offered after switching.");
  const back = withStyleReverted(switched);
  check(back.config.artStyle.origin === "derived" && styleIsFromArtwork(back), "Keeping the old look doesn't bring the drawing's style back.");
  check(briefCast(back)[1]?.sourceArt?.[0]?.blobId === "leo-art" && briefCast(back)[1]?.lookSource === "drawing", "Keeping the old look doesn't bring the drawing back.");
  check((back.anchors?.[0] as { sourceArt?: { blobId: string }[] } | undefined)?.sourceArt?.[0]?.blobId === "leo-art", "Keeping the old look leaves the character sheet without its drawing.");
  check(portraitStatus(back, "c2") === "current", "Keeping the old look doesn't make the portrait current again.");
  check(authoringOf(back).retiredArtwork === undefined, "A restored drawing is kept as retired too.");

  // With nothing drawn there is nothing to take back, so nothing is kept.
  const undrawn = withPresetStyle(styled, preset);
  check(authoringOf(undrawn).retiredArtwork === undefined, "Retired drawings are kept although no portrait could use them again.");
  check(!hasSourceArt(undrawn), "A drawing is left on an undrawn book after switching to a preset.");

  // A preset to a preset leaves the plates alone.
  const presetToPreset = withPresetStyle(presetBook, { presetId: "paper", origin: "preset" });
  check(presetToPreset.config.artStyle.presetId === "paper", "A preset can't replace a preset.");

  // The chat's skill asks first when the look is a drawing's, and not otherwise.
  const impact = GUIDE_COMMANDS.setStyle!.impact!(
    drawn,
    { style: "ink" },
    { ...ctx, styles: [{ id: "ink", label: "Ink" }] },
  );
  check(
    impact.level === "destructive" && impact.effects.some((effect) => effect.kind === "retiresArtwork"),
    "Switching away from a drawing's look in the chat doesn't ask first.",
  );
  const plain = GUIDE_COMMANDS.setStyle!.impact!(presetBook, { style: "paper" }, { ...ctx, styles: [{ id: "paper", label: "Paper" }] });
  check(plain.level === "none" || plain.level === "reversible", "Switching between presets asks as if a drawing were lost.");

  // The same change typed as a fact must not skip that question: the fact
  // writer would take the drawing off the book without asking.
  const patchContext = guidePatchContext({ audience: null, artStyles: null });
  const [firstPreset, secondPreset] = patchContext.artStylePresetIds as [string, string];
  const typed = applyGuidePatch(drawn, { artStyle: { presetId: firstPreset } }, patchContext);
  check(!typed.applied.includes("artStyle"), "A typed style change was written over a drawing's look.");
  check(
    typed.project.config.artStyle.origin === "derived" && hasSourceArt(typed.project) && portraitStatus(typed.project, "c2") === "current",
    "A typed style change took the drawing off the book without asking.",
  );
  const rerouted = typed.rejected.find((rejection) => rejection.key === "artStyle");
  check(
    rerouted?.reroute?.command === "setStyle" && rerouted.reroute.args.style === firstPreset,
    "A refused typed style change isn't handed to the skill that asks.",
  );
  const typedCustom = applyGuidePatch(drawn, { artStyle: { presetId: null, customDescription: "a vintage postcard" } }, patchContext);
  check(
    !typedCustom.applied.includes("artStyle") && typedCustom.project.config.artStyle.origin === "derived",
    "A typed custom style was written over a drawing's look.",
  );
  check(
    typedCustom.rejected.find((rejection) => rejection.key === "artStyle")?.reroute?.args.style === "a vintage postcard",
    "A typed custom style isn't handed to the skill that asks.",
  );
  const restated = applyGuidePatch(drawn, { artStyle: captureGuideFacts(drawn).artStyle }, patchContext);
  check(restated.unchanged.includes("artStyle") && restated.rejected.length === 0, "Restating the drawing's own look is refused.");
  const presetTyped = applyGuidePatch(
    { ...presetBook, config: { ...presetBook.config, artStyle: { presetId: firstPreset, origin: "preset" } } },
    { artStyle: { presetId: secondPreset } },
    patchContext,
  );
  check(presetTyped.applied.includes("artStyle") && presetTyped.project.config.artStyle.presetId === secondPreset, "A typed style change on a preset book was refused.");

  // From a message, the interpreter files the words as that skill's call, once.
  const said = `Change the art style to ${firstPreset}`;
  const turn = { intent: "revise" as const, reply: "Sure.", confidence: 0.9 };
  const stated = { slot: "artStyle", value: { presetId: firstPreset }, evidence: said, confidence: 0.95 };
  const reading = (skills: SanitizeGuideTurnOptions["skills"]): SanitizeGuideTurnOptions => ({
    playlist: resolveGuidePlaylist(createDefaultGuidePlaylist()),
    message: said,
    project: drawn,
    patchContext,
    ...(skills ? { skills } : {}),
  });
  const skills = { enabled: ["setStyle" as const], floor: 0.5, max: 4 };
  const filed = sanitizeGuideTurn({ ...turn, claims: [stated] }, reading(skills));
  check(!("artStyle" in filed.patch), "A style claim over a drawing's look still reaches the patch.");
  check(
    filed.commands.length === 1 && filed.commands[0]!.id === "setStyle" && filed.commands[0]!.args.style === firstPreset,
    "A style claim over a drawing's look isn't filed as the setStyle skill.",
  );
  check(filed.refused.some((claim) => claim.refusal === "rerouted"), "A rerouted style claim isn't accounted for in the turn log.");
  check(describeClaimProblems(filed.refused) === "", "A rerouted style claim is sent back to the model for repair.");

  const doubled = sanitizeGuideTurn(
    { ...turn, claims: [stated], commands: [{ id: "setStyle", args: [{ name: "style", value: firstPreset }], evidence: said, confidence: 0.9 }] },
    reading(skills),
  );
  check(doubled.commands.length === 1, "A style the model also asked for as a skill is asked twice.");

  const withoutSkills = sanitizeGuideTurn({ ...turn, claims: [stated] }, reading(undefined));
  check(
    !("artStyle" in withoutSkills.patch) && withoutSkills.commands.length === 0 && withoutSkills.refused.some((claim) => claim.refusal === "rejected"),
    "With skills off, a style claim over a drawing's look is written or lost without a record.",
  );

  // The skill it is filed as asks before it takes the drawing off.
  const planned = planTurn({
    project: drawn,
    calls: filed.commands,
    ctx: { ...ctx, styles: patchContext.artStylePresetIds.map((id) => ({ id, label: id })) },
    config: createDefaultGuideAgentConfig(),
  });
  check(
    planned.confirm !== null && planned.steps.length === 0 && planned.confirm.impact.effects.some((effect) => effect.kind === "retiresArtwork"),
    "A filed style change doesn't ask before it takes the drawing off.",
  );
}

function briefCast(project: Project): StoryCastMember[] {
  return project.config.storyBrief?.cast ?? [];
}

report.push("People and looks");
report.push("  People tab with the first portrait; looks asked one person at a time, before the style");
report.push("  a look tap starts that portrait; up to three photos, dropped once drawn");
report.push("  the first drawing sets the look; a preset retires it, and keeping the old look restores it");
notes.push("People and looks: tab timing, looks order, style gate, choosePersonLook, auto-start fallback and photos checked");

export function checkGuideLooks(): CheckResult {
  return { failures, notes, report, cases };
}
