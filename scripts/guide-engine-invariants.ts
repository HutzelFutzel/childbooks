/**
 * Invariants for the guide's state model: the catalog, the playlist, the engine
 * and the closed-world patch.
 *
 * The engine decides what the guide asks next, and it is admin-configurable — so
 * the thing to be sure of isn't that one flow works, it's that no flow an admin
 * can produce is broken. That is a claim about a space rather than about an
 * example, so it is checked as one: a ladder of book states from empty to
 * finished, crossed with every playlist reachable by reordering the components or
 * switching one off.
 *
 * Four properties carry most of the weight:
 *
 *   1. **The engine never asks for something it can't have.** Whatever the order,
 *      the component it picks is unsatisfied and all of its requirements are met.
 *   2. **The reader never goes backwards.** As a book advances along the ladder,
 *      the engine's position in the playlist never decreases. A conversational
 *      flow that re-asks a settled question is worse than no guide at all.
 *   3. **The engine agrees with the wizard.** Both flows ship and a book has to be
 *      portable between them, so the two are compared state by state and the
 *      differences have to be exactly the ones named in `EXPECTED_DIVERGENCE` —
 *      anything else is an accident nobody decided on.
 *   4. **A patch can't write what it shouldn't.** Artifact slots have no writer,
 *      unknown keys are reported rather than merged, and a value outside the
 *      caller's declared world is refused.
 *
 * Offline and deterministic: synthesized projects and pure functions. No network,
 * no emulator, no model call.
 */
import {
  GUIDE_CATALOG,
  GUIDE_COMPONENTS,
  GUIDE_COMPONENT_IDS,
  isComponentSatisfied,
  type GuideComponentId,
} from "../books-frontend/src/core/guide/components";
import {
  GUIDE_FACT_SLOT_IDS,
  GUIDE_SLOTS,
  GUIDE_SLOT_IDS,
  type GuideSlotId,
} from "../books-frontend/src/core/guide/slots";
import {
  createDefaultGuidePlaylist,
  lintGuidePlaylist,
  normalizeGuidePlaylist,
  resolveGuidePlaylist,
  type GuidePlaylist,
  type ResolvedGuideComponent,
} from "../books-frontend/src/core/guide/playlist";
import {
  guideOutline,
  guideProgress,
  nextGuideStep,
} from "../books-frontend/src/core/guide/engine";
import {
  applyGuidePatch,
  GUIDE_PATCHABLE_SLOT_IDS,
  type GuidePatchContext,
} from "../books-frontend/src/core/guide/patch";
import {
  createDefaultConfig,
  type Anchor,
  type AnchorImage,
  type Project,
  type ScreenplayDoc,
  type ScreenplaySpread,
  type StoryCastMember,
} from "../books-frontend/src/core/types";
import { createDefaultStoryBrief } from "../books-frontend/src/core/story/brief";
import { createVersionTree } from "../books-frontend/src/core/versioning";
import { AGE_RANGES, ART_STYLE_PRESETS } from "../books-frontend/src/core/config/options";
import { BOOK_PRODUCTS } from "../books-frontend/src/core/fulfillment";
import {
  defaultDestination,
  destinationUnlocked,
  type StudioDestination,
} from "../books-frontend/src/ui/studio/studioRoutes";

export interface CheckResult {
  failures: string[];
  notes: string[];
  report: string[];
  cases: number;
}

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function fail(message: string): void {
  failures.push(message);
}

// --- Synthesized books -----------------------------------------------------

function baseProject(): Project {
  return {
    id: "book-1",
    title: "A test book",
    createdAt: 0,
    updatedAt: 0,
    stage: "setup",
    furthestStage: "setup",
    config: createDefaultConfig(),
  };
}

function withConfig(project: Project, patch: Partial<Project["config"]>): Project {
  return { ...project, config: { ...project.config, ...patch } };
}

function cast(...members: StoryCastMember[]): StoryCastMember[] {
  return members;
}

function anchor(id: string, withImage: boolean): Anchor {
  const image: AnchorImage = { blobId: `blob-${id}`, mimeType: "image/png" };
  return {
    id,
    name: `Subject ${id}`,
    type: "character",
    description: "A description",
    importance: "high",
    mode: "creative",
    include: true,
    ...(withImage ? { versions: createVersionTree(image) } : {}),
  };
}

/**
 * A page plan where the first `done` spreads are finished. Completed as text
 * pages rather than illustrated ones: `unitIsDone` accepts either, and this way
 * the state doesn't depend on synthesizing render output.
 */
function pagePlan(done: number, total = 4) {
  const spreads: ScreenplaySpread[] = Array.from({ length: total }, (_, index) => ({
    id: `spread-${index}`,
    kind: "single",
    text: "Once upon a time.",
    illustration: "A picture.",
    layoutNote: "",
    anchorIds: [],
    ...(index < done ? { completion: "text" as const } : {}),
  }));
  const doc: ScreenplayDoc = { notes: "", spreads };
  return createVersionTree(doc);
}

/**
 * The life of a book, in the order it actually happens. Each rung applies to the
 * one before it, so the ladder is also the monotonicity claim: satisfaction is
 * only ever added.
 */
const LADDER: [name: string, mutate: (p: Project) => Project][] = [
  ["mode chosen", (p) => withConfig(p, { storyBrief: createDefaultStoryBrief("guided") })],
  [
    "hero named",
    (p) =>
      withConfig(p, {
        storyBrief: { ...createDefaultStoryBrief("guided"), cast: cast({ id: "c1", name: "Maya" }) },
      }),
  ],
  [
    "hero aged",
    (p) =>
      withConfig(p, {
        storyBrief: {
          ...createDefaultStoryBrief("guided"),
          cast: cast({ id: "c1", name: "Maya", age: 5 }),
        },
      }),
  ],
  ["story drafted", (p) => withConfig(p, { storyText: "Maya found a door in the garden wall." })],
  [
    "story approved",
    (p) => ({
      ...withConfig(p, { styleReady: false, castReady: false }),
      stage: "studio",
      furthestStage: "studio",
    }),
  ],
  ["style chosen", (p) => withConfig(p, { styleReady: true })],
  [
    "story analysed",
    (p) => ({
      ...p,
      analysis: { summary: "A girl and a door.", generatedAt: 1 },
      anchors: [anchor("a1", false), anchor("a2", false)],
    }),
  ],
  ["one sheet drawn", (p) => ({ ...p, anchors: [anchor("a1", true), anchor("a2", false)] })],
  ["all sheets drawn", (p) => ({ ...p, anchors: [anchor("a1", true), anchor("a2", true)] })],
  ["cast confirmed", (p) => withConfig(p, { castReady: true })],
  ["pages planned", (p) => ({ ...p, screenplay: pagePlan(0) })],
  ["some pages done", (p) => ({ ...p, screenplay: pagePlan(2) })],
  ["all pages done", (p) => ({ ...p, screenplay: pagePlan(4) })],
  ["pages opened", (p) => withConfig(p, { designReady: true })],
];

const ladder: { name: string; project: Project }[] = [];
{
  let current = baseProject();
  ladder.push({ name: "fresh book", project: current });
  for (const [name, mutate] of LADDER) {
    current = mutate(current);
    ladder.push({ name, project: current });
  }
}

const finished = ladder[ladder.length - 1]!.project;
const approved = ladder.find((rung) => rung.name === "story approved")!.project;

/**
 * Books that don't come up the ladder. Every one of these has caused a real bug
 * in a flow like this: a project made before a flag existed, a reader who typed
 * their own words, a story with nothing to draw.
 */
const variants: { name: string; project: Project }[] = [
  {
    // A book from before the guide existed: in the studio, with art, and no
    // record of the questions it was never asked.
    name: "legacy book, no brief",
    project: {
      ...withConfig(baseProject(), {
        storyText: "An old story.",
        storyBrief: undefined,
        styleReady: undefined,
        castReady: undefined,
      }),
      stage: "studio",
      furthestStage: "studio",
      analysis: { summary: "…", generatedAt: 1 },
      anchors: [anchor("a1", true)],
      screenplay: pagePlan(4),
    },
  },
  {
    name: "own words, still writing",
    project: withConfig(baseProject(), {
      storyBrief: createDefaultStoryBrief("own"),
    }),
  },
  {
    name: "own words, written",
    project: withConfig(baseProject(), {
      storyBrief: createDefaultStoryBrief("own"),
      storyText: "The story, in my own words.",
    }),
  },
  {
    name: "co-write without an occasion",
    project: withConfig(baseProject(), {
      storyBrief: {
        ...createDefaultStoryBrief("co-write"),
        cast: cast({ id: "c1", name: "Leo", age: 7 }),
      },
    }),
  },
  {
    name: "audience chosen outright",
    project: withConfig(baseProject(), {
      storyBrief: createDefaultStoryBrief("guided"),
      audienceFromCast: "custom",
      ageRangeId: "6-8",
    }),
  },
  {
    // Nothing recurs, so there is nothing to draw a reference for. The cast step
    // still has to be able to complete.
    name: "nothing to draw",
    project: {
      ...withConfig(approved, { styleReady: true, castReady: true }),
      analysis: { summary: "…", generatedAt: 1 },
      anchors: [],
    },
  },
  {
    name: "a page plan with no pages",
    project: { ...finished, screenplay: createVersionTree<ScreenplayDoc>({ notes: "", spreads: [] }) },
  },
];

const allStates = [...ladder, ...variants];

// --- Catalog ---------------------------------------------------------------

if (GUIDE_CATALOG.length !== GUIDE_COMPONENT_IDS.length) {
  fail("The catalog and its id list have drifted apart.");
}
GUIDE_CATALOG.forEach((component, index) => {
  if (component.id !== GUIDE_COMPONENT_IDS[index]) {
    fail(`Catalog position ${index} is "${component.id}" but the id list says "${GUIDE_COMPONENT_IDS[index]}".`);
  }
});

const catalogPosition = new Map(GUIDE_CATALOG.map((component, index) => [component.id, index]));
for (const component of GUIDE_CATALOG) {
  for (const required of component.requires) {
    if (!(required in GUIDE_COMPONENTS)) {
      fail(`"${component.id}" requires "${required}", which is not a component.`);
      continue;
    }
    // The shipped order has to be legal on its own, since it's the default
    // playlist and the one every deployment runs until an admin changes it.
    if ((catalogPosition.get(required) ?? 0) >= (catalogPosition.get(component.id) ?? 0)) {
      fail(`"${component.id}" ships before "${required}", which it requires.`);
    }
  }
  for (const slot of component.slots) {
    if (!(slot in GUIDE_SLOTS)) fail(`"${component.id}" names slot "${slot}", which doesn't exist.`);
  }
}

const terminals = GUIDE_CATALOG.filter((component) => component.terminal);
if (terminals.length !== 1) {
  fail(`There are ${terminals.length} terminal components; the flow needs exactly one end.`);
} else if (terminals[0]!.id !== GUIDE_CATALOG[GUIDE_CATALOG.length - 1]!.id) {
  fail(`The terminal component "${terminals[0]!.id}" is not last in the catalog.`);
}

// Every slot belongs to a component, or it's a fact nothing will ever ask about.
const claimed = new Set(GUIDE_CATALOG.flatMap((component) => component.slots));
for (const slot of GUIDE_SLOT_IDS) {
  if (!claimed.has(slot)) fail(`Slot "${slot}" is claimed by no component.`);
}

// The closed world, stated as an equality: a conversation can write every fact
// and nothing else. Written this way so adding an artifact slot with a writer, or
// a fact without one, both fail here.
const facts = [...GUIDE_FACT_SLOT_IDS].sort().join(",");
const patchable = [...GUIDE_PATCHABLE_SLOT_IDS].sort().join(",");
if (facts !== patchable) {
  fail(`Writable slots (${patchable}) are not exactly the fact slots (${facts}).`);
}

// A predicate that is always true, or always false, is not a predicate. `review`
// is the deliberate exception — placing an order isn't a fact about the book.
for (const component of GUIDE_CATALOG) {
  if (component.terminal) continue;
  const satisfiedIn = allStates.filter((state) => component.isSatisfied(state.project)).length;
  if (satisfiedIn === 0) fail(`"${component.id}" is satisfied by no state; it can never complete.`);
  if (satisfiedIn === allStates.length) {
    fail(`"${component.id}" is satisfied by every state; the guide would never raise it.`);
  }
}

// Blockers explain an unsatisfied component. When one IS satisfied there is
// nothing to explain, and a leftover blocker would be shown to a reader who has
// already dealt with it.
for (const state of allStates) {
  for (const component of GUIDE_CATALOG) {
    cases += 1;
    if (component.isSatisfied(state.project) && component.blockers(state.project).length > 0) {
      fail(`"${component.id}" is satisfied at "${state.name}" but still reports blockers.`);
    }
  }
}

// --- Playlists -------------------------------------------------------------

const defaultPlaylist = createDefaultGuidePlaylist();

if (JSON.stringify(normalizeGuidePlaylist(structuredClone(defaultPlaylist))) !== JSON.stringify(defaultPlaylist)) {
  fail("Round-tripping the default playlist changed it.");
}
if (lintGuidePlaylist(defaultPlaylist).length > 0) {
  fail(`The default playlist doesn't pass its own lint: ${lintGuidePlaylist(defaultPlaylist).join(" ")}`);
}
if (resolveGuidePlaylist(defaultPlaylist).length !== GUIDE_CATALOG.length) {
  fail("Resolving the default playlist dropped components.");
}

// Junk in, a runnable playlist out. The stored document is the live
// configuration, so refusing it would take the guide offline.
const junk: [label: string, input: unknown][] = [
  ["absent", undefined],
  ["null", null],
  ["empty", {}],
  ["a string", "playlist"],
  ["entries as a string", { version: 1, entries: "all" }],
  ["unknown ids", { version: 1, entries: [{ id: "make-it-good", enabled: true }] }],
  ["duplicate ids", { version: 1, entries: [
    { id: "story-cast", enabled: true },
    { id: "story-cast", enabled: false },
  ] }],
  ["entries missing enabled", { version: 1, entries: [{ id: "story-cast" }] }],
  ["a wrong-typed override", { version: 1, entries: [{ id: "story-cast", enabled: true, skippable: "yes" }] }],
];

for (const [label, input] of junk) {
  const normalized = normalizeGuidePlaylist(input);
  const ids = normalized.entries.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) fail(`Normalizing ${label} left duplicate entries.`);
  for (const id of GUIDE_COMPONENT_IDS) {
    if (!ids.includes(id)) fail(`Normalizing ${label} dropped "${id}" from the playlist.`);
  }
  for (const id of ids) {
    if (!(id in GUIDE_COMPONENTS)) fail(`Normalizing ${label} kept "${id}", which isn't a component.`);
  }
  assertOrderLegal(normalized, `normalized ${label}`);
}

/**
 * Every entry sits below everything it requires, and nothing sits below the end
 * of the flow — a component stored after the terminal one is unreachable, since
 * the engine stops there.
 */
function assertOrderLegal(playlist: GuidePlaylist, label: string): void {
  const position = new Map(playlist.entries.map((entry, index) => [entry.id, index]));
  for (const entry of playlist.entries) {
    for (const required of GUIDE_COMPONENTS[entry.id].requires) {
      const at = position.get(required);
      if (at !== undefined && at > (position.get(entry.id) ?? 0)) {
        fail(`In ${label}, "${entry.id}" comes before "${required}", which it requires.`);
      }
    }
    if (GUIDE_COMPONENTS[entry.id].terminal && position.get(entry.id) !== playlist.entries.length - 1) {
      fail(`In ${label}, "${entry.id}" ends the flow but isn't last, so entries after it are dead.`);
    }
  }
}

// Lint has to actually catch the things normalization would otherwise quietly
// repair, because the admin editor shows these before saving.
{
  const reversed: GuidePlaylist = {
    version: 1,
    entries: [...defaultPlaylist.entries].reverse(),
  };
  if (lintGuidePlaylist(reversed).length === 0) {
    fail("Lint accepted a fully reversed playlist.");
  }
  const requirementOff: GuidePlaylist = {
    version: 1,
    entries: defaultPlaylist.entries.map((entry) =>
      entry.id === "story-draft" ? { ...entry, enabled: false } : entry,
    ),
  };
  if (!lintGuidePlaylist(requirementOff).some((problem) => problem.includes("is off"))) {
    fail("Lint accepted a component whose requirement is switched off.");
  }
  const allOff: GuidePlaylist = {
    version: 1,
    entries: defaultPlaylist.entries.map((entry) => ({ ...entry, enabled: false })),
  };
  if (lintGuidePlaylist(allOff).length === 0) fail("Lint accepted a playlist with nothing enabled.");
}

// Overrides are the admin's to make, and have to survive resolution.
{
  const overridden: GuidePlaylist = {
    version: 1,
    entries: defaultPlaylist.entries.map((entry) =>
      entry.id === "story-idea"
        ? { ...entry, skippable: false, title: "What it's about" }
        : entry,
    ),
  };
  const resolved = resolveGuidePlaylist(overridden).find((c) => c.id === "story-idea")!;
  if (resolved.title !== "What it's about") fail("A playlist title override was lost on resolve.");
  if (resolved.skippable !== false) fail("A playlist skippable override was lost on resolve.");
  if (!resolved.skippableOverridden) fail("An overridden component didn't report the override.");
}

// --- The playlist space ----------------------------------------------------

/**
 * Playlists an admin can actually produce: the shipped order, every single-move
 * reorder, and every playlist with one optional component switched off. Moves
 * rather than full permutations — reordering in the editor is a drag, so a
 * one-component move is the real unit of change, and 12! orders are not.
 */
function playlistSpace(): { label: string; playlist: GuidePlaylist }[] {
  const out: { label: string; playlist: GuidePlaylist }[] = [
    { label: "shipped", playlist: defaultPlaylist },
    { label: "reversed", playlist: normalizeGuidePlaylist({ version: 1, entries: [...defaultPlaylist.entries].reverse() }) },
  ];
  const entries = defaultPlaylist.entries;
  for (let from = 0; from < entries.length; from += 1) {
    for (let to = 0; to < entries.length; to += 1) {
      if (from === to) continue;
      const moved = [...entries];
      const [item] = moved.splice(from, 1);
      moved.splice(to, 0, item!);
      out.push({
        label: `move ${item!.id} ${from}→${to}`,
        playlist: normalizeGuidePlaylist({ version: 1, entries: moved }),
      });
    }
  }
  for (const entry of entries) {
    if (!GUIDE_COMPONENTS[entry.id].skippable) continue;
    out.push({
      label: `without ${entry.id}`,
      playlist: normalizeGuidePlaylist({
        version: 1,
        entries: entries.map((e) => (e.id === entry.id ? { ...e, enabled: false } : e)),
      }),
    });
  }
  return out;
}

const space = playlistSpace();
for (const { label, playlist } of space) assertOrderLegal(playlist, label);

// Deterministic shuffles, to say something about orders the editor can't produce
// but a hand-edited document could.
{
  let seed = 20260914;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let round = 0; round < 500; round += 1) {
    const shuffled = [...defaultPlaylist.entries];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const normalized = normalizeGuidePlaylist({ version: 1, entries: shuffled });
    assertOrderLegal(normalized, `shuffle ${round}`);
    if (normalized.entries.length !== defaultPlaylist.entries.length) {
      fail(`Shuffle ${round} changed the number of entries.`);
    }
  }
}

// --- The engine, over every playlist and every state -----------------------

const SKIP_SETS: GuideComponentId[][] = [
  [],
  ["story-idea"],
  ["audience"],
  ["story-idea", "audience"],
  // Required components in the skip set must be ignored: declining is the
  // reader's right only where the playlist grants it.
  ["story-cast", "story-draft"],
  ["review"],
  // Everything at once, which is the state a reader who dismisses every prompt
  // ends up in. The book still has to be finishable.
  [...GUIDE_COMPONENT_IDS],
];

/** Required components a skip request was correctly ignored for. */
const ignoredSkips = new Set<GuideComponentId>();

for (const { label, playlist } of space) {
  const resolved = resolveGuidePlaylist(playlist);

  for (const skipped of SKIP_SETS) {
    for (const state of allStates) {
      cases += 1;
      const cursor = nextGuideStep(resolved, state.project, skipped);
      const where = `${label} / ${state.name} / skipped=[${skipped.join(",")}]`;

      if (cursor.status === "done") {
        if (cursor.component !== null) fail(`A finished cursor still named a component (${where}).`);
        for (const component of resolved) {
          const declined = component.skippable && skipped.includes(component.id);
          if (!isComponentSatisfied(component.id, state.project) && !declined) {
            fail(`The cursor said "done" while "${component.id}" is unsatisfied (${where}).`);
          }
        }
        continue;
      }

      const component = cursor.component;
      if (!component) {
        fail(`A "${cursor.status}" cursor named no component (${where}).`);
        continue;
      }
      // The two properties that make the flow safe under any order.
      if (isComponentSatisfied(component.id, state.project)) {
        fail(`The guide would raise "${component.id}", which is already satisfied (${where}).`);
      }
      if (component.skippable && skipped.includes(component.id)) {
        fail(`The guide would raise "${component.id}" after the reader declined it (${where}).`);
      }
      if (!component.skippable && skipped.includes(component.id)) {
        // Correct: a required component cannot be declined, so raising it anyway
        // is the intended behaviour. Recorded rather than asserted away.
        ignoredSkips.add(component.id);
      }

      if (cursor.status === "ask") {
        for (const required of component.requires) {
          if (!isComponentSatisfied(required, state.project)) {
            fail(`"${component.id}" was asked while "${required}" is unmet (${where}).`);
          }
        }
      } else {
        const blocker = cursor.blockedBy;
        if (!blocker) fail(`A blocked cursor didn't say what blocked it (${where}).`);
        else if (isComponentSatisfied(blocker, state.project)) {
          fail(`"${component.id}" claimed to be blocked by satisfied "${blocker}" (${where}).`);
        }
      }

      // Same book, same answer — twice in a row and via the outline.
      const again = nextGuideStep(resolved, state.project, skipped);
      if (again.component?.id !== component.id || again.status !== cursor.status) {
        fail(`The cursor isn't deterministic (${where}).`);
      }
      const outline = guideOutline(resolved, state.project, skipped);
      const active = outline.filter((row) => row.state === "active");
      if (active.length !== 1 || active[0]!.component.id !== component.id) {
        fail(`The outline marked ${active.length} components active, not the cursor's (${where}).`);
      }

      const progress = guideProgress(resolved, state.project, skipped);
      if (progress.ratio < 0 || progress.ratio > 1) {
        fail(`Progress ratio ${progress.ratio} is outside 0–1 (${where}).`);
      }
      if (progress.satisfied + progress.skipped > progress.total) {
        fail(`Progress counts more components than it has (${where}).`);
      }
    }
  }
}

if (ignoredSkips.size === 0) {
  fail("No required component was ever asked to be skipped; that guarantee is untested.");
} else {
  notes.push(`required components that correctly refused a skip: ${[...ignoredSkips].join(", ")}`);
}

// The reader never goes backwards: as the book advances, the engine's position in
// the playlist only ever moves forward.
for (const { label, playlist } of space) {
  const resolved = resolveGuidePlaylist(playlist);
  const position = new Map(resolved.map((component, index) => [component.id, index]));
  let previous = -1;
  let previousName = "";
  for (const rung of ladder) {
    const cursor = nextGuideStep(resolved, rung.project);
    const at = cursor.component ? position.get(cursor.component.id) ?? -1 : resolved.length;
    if (at < previous) {
      fail(
        `Advancing from "${previousName}" to "${rung.name}" moved the guide backwards (${label}): ` +
          `position ${previous} → ${at}.`,
      );
    }
    previous = at;
    previousName = rung.name;
  }
}

// Progress only ever grows along the ladder, for the same reason a progress bar
// that goes down is worse than none.
{
  const resolved = resolveGuidePlaylist(defaultPlaylist);
  let previous = -1;
  for (const rung of ladder) {
    const { satisfied } = guideProgress(resolved, rung.project);
    if (satisfied < previous) {
      fail(`Progress fell at "${rung.name}": ${previous} → ${satisfied} satisfied components.`);
    }
    previous = satisfied;
  }
  const complete = guideProgress(resolved, finished);
  if (complete.satisfied !== complete.total) {
    const missing = resolved
      .filter((c) => !c.terminal && !isComponentSatisfied(c.id, finished))
      .map((c) => c.id);
    fail(`A finished book isn't fully satisfied; missing: ${missing.join(", ") || "nothing"}.`);
  }
}

// --- Engine versus wizard --------------------------------------------------

/**
 * Where the two flows deliberately disagree. Landing a finished book on Review
 * rather than on the pages is the one intended difference: "what's next" for a
 * complete book is ordering it, and the guide says so. Everything else must match,
 * because a book has to be portable between the flows.
 */
const EXPECTED_DIVERGENCE: Record<string, [legacy: StudioDestination, guide: StudioDestination]> = {
  "pages opened": ["pages", "order"],
};

const enginePlaylist: readonly ResolvedGuideComponent[] = resolveGuidePlaylist(defaultPlaylist);
const divergences: string[] = [];

for (const state of allStates) {
  cases += 1;
  const legacy = defaultDestination(state.project);
  const guided = defaultDestination(state.project, enginePlaylist);

  // Whatever either flow answers, the reader must have unlocked it — this is the
  // property that lets the engine drive the wizard's routing at all.
  if (!destinationUnlocked(state.project, guided)) {
    fail(`The guide would land "${state.name}" on "${guided}", which isn't unlocked.`);
  }

  if (legacy === guided) continue;
  divergences.push(`${state.name}: wizard → ${legacy}, guide → ${guided}`);
  const expected = EXPECTED_DIVERGENCE[state.name];
  if (!expected) {
    fail(`Undocumented divergence at "${state.name}": wizard → ${legacy}, guide → ${guided}.`);
  } else if (expected[0] !== legacy || expected[1] !== guided) {
    fail(
      `"${state.name}" was expected to differ as ${expected[0]}/${expected[1]} ` +
        `but differs as ${legacy}/${guided}.`,
    );
  }
}

for (const name of Object.keys(EXPECTED_DIVERGENCE)) {
  if (!divergences.some((line) => line.startsWith(`${name}:`))) {
    fail(`"${name}" is listed as a divergence but the two flows now agree — remove the entry.`);
  }
}

// --- The closed-world patch ------------------------------------------------

const patchContext: GuidePatchContext = {
  ageBandIds: AGE_RANGES.map((range) => range.id),
  artStylePresetIds: ART_STYLE_PRESETS.map((preset) => preset.id),
  productSkus: BOOK_PRODUCTS.map((product) => product.sku),
};

const fresh = baseProject();

// Artifact slots have no writer at all, and saying so is the whole safety claim.
for (const slot of GUIDE_SLOT_IDS) {
  if (GUIDE_SLOTS[slot].kind !== "artifact") continue;
  const result = applyGuidePatch(fresh, { [slot]: "anything" }, patchContext);
  cases += 1;
  if (result.applied.length > 0) fail(`A patch wrote artifact slot "${slot}".`);
  if (!result.rejected.some((rejection) => rejection.key === slot)) {
    fail(`A patch to artifact slot "${slot}" was ignored silently instead of reported.`);
  }
  if (result.project !== fresh) fail(`A patch to "${slot}" returned a changed project.`);
}

// Keys that aren't slots. Prototype pollution and privileged-looking names are in
// here because those are what an interpreter's output would have to contain for
// this to matter.
for (const key of ["isAdmin", "price", "__proto__", "constructor", "rev", "stage", "id", ""]) {
  const result = applyGuidePatch(fresh, { [key]: "x" }, patchContext);
  cases += 1;
  if (result.applied.length > 0) fail(`A patch wrote unknown key "${key}".`);
  if (JSON.stringify(result.project) !== JSON.stringify(fresh)) {
    fail(`A patch with unknown key "${key}" changed the book.`);
  }
}

// Non-objects must be refused whole, not partially applied.
for (const input of [null, undefined, 42, "heroes", [], true]) {
  const result = applyGuidePatch(fresh, input, patchContext);
  cases += 1;
  if (result.applied.length > 0 || result.project !== fresh) {
    fail(`A patch of ${JSON.stringify(input) ?? "undefined"} was applied.`);
  }
}

// Values outside the declared world are refused, however well-formed.
{
  const outside: [GuideSlotId, unknown][] = [
    ["audience", { ageRangeId: "40-50" }],
    ["audience", { ageRangeId: AGE_RANGES[0]!.id, readingModeId: "telepathy" }],
    ["artStyle", { presetId: "photorealistic-nightmare" }],
    ["trim", "NOT-A-SKU"],
    ["layout", "no-such-layout"],
    ["language", "kl-KL"],
    ["heroes", []],
    ["heroes", [""]],
    ["heroAges", [{ name: "Maya" }]],
    ["storyMode", "dictate"],
  ];
  for (const [slot, value] of outside) {
    const result = applyGuidePatch(fresh, { [slot]: value }, patchContext);
    cases += 1;
    if (result.applied.length > 0) {
      fail(`A patch set "${slot}" to ${JSON.stringify(value)}, which is outside the declared world.`);
    }
  }
}

// The happy path, including the ordering guarantee: names have to land before the
// ages that refer to them, whatever order the input lists them in.
{
  const result = applyGuidePatch(
    fresh,
    {
      heroAges: [{ name: "Maya", age: 5 }, { name: "Leo", ageMonths: 30 }],
      heroes: ["Maya", "Leo"],
      storyMode: "guided",
    },
    patchContext,
  );
  cases += 1;
  const members = result.project.config.storyBrief?.cast ?? [];
  if (members.length !== 2) fail(`Patching two heroes produced ${members.length} cast members.`);
  if (members[0]?.age !== 5) fail("An age given in the same turn as the name wasn't applied.");
  if (members[1]?.ageMonths !== 30) fail("An age in months given with the name wasn't applied.");
  if (!isComponentSatisfied("story-cast", result.project)) {
    fail("A patch naming and ageing the cast didn't satisfy the cast component.");
  }
}

// Re-stating the cast keeps what was already known about the people who stay.
{
  const named = applyGuidePatch(fresh, { heroes: ["Maya", "Leo"] }, patchContext).project;
  const aged = applyGuidePatch(named, { heroAges: [{ name: "maya", age: 5 }] }, patchContext).project;
  const restated = applyGuidePatch(aged, { heroes: ["Maya", "Ada"] }, patchContext).project;
  const members = restated.config.storyBrief?.cast ?? [];
  cases += 1;
  if (members.length !== 2) fail(`Re-stating the cast produced ${members.length} members.`);
  if (members[0]?.age !== 5) fail("Re-stating the cast lost an age already given.");
  if (members[1]?.name !== "Ada") fail("Re-stating the cast didn't add the new name.");
  // And an age for someone who isn't there does nothing.
  const ghost = applyGuidePatch(restated, { heroAges: [{ name: "Sam", age: 9 }] }, patchContext);
  if (ghost.applied.length > 0) fail("An age for a name not in the cast was applied.");
}

// A no-op write is not an edit. Undo history and staleness both key off changes,
// so reporting one that didn't happen is a real cost.
{
  const result = applyGuidePatch(fresh, { storyText: fresh.config.storyText }, patchContext);
  cases += 1;
  if (result.applied.length > 0) fail("Writing an unchanged value was reported as applied.");
}

// A mixed turn applies the usable half and reports the rest, so the guide can ask
// about what it couldn't take.
{
  const result = applyGuidePatch(
    fresh,
    { heroes: ["Maya"], nonsense: true, trim: "NOT-A-SKU" },
    patchContext,
  );
  cases += 1;
  if (!result.applied.includes("heroes")) fail("A mixed patch dropped its valid half.");
  if (!result.rejected.some((rejection) => rejection.key === "nonsense")) {
    fail("A mixed patch didn't report its unknown key.");
  }
}

// Nothing is mutated in place: the caller's project has to stay usable, because
// the store still owns saving and undo.
{
  const before = JSON.stringify(fresh);
  applyGuidePatch(fresh, { heroes: ["Maya"], storyText: "Once." }, patchContext);
  if (JSON.stringify(fresh) !== before) fail("applyGuidePatch mutated the project it was given.");
}

// --- Report ---------------------------------------------------------------

report.push("Guide catalog");
for (const component of GUIDE_CATALOG) {
  const satisfiedIn = ladder.filter((rung) => component.isSatisfied(rung.project)).length;
  report.push(
    `  ${component.id.padEnd(14)} ${component.legacyDestination.padEnd(6)} ` +
      `${component.skippable ? "optional" : "required"}  ` +
      `satisfied by ${satisfiedIn}/${ladder.length} rungs` +
      (component.effect ? `  ⟶ ${component.effect}` : ""),
  );
}

report.push("\nWhat the guide asks, as a book is made");
{
  const resolved = resolveGuidePlaylist(defaultPlaylist);
  for (const rung of ladder) {
    const cursor = nextGuideStep(resolved, rung.project);
    const legacy = defaultDestination(rung.project);
    const guided = defaultDestination(rung.project, resolved);
    report.push(
      `  ${rung.name.padEnd(17)} → ${(cursor.component?.id ?? "nothing left").padEnd(14)} ` +
        `wizard:${legacy.padEnd(6)} guide:${guided}${legacy === guided ? "" : "   ← differs"}`,
    );
  }
}

if (divergences.length > 0) {
  report.push("\nDeliberate differences from the wizard");
  for (const line of divergences) report.push(`  · ${line}`);
}

notes.push(
  `${space.length} playlists × ${allStates.length} book states × ${SKIP_SETS.length} skip sets`,
);

export function checkGuideEngine(): CheckResult {
  return { failures, notes, report, cases };
}
