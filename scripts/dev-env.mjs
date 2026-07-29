/**
 * Shared dev-time environment helpers.
 *
 * `readEnvLocal` / `projectId` live in set-secrets.mjs (which parses the same
 * file as the single source of truth); re-exported here so the dev scripts don't
 * reach into a secrets tool for them.
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readEnvLocal, projectId } from "./set-secrets.mjs";

export { readEnvLocal, projectId };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A gcloud config directory belonging to THIS REPO, not the machine.
 *
 * Local dev needs Application Default Credentials (it writes the real Storage
 * bucket), but the machine-wide ADC at `~/.config/gcloud` is shared with every
 * other Google project you work on — it carries a single `quota_project_id`, so
 * pointing it at this project silently reconfigures unrelated work. Keeping our
 * own config dir means `gcloud auth application-default login` here can't disturb
 * anything else, and the quota project is only ever set for this repo.
 *
 * Git-ignored: the file inside holds an OAuth refresh token.
 */
export const GCLOUD_CONFIG_DIR = join(ROOT, ".gcloud");
export const REPO_ADC_PATH = join(GCLOUD_CONFIG_DIR, "application_default_credentials.json");

/** Env for a `gcloud` invocation that should read/write the repo's config dir. */
export function gcloudRepoEnv() {
  return { ...process.env, CLOUDSDK_CONFIG: GCLOUD_CONFIG_DIR };
}

/**
 * Point this process (and everything it spawns) at the repo's credentials, when
 * they exist.
 *
 * `GOOGLE_APPLICATION_CREDENTIALS` is the FIRST thing ADC resolution checks, so
 * setting it here is enough to reach the whole tree: firebase-tools inherits it,
 * and so does the functions runtime it spawns, which is where the Admin SDK
 * actually authenticates. Returns whether repo credentials were found.
 */
export function useRepoCredentials() {
  if (!existsSync(REPO_ADC_PATH)) return false;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = REPO_ADC_PATH;
  return true;
}

/** Emulator ports, mirroring the `emulators` block in firebase.json. */
export const FUNCTIONS_EMULATOR_PORT = 5001;

/** The local Functions-emulator base URL for the `api` function. */
export function apiBaseUrl() {
  return `http://127.0.0.1:${FUNCTIONS_EMULATOR_PORT}/${projectId()}/us-central1/api`;
}

/**
 * Whether to run the Storage emulator instead of using the real bucket.
 *
 * Off by default: print files must be fetchable by the print provider and ebook
 * download links must survive a restart, and emulated Storage serves neither
 * (its URLs are `127.0.0.1`). Turning it on is for offline work — print checkout
 * then fails its pre-payment reachability check by design.
 */
export function storageEmulatorEnabled(fileEnv = {}) {
  const raw = process.env.USE_STORAGE_EMULATOR ?? fileEnv.USE_STORAGE_EMULATOR ?? "";
  return raw.trim().toLowerCase() === "true";
}

/**
 * Prove Application Default Credentials can actually mint a token, since dev
 * writes to the real Storage bucket with them.
 *
 * Worth a startup round trip because the failure is otherwise deeply unhelpful:
 * expired credentials surface as an `invalid_grant` / `invalid_rapt` stack trace
 * from inside an image upload, minutes into a session, looking like a bug in the
 * feature that happened to touch Storage first. Returns a reason string when
 * they're unusable, or null when they're fine.
 */
export async function adcProblem() {
  let GoogleAuth;
  try {
    ({ GoogleAuth } = await import("google-auth-library"));
  } catch {
    return null; // Can't check — don't invent a problem.
  }
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    return token ? null : "no access token was returned";
  } catch (err) {
    const message = err?.message ?? String(err);
    if (/invalid_rapt|invalid_grant|reauth/i.test(message)) {
      return "credentials have expired and need reauthentication";
    }
    if (/Could not load the default credentials/i.test(message)) {
      return "no Application Default Credentials were found";
    }
    return message.split("\n")[0];
  }
}

/** The commands that repair credentials, for printing when we can't prompt. */
export function adcFixCommands() {
  return [
    `CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login`,
    `CLOUDSDK_CONFIG=.gcloud gcloud auth application-default set-quota-project ${projectId()}`,
  ];
}

/** Ask a yes/no question on the terminal. Defaults to yes on a bare Enter. */
async function confirm(question) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => rl.question(`${question} [Y/n] `, resolve));
    return !/^n/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function runGcloud(args, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn("gcloud", args, {
      // Inherited for the login: it prints a URL and waits on the browser
      // round trip, so the user has to see and interact with it.
      stdio: quiet ? "ignore" : "inherit",
      env: gcloudRepoEnv(),
      shell: false,
    });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

/**
 * Repair the repo's credentials, interactively.
 *
 * `application-default login` is an OAuth consent flow — a browser, an account
 * picker, an Allow button — so it can never be truly unattended; the most a
 * script can do is launch it and wait. Only offered on a TTY: in CI or a managed
 * background task there is nobody to answer, and a blocking prompt there would
 * hang the run instead of failing it.
 *
 * `set-quota-project` IS non-interactive, and safe to run unasked now that it
 * only touches this repo's config dir. Its failure is non-fatal — Storage works
 * without a quota project, it just attributes API quota elsewhere.
 *
 * Returns true when credentials are usable afterwards.
 */
export async function repairCredentials(problem) {
  const commands = adcFixCommands();
  const offer = process.stdin.isTTY && process.stdout.isTTY;
  if (!offer) {
    console.warn(
      `\n⚠️  Application Default Credentials are unusable: ${problem}.\n` +
        "   Every Storage read/write will fail (blank images, no ebook downloads,\n" +
        "   print checkout refused). Fix with:\n\n" +
        commands.map((c) => `     ${c}`).join("\n") +
        "\n",
    );
    return false;
  }

  console.warn(`\n⚠️  Application Default Credentials are unusable: ${problem}.`);
  console.warn(
    "   Storage reads/writes will fail until they're fixed (blank images, no\n" +
      "   ebook downloads, print checkout refused).\n" +
      `   Signing in writes ONLY to ${GCLOUD_CONFIG_DIR} — your machine-wide\n` +
      "   gcloud credentials and their quota project are left untouched.\n",
  );

  if (!(await confirm("   Open the browser and sign in now?"))) {
    console.warn(
      "\n   Skipped. Run this when you're ready:\n\n" +
        commands.map((c) => `     ${c}`).join("\n") +
        "\n",
    );
    return false;
  }

  if (!(await runGcloud(["auth", "application-default", "login"]))) {
    console.error(
      "\n   Sign-in failed or was cancelled. Is the Google Cloud CLI installed?\n" +
        "   https://cloud.google.com/sdk/docs/install\n",
    );
    return false;
  }

  // Attach the quota project so API usage bills to this project rather than
  // whatever the account defaults to. Quiet: a failure here is cosmetic.
  await runGcloud(
    ["auth", "application-default", "set-quota-project", projectId()],
    { quiet: true },
  );

  useRepoCredentials();
  const remaining = await adcProblem();
  if (remaining) {
    console.error(`\n   Credentials still unusable: ${remaining}.\n`);
    return false;
  }
  console.log("   ✅ Credentials are working.\n");
  return true;
}
