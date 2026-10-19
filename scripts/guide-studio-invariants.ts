/**
 * Architectural invariants for the Chat studio.
 *
 * These checks are intentionally source-level. The failure they prevent is not a
 * wrong return value; it is the Chat studio growing its own copy of something it
 * is meant to share with the rest of the studio.
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

// Chat must edit the same project and open the shared editors. A new project
// model or copied editor tree would fork how a book is stored and edited.
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

report.push("Chat studio");
report.push("  Chat → shared StudioProvider, StoryManuscript, BookCanvas, PreviewSpread");
notes.push("Chat reuses the shared project model and editors.");

export function checkGuideStudio(): CheckResult {
  return { failures, notes, report, cases };
}
