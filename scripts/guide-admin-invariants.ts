/**
 * Invariants for the admin surface: the playlist editor and the write path.
 *
 * Phase 7 hands an admin the ability to reorder the guide's questions, retitle
 * them, make them optional and switch them off — from a dashboard, with no
 * deploy. The thing worth proving is therefore not that the editor works but that
 * it CANNOT produce a configuration the guide breaks on. There is no review step
 * between the save button and every reader's next page load.
 *
 * Three claims, each of which fails silently rather than loudly if it is wrong.
 *
 * **1. No edit produces an unrunnable flow.** Every reordering, every subset of
 * components switched off, against every synthesized book: the engine has to
 * return a cursor, terminate, and never sit on a component whose requirements are
 * unmet while a legal order exists. `normalizeGuidePlaylist` is what makes this
 * true — it repairs an order rather than trusting it — so this is really a test
 * that the repair covers what the editor can express.
 *
 * **2. The document survives the round trip the tab and the server actually
 * perform.** The tab drafts, `guideConfigSchema` parses on the server,
 * `normalizeGuideConfig` re-anchors, Firestore stores JSON, the client normalizes
 * the snapshot. An override that is dropped anywhere along that chain is a setting
 * that appears to save and then isn't there — including the one shape that is easy
 * to get wrong: an absent `skippable`, which means "inherit from the catalog" and
 * must stay absent rather than being frozen at today's value.
 *
 * **3. The write path is actually gated.** `permissionGate` matches a request
 * against `ROUTE_RULES` and 403s anything unmatched, so a new route without a rule
 * is dead rather than open — safe, but it fails as a permissions error nobody can
 * grant their way out of. Checked statically, over every admin config route, so
 * the next one added is covered too.
 *
 * Offline and deterministic: pure functions and file reads.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createDefaultGuideConfig,
  guideConfigSchema,
  normalizeGuideConfig,
  type GuideConfig,
} from "../books-frontend/src/core/config/guide";
import {
  createDefaultGuidePlaylist,
  lintGuidePlaylist,
  normalizeGuidePlaylist,
  resolveGuidePlaylist,
  type GuidePlaylist,
  type GuidePlaylistEntry,
} from "../books-frontend/src/core/guide/playlist";
import {
  GUIDE_CATALOG,
  GUIDE_COMPONENTS,
  type GuideComponentId,
} from "../books-frontend/src/core/guide/components";
import { nextGuideStep } from "../books-frontend/src/core/guide/engine";
import { ALL_PERMISSION_KEYS } from "../books-frontend/src/core/config/permissions";
import { GUIDE_BOOK_STATES } from "./guide-engine-invariants";

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

/** The repo root, found by walking up. Mirrors `guide-invariants.ts`. */
const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "childbooks") return dir;
    } catch {
      // Not this one — keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the repository root — run this from inside the repo.");
})();

const ALL_IDS = GUIDE_CATALOG.map((component) => component.id);

function playlistOf(entries: GuidePlaylistEntry[]): GuidePlaylist {
  return { version: 1, entries };
}

/** Whatever a JSON round trip through Firestore would leave behind. */
function throughStorage<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * The full trip a saved document makes: the tab's draft, the server's parse and
 * re-anchor, Firestore, and the client normalizing the snapshot it gets back.
 */
function saveAndReload(draft: GuideConfig): GuideConfig {
  const parsed = guideConfigSchema.parse(throughStorage(draft));
  const stored = normalizeGuideConfig({ ...parsed, updatedAt: 1 });
  return normalizeGuideConfig(throughStorage(stored));
}

// --- The editor covers the catalog, exactly --------------------------------

/**
 * The tab renders one row per entry, so a component missing from the normalized
 * playlist is a component no admin can reach, and a duplicate is two rows that
 * fight over one setting.
 */
{
  cases += 1;
  const normalized = normalizeGuidePlaylist(createDefaultGuidePlaylist());
  const ids = normalized.entries.map((entry) => entry.id);
  for (const id of ALL_IDS) {
    if (!ids.includes(id)) fail(`"${id}" is in the catalog but has no row in the playlist editor.`);
  }
  for (const id of ids) {
    if (ids.filter((other) => other === id).length > 1) {
      fail(`"${id}" appears twice in the playlist, so its settings have two owners.`);
    }
    if (!ALL_IDS.includes(id)) fail(`The playlist offers "${id}", which is not in the catalog.`);
  }
  if (normalized.entries.some((entry) => !entry.enabled)) {
    fail("The shipped playlist has a component switched off; everything ships enabled.");
  }
}

// --- Normalization is idempotent -------------------------------------------

/**
 * The tab lints the normalized draft and the server normalizes again on save. If
 * the second pass moved anything, the warnings an admin saw would describe an
 * order that isn't the one stored — and "save twice to settle" is a bug nobody
 * reports because it looks like they mis-clicked.
 */
function checkIdempotent(label: string, playlist: GuidePlaylist): void {
  cases += 1;
  const once = normalizeGuidePlaylist(playlist);
  const twice = normalizeGuidePlaylist(once);
  if (JSON.stringify(once) !== JSON.stringify(twice)) {
    fail(
      `Normalizing ${label} twice differs from once: ${once.entries
        .map((e) => e.id)
        .join(" → ")} became ${twice.entries.map((e) => e.id).join(" → ")}.`,
    );
  }
}

// --- Every edit the tab can express ---------------------------------------

/**
 * The editor's whole vocabulary: reorder (arrows), enable/disable (toggle),
 * retitle, and the three-state skippability. Enumerating reversals, rotations and
 * adjacent swaps rather than all 11! orders — the failures live at the boundaries
 * (a dependent moved above its requirement, a terminal moved off the end), and a
 * reversal puts every single dependency the wrong way round at once.
 */
const ORDERS: { label: string; ids: GuideComponentId[] }[] = [
  { label: "the shipped order", ids: [...ALL_IDS] },
  { label: "reversed", ids: [...ALL_IDS].reverse() },
];
for (let i = 0; i < ALL_IDS.length - 1; i += 1) {
  const ids = [...ALL_IDS];
  [ids[i], ids[i + 1]] = [ids[i + 1]!, ids[i]!];
  ORDERS.push({ label: `${ALL_IDS[i]} swapped with ${ALL_IDS[i + 1]}`, ids });
}
for (let rotate = 1; rotate < ALL_IDS.length; rotate += 1) {
  ORDERS.push({
    label: `rotated by ${rotate}`,
    ids: [...ALL_IDS.slice(rotate), ...ALL_IDS.slice(0, rotate)],
  });
}
// The terminal component dragged to the front — the one order that would make
// every other question unreachable if it were honoured.
ORDERS.push({
  label: "the closing step moved first",
  ids: [
    ...ALL_IDS.filter((id) => GUIDE_COMPONENTS[id].terminal),
    ...ALL_IDS.filter((id) => !GUIDE_COMPONENTS[id].terminal),
  ],
});

/** Each component switched off on its own, plus none and all. */
const DISABLED: { label: string; off: GuideComponentId[] }[] = [
  { label: "nothing off", off: [] },
  { label: "everything off", off: [...ALL_IDS] },
  ...ALL_IDS.map((id) => ({ label: `${id} off`, off: [id] })),
];

let ordersWalked = 0;
const statusesSeen = new Set<string>();

for (const order of ORDERS) {
  for (const disabled of DISABLED) {
    const entries: GuidePlaylistEntry[] = order.ids.map((id) => ({
      id,
      enabled: !disabled.off.includes(id),
    }));
    const label = `${order.label} with ${disabled.label}`;
    const playlist = playlistOf(entries);

    checkIdempotent(label, playlist);

    const normalized = normalizeGuidePlaylist(playlist);

    // An edit may reorder and may remove, but it may never invent or lose a row.
    cases += 1;
    if (normalized.entries.length !== ALL_IDS.length) {
      fail(`Normalizing ${label} left ${normalized.entries.length} of ${ALL_IDS.length} entries.`);
    }
    // Whatever the admin asked for, the stored order has to be legal: nothing
    // above something it requires.
    cases += 1;
    const position = new Map(normalized.entries.map((entry, index) => [entry.id, index]));
    for (const entry of normalized.entries) {
      for (const required of GUIDE_COMPONENTS[entry.id].requires) {
        if ((position.get(required) ?? -1) > (position.get(entry.id) ?? 0)) {
          fail(
            `After normalizing ${label}, "${entry.id}" is still asked before "${required}", ` +
              `which it needs.`,
          );
        }
      }
    }
    // A terminal component anywhere but last leaves questions after the end of
    // the flow, which the engine will never reach.
    cases += 1;
    for (const entry of normalized.entries) {
      if (GUIDE_COMPONENTS[entry.id].terminal && position.get(entry.id) !== normalized.entries.length - 1) {
        fail(`After normalizing ${label}, the closing step "${entry.id}" is not last.`);
      }
    }

    const resolved = resolveGuidePlaylist(normalized);
    cases += 1;
    if (resolved.length !== ALL_IDS.length - disabled.off.length) {
      fail(
        `Resolving ${label} produced ${resolved.length} live components; ` +
          `${ALL_IDS.length - disabled.off.length} were enabled.`,
      );
    }

    // And the point of all of it: the engine copes. Walked against every book
    // state, because an order is only wrong in combination with a book that has
    // reached a particular point.
    for (const { name, project } of GUIDE_BOOK_STATES) {
      cases += 1;
      ordersWalked += 1;
      let cursor;
      try {
        cursor = nextGuideStep(resolved, project);
      } catch (err) {
        fail(
          `The engine threw on a "${name}" book with ${label}: ` +
            `${err instanceof Error ? err.message : String(err)}.`,
        );
        continue;
      }
      statusesSeen.add(cursor.status);
      if (cursor.status === "ask" && cursor.component === null) {
        fail(`With ${label}, a "${name}" book was asked about nothing.`);
      }
      if (cursor.component && !ALL_IDS.includes(cursor.component.id)) {
        fail(`With ${label}, a "${name}" book landed on "${cursor.component.id}".`);
      }
      // Skipping every component in turn must also terminate, since a reader can
      // decline anything the playlist marks optional.
      cases += 1;
      const skippable = resolved.filter((component) => component.skippable).map((c) => c.id);
      const afterSkips = nextGuideStep(resolved, project, skippable);
      if (afterSkips.status === "ask" && afterSkips.component === null) {
        fail(`With ${label}, declining every optional question on a "${name}" book asked nothing.`);
      }
    }
  }
}

// A playlist with everything off must be reported as such rather than silently
// producing a guide with no questions.
{
  cases += 1;
  const allOff = normalizeGuidePlaylist(
    playlistOf(ALL_IDS.map((id) => ({ id, enabled: false }))),
  );
  if (resolveGuidePlaylist(allOff).length !== 0) {
    fail("A playlist with everything off still resolved to live components.");
  }
  if (lintGuidePlaylist(allOff).length === 0) {
    fail("Switching off every component produced no warning for the admin.");
  }
}

// Turning off a component another one needs is the mistake normalization cannot
// fix — it has to be reported, not repaired into silence.
{
  const dependents = ALL_IDS.filter((id) => GUIDE_COMPONENTS[id].requires.length > 0);
  for (const id of dependents) {
    const required = GUIDE_COMPONENTS[id].requires[0]!;
    cases += 1;
    const playlist = normalizeGuidePlaylist(
      playlistOf(ALL_IDS.map((each) => ({ id: each, enabled: each !== required }))),
    );
    const problems = lintGuidePlaylist(playlist);
    if (!problems.some((problem) => problem.includes(GUIDE_COMPONENTS[required].title))) {
      fail(
        `Switching off "${required}" while "${id}" needs it produced no warning naming it: ` +
          `${problems.join(" / ") || "(none)"}.`,
      );
    }
  }
  if (dependents.length === 0) notes.push("no component has requirements — dependency lint unexercised");
}

// --- Overrides survive, and "inherit" stays inherited ---------------------

/**
 * The three-state skippability is the one shape a plausible implementation gets
 * wrong. Absent means "ask the catalog", so it has to stay absent through the
 * save: writing today's catalog answer into the document instead would freeze it,
 * and a later change in code would be silently ignored for every deployment that
 * had ever opened this tab.
 */
for (const component of GUIDE_CATALOG) {
  const base = createDefaultGuideConfig();

  // Inherit: no key at all.
  cases += 1;
  const inherited = saveAndReload(base);
  const inheritedEntry = inherited.playlist.entries.find((e) => e.id === component.id)!;
  if ("skippable" in inheritedEntry) {
    fail(
      `Saving without an override wrote skippable=${String(inheritedEntry.skippable)} for ` +
        `"${component.id}". Absent means "whatever the catalog says" and must stay absent.`,
    );
  }
  if (resolveGuidePlaylist(inherited.playlist).find((c) => c.id === component.id)!.skippable !== component.skippable) {
    fail(`"${component.id}" with no override did not inherit the catalog's skippability.`);
  }

  // Both explicit values, including the one that equals the catalog's — an
  // override that happens to agree today still has to be stored, or it silently
  // becomes an inherit.
  for (const skippable of [true, false]) {
    cases += 1;
    const draft: GuideConfig = {
      ...base,
      playlist: {
        version: 1,
        entries: base.playlist.entries.map((entry) =>
          entry.id === component.id ? { ...entry, skippable } : entry,
        ),
      },
    };
    const back = saveAndReload(draft);
    const entry = back.playlist.entries.find((e) => e.id === component.id)!;
    if (entry.skippable !== skippable) {
      fail(
        `An override of skippable=${skippable} on "${component.id}" came back as ` +
          `${JSON.stringify(entry.skippable)}.`,
      );
    }
    const live = resolveGuidePlaylist(back.playlist).find((c) => c.id === component.id)!;
    if (live.skippable !== skippable) {
      fail(`"${component.id}" resolved to skippable=${live.skippable} despite the override.`);
    }
  }

  // A retitle has to reach the reader, and an empty one has to clear rather than
  // store a blank heading.
  cases += 1;
  const renamed = saveAndReload({
    ...base,
    playlist: {
      version: 1,
      entries: base.playlist.entries.map((entry) =>
        entry.id === component.id ? { ...entry, title: "Renamed by an admin" } : entry,
      ),
    },
  });
  if (renamed.playlist.entries.find((e) => e.id === component.id)!.title !== "Renamed by an admin") {
    fail(`A retitle of "${component.id}" did not survive the save.`);
  }
  if (resolveGuidePlaylist(renamed.playlist).find((c) => c.id === component.id)!.title !== "Renamed by an admin") {
    fail(`A retitled "${component.id}" still resolved to the catalog's title.`);
  }

  cases += 1;
  const blank = saveAndReload({
    ...base,
    playlist: {
      version: 1,
      entries: base.playlist.entries.map((entry) =>
        entry.id === component.id ? { ...entry, title: "   " } : entry,
      ),
    },
  });
  const blankEntry = blank.playlist.entries.find((e) => e.id === component.id)!;
  if (blankEntry.title !== undefined) {
    fail(`A blank title on "${component.id}" was stored as ${JSON.stringify(blankEntry.title)}.`);
  }
  if (resolveGuidePlaylist(blank.playlist).find((c) => c.id === component.id)!.title !== component.title) {
    fail(`"${component.id}" with a blank override lost the catalog's title.`);
  }
}

// An order an admin sets has to be the order that comes back, not merely a legal
// one — otherwise the arrows in the tab appear to do nothing.
//
// Only swaps that are legal in BOTH directions can be asserted to persist: the
// repair pass is entitled to undo a swap that puts a component above something it
// needs, and that is the behaviour checked above. So the pairs are filtered by the
// transitive requirement closure rather than by direct requirements — `page-art`
// does not list `story-mode`, but it reaches it through the chain, and swapping
// those two SHOULD be undone.
{
  const requiredBy = (id: GuideComponentId): Set<GuideComponentId> => {
    const out = new Set<GuideComponentId>();
    const walk = (current: GuideComponentId) => {
      for (const required of GUIDE_COMPONENTS[current].requires) {
        if (out.has(required)) continue;
        out.add(required);
        walk(required);
      }
    };
    walk(id);
    return out;
  };

  let swapsChecked = 0;
  for (let i = 0; i < ALL_IDS.length - 1; i += 1) {
    const first = ALL_IDS[i]!;
    const second = ALL_IDS[i + 1]!;
    if (GUIDE_COMPONENTS[first].terminal || GUIDE_COMPONENTS[second].terminal) continue;
    if (requiredBy(second).has(first) || requiredBy(first).has(second)) continue;

    cases += 1;
    swapsChecked += 1;
    const base = createDefaultGuideConfig();
    const entries = base.playlist.entries.map((entry) => ({ ...entry }));
    [entries[i], entries[i + 1]] = [entries[i + 1]!, entries[i]!];

    const back = saveAndReload({ ...base, playlist: { version: 1, entries } });
    const ids = back.playlist.entries.map((entry) => entry.id);
    if (ids.indexOf(second) > ids.indexOf(first)) {
      fail(
        `Moving "${second}" above "${first}" — legal in both directions — was undone by the save, ` +
          `so the reorder arrows would appear not to work.`,
      );
    }
  }

  if (swapsChecked === 0) {
    fail(
      "No two adjacent components can legally swap, so nothing proves a reorder persists. The " +
        "catalog is now a single rigid chain and the editor's arrows are decoration.",
    );
  } else {
    notes.push(`${swapsChecked} legal adjacent swaps persisted through a save`);
  }
}

// --- The rollout survives the same trip -----------------------------------

for (const mode of ["off", "adminOnly", "percentage", "on"] as const) {
  for (const percent of [0, 1, 50, 100]) {
    cases += 1;
    const back = saveAndReload({ ...createDefaultGuideConfig(), rollout: { mode, percent } });
    if (back.rollout.mode !== mode || back.rollout.percent !== percent) {
      fail(
        `A rollout of ${mode}@${percent}% came back as ` +
          `${back.rollout.mode}@${back.rollout.percent}%.`,
      );
    }
  }
}

// The tab sends what it drafted, so the draft shape has to satisfy the schema the
// server parses with — including a document that has never been saved.
{
  cases += 1;
  if (!guideConfigSchema.safeParse(throughStorage(createDefaultGuideConfig())).success) {
    fail("The tab's initial draft does not satisfy the schema the server parses with.");
  }
  // `updatedAt` is server-owned. A client that echoes one back must not be able to
  // set it to something the dashboard then displays as the last edit.
  cases += 1;
  const echoed = saveAndReload({ ...createDefaultGuideConfig(), updatedAt: 4_000_000_000_000 });
  if (echoed.updatedAt === 4_000_000_000_000) {
    fail("A client-supplied updatedAt was stored verbatim instead of being stamped by the server.");
  }
}

// --- The write path is gated ----------------------------------------------

/**
 * `permissionGate` fails closed on an unmatched path, so a route with no rule
 * 403s for everyone — including a T1 owner, with an error message about
 * permissions that no grant can fix. Read as text rather than imported because
 * `functions/src/permissions.ts` reaches Firebase on load and this checker runs
 * with no emulator.
 */
{
  const adminSource = readFileSync(join(ROOT, "functions", "src", "admin.ts"), "utf8");
  const permissionsSource = readFileSync(join(ROOT, "functions", "src", "permissions.ts"), "utf8");

  const routes = [
    ...new Set(
      [...adminSource.matchAll(/app\.(?:put|post|delete|patch)\(\s*"(\/admin\/config\/[^"]+)"/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
  const rules = [...permissionsSource.matchAll(/\{\s*test:\s*(\/(?:[^/\\]|\\.)+\/)\s*,/g)]
    .map((match) => {
      try {
        return new RegExp(match[1]!.slice(1, -1));
      } catch {
        return null;
      }
    })
    .filter((value): value is RegExp => value !== null);

  cases += 1;
  if (routes.length === 0 || rules.length === 0) {
    fail(
      `Could not read the route table (${routes.length} config routes, ${rules.length} rules) — ` +
        `the gating check is not actually running.`,
    );
  }
  if (!routes.includes("/admin/config/guide")) {
    fail("There is no PUT /admin/config/guide, so the Guided studio tab cannot save.");
  }
  for (const route of routes) {
    cases += 1;
    // Express strips the query string and the mount prefix is included in these
    // literals, so a plain test against the path is what the gate itself does.
    if (!rules.some((rule) => rule.test(route))) {
      fail(
        `${route} has no ROUTE_RULES entry. permissionGate fails closed, so it will 403 for ` +
          `every admin including an owner.`,
      );
    }
  }

  // The rule has to name a grant that exists and that an owner can actually hand
  // out, or the tab is reachable and unusable.
  cases += 1;
  const guideRule = /\/\^\\\/admin\\\/config\\\/guide\$\/,\s*gate:\s*key\("([^"]+)"/.exec(
    permissionsSource,
  );
  if (!guideRule) {
    fail("The /admin/config/guide rule does not gate on a permission key.");
  } else if (!ALL_PERMISSION_KEYS.includes(guideRule[1] as never)) {
    fail(
      `/admin/config/guide is gated on "${guideRule[1]}", which is not a grantable permission key.`,
    );
  } else if (guideRule[1] !== "configuration.guide") {
    notes.push(`the guide config route is gated on "${guideRule[1]}"`);
  }
}

// --- Report ---------------------------------------------------------------

report.push("Admin control of the guide");
report.push(
  `  playlist     ${ALL_IDS.length} components, ${ORDERS.length} orders × ${DISABLED.length} ` +
    `on/off sets`,
);
report.push(`  engine       ${ordersWalked} order/book walks, statuses seen: ${[...statusesSeen].sort().join(", ")}`);
report.push(`  round trip   draft → schema → normalize → storage → normalize`);

notes.push(
  `${ORDERS.length * DISABLED.length} admin-reachable playlists normalized, resolved and walked`,
);

export function checkGuideAdmin(): CheckResult {
  return { failures, notes, report, cases };
}
