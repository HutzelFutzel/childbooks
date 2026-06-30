/**
 * Childbooks backend — a single 2nd-gen HTTPS function (`api`) that holds all
 * secrets and exposes the AI proxy + Lulu fulfillment endpoints.
 *
 * Why one function: it keeps the surface small and lets the browser hit one
 * base URL (NEXT_PUBLIC_BACKEND_URL). Long-running generation orchestration
 * (the Phase 2 job queue) will live in ADDITIONAL functions in this codebase.
 */
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { createApp } from "./app";
import { ensureAdmin } from "./storage";
import { boundSecrets } from "./secrets";

// Initialize the Admin SDK at module load (cold start), BEFORE any function
// runs. Firestore triggers (onGenerationJob) need an initialized default app to
// build their event snapshot — which the framework does before our handler body
// can call ensureAdmin() — so a purely-lazy init throws "default app does not
// exist" on the trigger path (while the HTTP path is fine because attachUser
// inits first). This top-level call guarantees the app exists for both.
ensureAdmin();

setGlobalOptions({ region: "us-central1", maxInstances: 40 });

// Firestore-triggered generation worker (users/{uid}/jobs/{jobId}).
export { onGenerationJob } from "./jobs";

// Scheduled cleanup of stale anonymous (guest) accounts + their data.
export { cleanupAnonymousUsers } from "./cleanup";

// Auth blocking functions that log signup/login events for the admin dashboard.
export { onBeforeCreate, onBeforeSignIn } from "./analyticsEvents";

export const api = onRequest(
  {
    // Image generation can take a while; allow generous time + memory.
    timeoutSeconds: 300,
    memory: "1GiB",
    secrets: boundSecrets(),
    cors: true,
  },
  createApp(),
);
