/**
 * yarn help — list yarn scripts with short descriptions.
 *
 *   yarn cmds           # all root scripts (+ workspace scripts)
 *   yarn run help       # same (plain `yarn help` is Yarn's built-in CLI help)
 *   yarn cmds dev       # filter to scripts whose name contains "dev"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ROOT_DESCRIPTIONS = {
  dev: "Next.js frontend dev server (port 1420)",
  "dev:backend": "Functions build + Firebase emulators (--all, --order, --stripe)",
  "dev:all": "Frontend + backend dev (same as dev:backend --all)",
  build: "Build functions bundle, then the Next.js app",
  "build:web": "Production build of the Next.js frontend",
  "build:functions": "esbuild bundle for Firebase Functions",
  start: "Run the production Next.js server (after build:web)",
  emulators: "Firebase emulators with persistent ./.emulator-data",
  "emulators:clear": "Delete saved emulator data, then start fresh on next run",
  "check:env": "Validate apphosting.yaml + Secret Manager before deploy",
  deploy: "Build + deploy backend, rules, indexes, storage (+ optional --web)",
  "deploy:functions": "Build functions only, then firebase deploy --only functions",
  "deploy:rules": "Deploy Firestore rules/indexes and Storage rules only",
  setSecrets: "Push functions/.env.local → Secret Manager (+ GitHub allowlist)",
  "setSecrets:status": "Show which declared secrets exist in Secret Manager",
  cmds: "Show this list of yarn scripts (preferred; `yarn help` is reserved by Yarn)",
  help: "Same as yarn cmds (use `yarn run help` — plain yarn help is Yarn CLI)",
};

const WORKSPACE_DESCRIPTIONS = {
  "books-frontend": {
    dev: "Next dev server on port 1420",
    build: "Next.js production build",
    start: "Serve the production build",
    typecheck: "TypeScript check without emitting",
  },
  functions: {
    build: "esbuild bundle → functions/lib",
    "build:watch": "Rebuild functions on file changes",
    dev: "Alias for build:watch",
    serve: "Build + run functions emulator only",
    typecheck: "TypeScript check without emitting",
  },
};

function readScripts(pkgPath) {
  try {
    return Object.keys(JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {});
  } catch {
    return [];
  }
}

function pad(s, n) {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printSection(title, scripts, descriptions, { prefix = "yarn" } = {}) {
  const filter = process.argv[2]?.toLowerCase();
  const entries = scripts
    .filter((name) => name !== "help" || prefix === "yarn")
    .filter((name) => !filter || name.toLowerCase().includes(filter))
    .map((name) => [name, descriptions[name] ?? "(no description)"]);
  if (entries.length === 0) return;
  console.log(`\n${title}`);
  const col = Math.max(...entries.map(([name]) => `${prefix} ${name}`.length), 12);
  for (const [name, desc] of entries) {
    console.log(`  ${pad(`${prefix} ${name}`, col)}  ${desc}`);
  }
}

console.log("Childbooks yarn scripts");
console.log("(Use `yarn cmds` — plain `yarn help` is Yarn's built-in CLI help.)\n");

const rootScripts = readScripts(join(ROOT, "package.json"));
printSection("Root scripts", rootScripts, ROOT_DESCRIPTIONS);

for (const [workspace, descriptions] of Object.entries(WORKSPACE_DESCRIPTIONS)) {
  const scripts = readScripts(join(ROOT, workspace, "package.json"));
  printSection(
    `Workspace: ${workspace}`,
    scripts,
    descriptions,
    { prefix: `yarn workspace ${workspace}` },
  );
}

const filter = process.argv[2];
if (filter) {
  console.log(`\n(filter: "${filter}")`);
} else {
  console.log("\nTip: yarn cmds <word> filters by script name (e.g. yarn cmds deploy).");
}
console.log("");
