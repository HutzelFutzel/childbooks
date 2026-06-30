/**
 * Scheduled cleanup of stale anonymous (guest) users.
 *
 * Guest-first auth creates a fresh anonymous account for every visitor who
 * arrives without a persisted session (incognito, cleared storage, bots, …).
 * Firebase never expires these automatically, so without cleanup they pile up
 * in Auth — and any Firestore/Storage data they touched lingers too.
 *
 * This job runs daily and deletes anonymous users who haven't been active for
 * `ANON_CLEANUP_MAX_AGE_DAYS` (default 30):
 *   1. recursively delete their Firestore subtree (`users/{uid}/**`),
 *   2. delete their Storage objects (`users/{uid}/**`),
 *   3. delete the Auth account itself (in batches).
 *
 * Deleting the Auth user does NOT cascade to Firestore/Storage, so we do (1)+(2)
 * explicitly. Users who upgraded keep the same uid but gain a provider, so they
 * have `providerData.length > 0` and are never selected here. Recently-active
 * guests (mid-conversion) are skipped by the age threshold.
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { getAuth, type UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { ensureAdmin, storageBucketName } from "./storage";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hard cap on deletions per run, so a large backlog drains gradually + safely. */
const MAX_DELETIONS_PER_RUN = 2000;
/** Auth batch-delete accepts at most 1000 uids per call. */
const DELETE_BATCH = 1000;

function maxAgeMs(): number {
  const days = Number(process.env.ANON_CLEANUP_MAX_AGE_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 30) * DAY_MS;
}

/** Epoch ms of the user's most recent activity (sign-in / token refresh). */
function lastActiveMs(user: UserRecord): number {
  const { lastRefreshTime, lastSignInTime, creationTime } = user.metadata;
  const stamp = lastRefreshTime || lastSignInTime || creationTime;
  const ms = stamp ? Date.parse(stamp) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/** True for an anonymous account with no recent activity. */
function isStaleAnonymous(user: UserRecord, cutoffMs: number): boolean {
  const anonymous = user.providerData.length === 0;
  return anonymous && lastActiveMs(user) < cutoffMs;
}

/** Best-effort removal of a single guest's stored data. */
async function purgeUserData(uid: string): Promise<void> {
  try {
    await getFirestore().recursiveDelete(getFirestore().doc(`users/${uid}`));
  } catch (err) {
    logger.warn("anon-cleanup: firestore purge failed", { uid, err: String(err) });
  }
  try {
    await getStorage().bucket(storageBucketName()).deleteFiles({ prefix: `users/${uid}/` });
  } catch (err) {
    logger.warn("anon-cleanup: storage purge failed", { uid, err: String(err) });
  }
}

async function deleteAuthUsers(uids: string[]): Promise<number> {
  let failures = 0;
  for (let i = 0; i < uids.length; i += DELETE_BATCH) {
    const chunk = uids.slice(i, i + DELETE_BATCH);
    try {
      const res = await getAuth().deleteUsers(chunk);
      failures += res.failureCount;
      for (const e of res.errors) {
        logger.warn("anon-cleanup: auth delete error", { index: e.index, err: e.error.message });
      }
    } catch (err) {
      failures += chunk.length;
      logger.warn("anon-cleanup: auth batch delete threw", { err: String(err) });
    }
  }
  return failures;
}

export const cleanupAnonymousUsers = onSchedule(
  {
    schedule: "every 24 hours",
    timeoutSeconds: 540,
    memory: "512MiB",
    retryCount: 0,
  },
  async () => {
    ensureAdmin();
    const cutoffMs = Date.now() - maxAgeMs();
    const stale: string[] = [];

    // Page through every account and collect stale guests (bounded per run).
    let pageToken: string | undefined;
    let scanned = 0;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      scanned += page.users.length;
      for (const user of page.users) {
        if (isStaleAnonymous(user, cutoffMs)) stale.push(user.uid);
        if (stale.length >= MAX_DELETIONS_PER_RUN) break;
      }
      pageToken = page.pageToken;
    } while (pageToken && stale.length < MAX_DELETIONS_PER_RUN);

    if (stale.length === 0) {
      logger.info("anon-cleanup: nothing to delete", { scanned });
      return;
    }

    // Purge each guest's data first, then delete the Auth accounts in batches.
    for (const uid of stale) {
      await purgeUserData(uid);
    }
    const failures = await deleteAuthUsers(stale);

    logger.info("anon-cleanup: done", {
      scanned,
      deleted: stale.length - failures,
      failures,
      cappedAtMax: stale.length >= MAX_DELETIONS_PER_RUN,
    });
  },
);
