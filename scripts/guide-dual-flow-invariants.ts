/**
 * Architectural invariants for the period in which Steps and Chat both ship.
 *
 * These checks are intentionally source-level. The failure they prevent is not a
 * wrong return value; it is a dependency that makes one presentation impossible
 * to remove without pulling the other one apart.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export interface CheckResult {
  failures: string[];
  notes: string[];
  report: string[];
  cases: number;
}

const ROOT = (() => {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (pkg.name === "childbooks") return dir;
    } catch {
      // Keep walking: the invariant bundle runs from node_modules/.cache.
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
})();

const failures: string[] = [];
const notes: string[] = [];
const report: string[] = [];
let cases = 0;

function fail(message: string): void {
  failures.push(message);
}

function sourceFiles(relativeDir: string): string[] {
  const absoluteDir = join(ROOT, relativeDir);
  const out: string[] = [];
  for (const entry of readdirSync(absoluteDir)) {
    const absolute = join(absoluteDir, entry);
    if (statSync(absolute).isDirectory()) {
      out.push(...sourceFiles(relative(ROOT, absolute)));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(relative(ROOT, absolute).split(sep).join("/"));
    }
  }
  return out;
}

function imports(source: string): string[] {
  return [...source.matchAll(/\b(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map(
    (match) => match[1]!,
  );
}

/**
 * Steps-only modules the Chat studio must never reach. The shared editors
 * (StudioContext, StoryManuscript, BookCanvas, BookPreview) are allowed: they
 * outlive Steps. These are the step shells and the old guide's machinery.
 */
const STEPS_ONLY = [
  "/wizard/",
  "guideRouting",
  "GuidedQuestions",
  "StudioWorkspace",
  "StoryWorkspace",
  "CastWorkspace",
  "StyleSetup",
  "OrderStage",
  "state/guideStore",
  "state/guideEffects",
  "core/guide/engine",
  "core/guide/widgets",
  "core/guide/playlist",
];

for (const file of [
  ...sourceFiles("books-frontend/src/ui/guide"),
  "books-frontend/src/state/chatStudio.ts",
  "books-frontend/src/state/chatGeneration.ts",
  "books-frontend/src/state/chatPipeline.ts",
]) {
  const source = readFileSync(join(ROOT, file), "utf8");
  for (const specifier of imports(source)) {
    cases += 1;
    // The rollout seam still resolves the old playlist; it goes with batch L5.
    if (file.endsWith("ui/guide/useGuideMode.ts") && specifier.endsWith("core/guide/playlist")) continue;
    const hit = STEPS_ONLY.find((needle) => specifier.includes(needle) || specifier.endsWith("/wizard"));
    if (hit) fail(`${file} imports the Steps-only module "${specifier}".`);
  }
}

// The old question presentation must not grow a dependency on the Chat
// presentation or its store. Shared core/guide types are allowed.
for (const file of sourceFiles("books-frontend/src/ui/wizard")) {
  const source = readFileSync(join(ROOT, file), "utf8");
  for (const specifier of imports(source)) {
    cases += 1;
    if (specifier.includes("/ui/guide/") || specifier.includes("/state/chatStudio")) {
      fail(`${file} imports the Chat-only module "${specifier}".`);
    }
  }
}

// The presentation branch is the strangler seam. Both arms have to remain visible
// here until retirement; moving the branch into either implementation couples their
// lifetimes and makes the rollback incomplete.
{
  const path = "books-frontend/src/ui/project/ProjectWorkspace.tsx";
  const source = readFileSync(join(ROOT, path), "utf8");
  const requirements: [string, string][] = [
    ["dynamic(() => import(\"../guide/GuideStudio\")", "lazy-load GuideStudio"],
    ["if (guided)", "branch on the resolved mode"],
    ["<GuideStudio", "render the Chat presentation"],
    ["<StudioWorkspace", "retain the Steps presentation"],
  ];
  for (const [needle, description] of requirements) {
    cases += 1;
    if (!source.includes(needle)) fail(`${path} no longer ${description}.`);
  }
}

// Chat must edit the same project and open the shared editors. A new project
// model or copied editor tree would make books non-portable between flows.
{
  const guide = sourceFiles("books-frontend/src/ui/guide").map((file) => readFileSync(join(ROOT, file), "utf8"));
  const all = guide.join("\n");
  for (const [needle, description] of [
    ["useProjectsStore", "read the shared Project store"],
    ["StudioProvider", "use the shared studio context"],
    ["StoryManuscript", "open the shared story editor"],
    ["BookCanvas", "open the shared pages editor"],
    ["PreviewSpread", "show pages with the shared preview"],
  ] as const) {
    cases += 1;
    if (!all.includes(needle)) fail(`ui/guide does not ${description}.`);
  }
  cases += 1;
  if (/interface\s+GuideProject|type\s+GuideProject/.test(all)) {
    fail("ui/guide declares a Guide-specific project model.");
  }
}

// Coral is the paid action only; violet is running work only. A coral class on
// anything but the paid button, the top-up or Order dilutes the one signal the
// reader relies on before spending.
{
  for (const file of sourceFiles("books-frontend/src/ui/guide")) {
    const source = readFileSync(join(ROOT, file), "utf8");
    cases += 1;
    if (/\bbg-brand-\d/.test(source) && !/PaidAction|ComposerWell/.test(file)) {
      fail(`${file} uses the paid-action colour outside the paid action.`);
    }
  }
}

report.push("Dual-flow presentation boundary");
report.push("  ProjectWorkspace → Steps | Chat");
report.push("  Chat → shared StudioProvider, StoryManuscript, BookCanvas, PreviewSpread");
notes.push("Chat and Steps presentation imports are independent.");

export function checkGuideDualFlow(): CheckResult {
  return { failures, notes, report, cases };
}
