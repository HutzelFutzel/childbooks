/**
 * Persistent Firebase emulator launcher.
 *
 * `firebase emulators:start --import=DIR` errors if DIR doesn't exist, which
 * makes it awkward as an everyday command. This wrapper makes persistence
 * automatic:
 *   - imports ./.emulator-data when a previous export exists,
 *   - otherwise starts fresh,
 *   - always exports back to ./.emulator-data on exit.
 *
 * So Auth users and Firestore docs survive restarts. Pass `--clear` to wipe the
 * saved data (a clean slate on the next start).
 *
 * STORAGE IS NOT EMULATED by default — local dev reads and writes the real
 * bucket. Print files have to be fetchable by the print provider (Lulu pulls
 * the interior/cover PDFs minutes after accepting a job) and ebook links have to
 * outlive a restart; emulated Storage hands out `127.0.0.1` URLs that satisfy
 * neither, which is what the old ngrok tunnel existed to paper over. Using the
 * real bucket removes the tunnel, keeps download URLs stable forever, and is the
 * same code path production takes.
 *
 * That needs Application Default Credentials, which this script checks and — on
 * a terminal — offers to set up for you. They're kept in the repo's own
 * `.gcloud/` config dir rather than machine-wide, so signing in here can't
 * repoint the credentials your other Google projects use.
 *
 * Set USE_STORAGE_EMULATOR=true (env or functions/.env.local) to emulate Storage
 * anyway — useful offline. Print checkout then fails its pre-payment
 * reachability check, by design; everything else works.
 *
 * Usage:
 *   node scripts/dev-emulators.mjs            # import-if-present + export-on-exit
 *   node scripts/dev-emulators.mjs --clear    # delete saved emulator data
 */
import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  adcProblem,
  readEnvLocal,
  repairCredentials,
  storageEmulatorEnabled,
  useRepoCredentials,
} from "./dev-env.mjs";

const DATA = "./.emulator-data";

if (process.argv.includes("--clear")) {
  rmSync(DATA, { recursive: true, force: true });
  console.log(`Cleared saved emulator data (${DATA}).`);
  process.exit(0);
}

const emulateStorage = storageEmulatorEnabled(readEnvLocal());
const only = ["auth", "functions", "firestore", "pubsub", ...(emulateStorage ? ["storage"] : [])];

const args = ["emulators:start", "--only", only.join(","), "--export-on-exit", DATA];
// Only import when a real export exists — an empty/partial dir would error.
if (existsSync(`${DATA}/firebase-export-metadata.json`)) {
  args.push("--import", DATA);
  console.log(`Importing saved emulator data from ${DATA}.`);
} else {
  console.log(`No saved emulator data — starting fresh (will export to ${DATA} on exit).`);
}

if (emulateStorage) {
  console.log(
    "Storage: EMULATED (USE_STORAGE_EMULATOR=true) — print orders can't be placed; ebooks work.",
  );
} else {
  const bucket = readEnvLocal().STORAGE_BUCKET ?? "<derived from project id>";
  const scoped = useRepoCredentials();
  console.log(`Storage: real bucket ${bucket} (print files + ebook links are publicly fetchable).`);
  console.log(
    scoped
      ? "Credentials: .gcloud/ (repo-scoped)"
      : "Credentials: machine-wide Application Default Credentials",
  );
  const problem = await adcProblem();
  if (problem && !(await repairCredentials(problem))) {
    console.warn(
      "   Starting anyway — Storage will fail until credentials work. To work\n" +
        "   offline instead, set USE_STORAGE_EMULATOR=true in functions/.env.local\n" +
        "   (plus NEXT_PUBLIC_USE_STORAGE_EMULATOR=true in books-frontend/.env.local).\n",
    );
  }
}

const child = spawn("firebase", args, { stdio: "inherit" });

// Forward termination so Firebase runs its --export-on-exit handler even when a
// parent process (e.g. concurrently) sends SIGTERM instead of SIGINT.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill("SIGINT"));
}

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to start the Firebase emulators:", err.message);
  process.exit(1);
});
