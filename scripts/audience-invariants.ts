/**
 * Invariants for the audience (age band) configuration, plus the staging
 * document generator.
 *
 * Age bands are the one config where a mistake is expensive and silent: a band
 * whose numbers contradict each other still generates books, just consistently
 * wrong ones. There is no test suite over this area, so these checks stand in
 * for one — everything here is arithmetic or an ID lookup, so it needs no
 * network, no emulator and no model call.
 *
 * `--emit <dir>` writes the same shipped defaults out as the two Firestore
 * documents (`appConfig/audience`, `appConfig/storyCraft`), so a staging
 * environment can be seeded from exactly the configuration the code ships with
 * rather than a hand-copied second version of it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_AUDIENCE_PROFILES,
  EDITORIAL_DIMENSIONS,
  GUARDRAIL_SECTIONS,
  dimensionDef,
  type AudienceProfile,
} from "../books-frontend/src/core/config/audienceCatalog";
import {
  audienceConfigSchema,
  inspectAudienceConfig,
  type AudienceConfig,
} from "../books-frontend/src/core/config/audience";
import {
  DEFAULT_STORY_CRAFT,
  defaultStoryCraft,
} from "../books-frontend/src/core/config/storyCraftCatalog";
import { storyCraftConfigSchema } from "../books-frontend/src/core/config/storyCraft";
import {
  DEFAULT_BODY_FONT_SEED_CAP_PT,
  DEFAULT_TYPOGRAPHY,
} from "../books-frontend/src/core/config/typography";
import { resolveAudienceOverlays } from "../books-frontend/src/core/prompts/audience";
import { READING_MODE_IDS } from "../books-frontend/src/core/config/readingModes";

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

const enabled = DEFAULT_AUDIENCE_PROFILES.filter((p) => p.enabled).sort(
  (a, b) => a.order - b.order,
);

// --- Identity and coverage -------------------------------------------------

const ids = new Set<string>();
for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  if (ids.has(profile.id)) fail(`Duplicate profile id "${profile.id}".`);
  ids.add(profile.id);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profile.id)) {
    fail(`Profile id "${profile.id}" is not storable (lowercase, digits, hyphens).`);
  }
  if (profile.minMonths > profile.maxMonths) {
    fail(`${profile.id}: minMonths ${profile.minMonths} exceeds maxMonths ${profile.maxMonths}.`);
  }
  if (profile.extendsId && !ids.has(profile.extendsId) && !DEFAULT_AUDIENCE_PROFILES.some((p) => p.id === profile.extendsId)) {
    fail(`${profile.id}: extends "${profile.extendsId}", which does not exist.`);
  }
}

// Enabled bands must tile the range without gaps or overlaps, because the age
// shortcut resolves a child's age by containment and has no way to choose
// between two bands that both claim a month.
for (let i = 1; i < enabled.length; i++) {
  const prev = enabled[i - 1];
  const next = enabled[i];
  if (next.minMonths <= prev.maxMonths) {
    fail(`${prev.id} (…${prev.maxMonths}) overlaps ${next.id} (${next.minMonths}…).`);
  } else if (next.minMonths !== prev.maxMonths + 1) {
    fail(
      `Gap between ${prev.id} and ${next.id}: months ${prev.maxMonths + 1}–${next.minMonths - 1} match no enabled band.`,
    );
  }
}

// --- Dimensions and sections ----------------------------------------------

for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  const inherits = Boolean(profile.extendsId);

  for (const [id, value] of Object.entries(profile.dimensions)) {
    const def = dimensionDef(id);
    if (!def) {
      fail(`${profile.id}: "${id}" is not a known dimension.`);
      continue;
    }
    if (!Number.isInteger(value.level) || value.level < 0 || value.level >= def.levels.length) {
      fail(
        `${profile.id}.${id}: level ${value.level} is outside 0–${def.levels.length - 1} ("${def.label}").`,
      );
    }
  }

  // An inherited band states only its deltas, so completeness is a question
  // about the resolved profile rather than the stored one.
  if (!inherits) {
    const missingDims = EDITORIAL_DIMENSIONS.filter((d) => !profile.dimensions[d.id]);
    if (missingDims.length > 0) {
      fail(`${profile.id}: ${missingDims.length} dimensions unset (${missingDims.map((d) => d.id).join(", ")}).`);
    }
    const missingSections = GUARDRAIL_SECTIONS.filter((s) => !(profile.sections[s.id] ?? "").trim());
    if (missingSections.length > 0) {
      fail(`${profile.id}: ${missingSections.length} sections blank (${missingSections.map((s) => s.id).join(", ")}).`);
    }
  }

  for (const id of Object.keys(profile.sections)) {
    if (!GUARDRAIL_SECTIONS.some((s) => s.id === id)) {
      fail(`${profile.id}: "${id}" is not a known guardrail section.`);
    }
  }

  for (const id of profile.evaluatedDimensionIds) {
    if (!dimensionDef(id)) fail(`${profile.id}: evaluated dimension "${id}" does not exist.`);
    else if (!inherits && !profile.dimensions[id]) {
      fail(`${profile.id}: evaluates "${id}" but never configures it, so it cannot be scored.`);
    }
  }

  for (const mode of profile.readingModes) {
    if (!READING_MODE_IDS.includes(mode)) fail(`${profile.id}: unknown reading mode "${mode}".`);
    if (!profile.modes[mode]?.humanGuidance.trim()) {
      fail(`${profile.id}: reading mode "${mode}" has no customer-facing wording.`);
    }
  }
  if (profile.readingModes.length === 0 && !profile.modes.default?.humanGuidance.trim()) {
    fail(`${profile.id}: no reading modes and no default wording, so the picker shows nothing.`);
  }
}

// --- Structure and density coherence -------------------------------------

for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  const { structure, density } = profile;
  if (structure.minWords > structure.maxWords) {
    fail(`${profile.id}: minWords exceeds maxWords.`);
  }
  if (density.minPages > density.maxPages) {
    fail(`${profile.id}: minPages exceeds maxPages.`);
  }
  if (density.maxWordsPerPage > 0 && density.targetWordsPerPage > density.maxWordsPerPage) {
    fail(`${profile.id}: target words per page is above the per-page maximum.`);
  }
  if (
    structure.maxSentenceWords > 0 &&
    density.maxWordsPerPage > 0 &&
    structure.maxSentenceWords > density.maxWordsPerPage
  ) {
    fail(`${profile.id}: one sentence may be longer than a whole page may be.`);
  }
  if (structure.plotRequired && (profile.dimensions.plotComplexity?.level ?? 1) === 0) {
    fail(`${profile.id}: plotRequired is on while plotComplexity is "None".`);
  }
  // The page range the words imply has to overlap the page range that was typed,
  // or every book misses one of the two.
  if (density.targetWordsPerPage > 0) {
    const low = Math.ceil(structure.minWords / density.targetWordsPerPage);
    const high = Math.ceil(structure.maxWords / density.targetWordsPerPage);
    if (high < density.minPages || low > density.maxPages) {
      fail(
        `${profile.id}: ${structure.minWords}–${structure.maxWords} words at ~${density.targetWordsPerPage}/page implies ${low}–${high} pages, which does not overlap the configured ${density.minPages}–${density.maxPages}.`,
      );
    }
  }
  if (profile.protagonist.minAge > profile.protagonist.maxAge) {
    fail(`${profile.id}: protagonist minAge exceeds maxAge.`);
  }
}

// --- Compiled overlays ----------------------------------------------------

// Every band has to produce something for each pipeline step. An empty channel
// means a prompt that silently carries no age guidance at all.
for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  const modes: (string | null)[] =
    profile.readingModes.length > 0 ? [...profile.readingModes] : [null];
  for (const mode of modes) {
    const o = resolveAudienceOverlays(profile.id, mode, null);
    if (o.profile.id !== profile.id) {
      fail(`${profile.id}: resolved to "${o.profile.id}" instead of itself.`);
    }
    for (const channel of ["story", "screenplay", "illustration", "characterArt", "evaluation"] as const) {
      if (!o[channel].trim()) {
        fail(`${profile.id}${mode ? ` (${mode})` : ""}: the ${channel} overlay compiles to nothing.`);
      }
    }
    if (!o.density.trim()) fail(`${profile.id}: no page-pacing sentence.`);
    if (!o.protagonist.trim()) fail(`${profile.id}: no hero sentence.`);
    if (/\{\{/.test(o.protagonist)) fail(`${profile.id}: hero sentence still contains a placeholder.`);
    if (!o.safetyList.trim()) fail(`${profile.id}: empty never-include list.`);
  }
}

// --- Story Craft ----------------------------------------------------------

for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  const craft = defaultStoryCraft(profile.id);
  const lists = { themes: craft.themes, devices: craft.devices, settings: craft.settings };
  for (const [key, options] of Object.entries(lists)) {
    if (profile.enabled && options.length === 0) {
      fail(`${profile.id}: no Story Craft ${key}, so the Story step offers only free text.`);
    }
    const seen = new Set<string>();
    for (const option of options) {
      if (seen.has(option.id)) fail(`${profile.id}.${key}: duplicate option id "${option.id}".`);
      seen.add(option.id);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(option.id)) {
        fail(`${profile.id}.${key}: option id "${option.id}" is not storable.`);
      }
      if (!option.llmGuidance.trim()) {
        fail(`${profile.id}.${key}.${option.id}: no prompt guidance, so choosing it changes nothing.`);
      }
    }
  }
}

for (const id of Object.keys(DEFAULT_STORY_CRAFT)) {
  if (!ids.has(id)) fail(`Story Craft configures "${id}", which is not an age band.`);
}

// --- Typography -----------------------------------------------------------

// `nearestShippedBandId` only considers bands that have a row here, so a band
// without one silently borrows type sizes from a different reading age.
for (const profile of DEFAULT_AUDIENCE_PROFILES) {
  if (!DEFAULT_TYPOGRAPHY.bands[profile.id]) {
    fail(`${profile.id}: no typography row, so its type size falls back to another band.`);
  }
  if (!DEFAULT_BODY_FONT_SEED_CAP_PT[profile.id]) {
    fail(`${profile.id}: no body-font seed cap.`);
  }
}

// --- Persisted document shape --------------------------------------------

/** The shipped defaults expressed as the documents an admin dashboard saves. */
function stagingDocuments(): { audience: AudienceConfig; storyCraft: unknown } {
  return {
    audience: {
      version: 1,
      profiles: DEFAULT_AUDIENCE_PROFILES.map((profile) => ({ ...profile })),
      deletedProfileIds: [],
      revision: 0,
    } as AudienceConfig,
    storyCraft: {
      version: 1,
      // Lists only. Structure, hero age and safety belong to the audience
      // profile now, and writing them here would resurrect the old owner.
      bands: Object.fromEntries(
        DEFAULT_AUDIENCE_PROFILES.map((profile) => {
          const craft = defaultStoryCraft(profile.id);
          return [
            profile.id,
            { themes: craft.themes, devices: craft.devices, settings: craft.settings },
          ];
        }),
      ),
    },
  };
}

const docs = stagingDocuments();

const audienceParse = audienceConfigSchema.safeParse(docs.audience);
if (!audienceParse.success) {
  for (const issue of audienceParse.error.issues) {
    fail(`appConfig/audience ${issue.path.join(".")}: ${issue.message}`);
  }
}
const craftParse = storyCraftConfigSchema.safeParse(docs.storyCraft);
if (!craftParse.success) {
  for (const issue of craftParse.error.issues) {
    fail(`appConfig/storyCraft ${issue.path.join(".")}: ${issue.message}`);
  }
}

// Round-tripping the emitted document must reproduce the shipped bands, or the
// staging environment is not running what the code ships.
const roundTripped = inspectAudienceConfig({ audience: docs.audience });
for (const issue of roundTripped.filter((i) => i.severity === "warn")) {
  fail(`${issue.profileId}: ${issue.message}`);
}
for (const issue of roundTripped.filter((i) => i.severity === "info")) {
  notes.push(`${issue.profileId}: ${issue.message}`);
}

// --- Report ---------------------------------------------------------------

const summary = (profile: AudienceProfile) =>
  [
    profile.enabled ? "on " : "off",
    profile.id.padEnd(8),
    `${String(profile.minMonths).padStart(3)}–${String(profile.maxMonths).padEnd(3)}m`,
    `${String(profile.structure.minWords).padStart(5)}–${String(profile.structure.maxWords).padEnd(5)}w`,
    `${String(profile.density.minPages).padStart(2)}–${String(profile.density.maxPages).padEnd(3)}p`,
    profile.readingModes.length > 0 ? `default ${profile.readingModes[0]}` : "read aloud",
  ].join("  ");

console.log("Bands");
for (const profile of DEFAULT_AUDIENCE_PROFILES) console.log(`  ${summary(profile)}`);

const emitIndex = process.argv.indexOf("--emit");
if (emitIndex !== -1) {
  const dir = process.argv[emitIndex + 1];
  if (!dir) {
    fail("--emit needs a target directory.");
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "appConfig-audience.json"), `${JSON.stringify(docs.audience, null, 2)}\n`);
    writeFileSync(join(dir, "appConfig-storyCraft.json"), `${JSON.stringify(docs.storyCraft, null, 2)}\n`);
    console.log(`\nWrote appConfig-audience.json and appConfig-storyCraft.json to ${dir}`);
  }
}

if (notes.length > 0) {
  console.log("\nNotes");
  for (const note of notes) console.log(`  · ${note}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem${failures.length === 1 ? "" : "s"}:`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\n${DEFAULT_AUDIENCE_PROFILES.length} bands, ${enabled.length} offered — all invariants hold.`);
}
