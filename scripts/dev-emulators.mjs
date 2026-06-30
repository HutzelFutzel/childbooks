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
 * So Auth users, Firestore docs and Storage blobs survive restarts. Pass
 * `--clear` to wipe the saved data (a clean slate on the next start).
 *
 * Usage:
 *   node scripts/dev-emulators.mjs            # import-if-present + export-on-exit
 *   node scripts/dev-emulators.mjs --clear    # delete saved emulator data
 */
import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

const DATA = "./.emulator-data";

if (process.argv.includes("--clear")) {
  rmSync(DATA, { recursive: true, force: true });
  console.log(`Cleared saved emulator data (${DATA}).`);
  process.exit(0);
}

const args = ["emulators:start", "--export-on-exit", DATA];
// Only import when a real export exists — an empty/partial dir would error.
if (existsSync(`${DATA}/firebase-export-metadata.json`)) {
  args.push("--import", DATA);
  console.log(`Importing saved emulator data from ${DATA}.`);
} else {
  console.log(`No saved emulator data — starting fresh (will export to ${DATA} on exit).`);
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
