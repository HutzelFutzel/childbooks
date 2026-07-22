/**
 * Client access to guest-draft migration. When a guest signs into a
 * pre-existing account (different uid), the backend copies the selected drafts'
 * Firestore docs + Storage blobs across. Ownership of the guest side is proven
 * by the guest session's ID token captured before the switch (see authStore).
 */
import { backendFetch } from "./backend";

export interface GuestMigrationResult {
  /** Project ids that were copied into the signed-in account. */
  migrated: string[];
  /** Ids that were skipped (already present, or no longer found on the guest). */
  skipped: string[];
}

export async function migrateGuestDrafts(
  guestToken: string,
  projectIds: string[],
): Promise<GuestMigrationResult> {
  const res = await backendFetch("/migrate/guest-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestToken, projectIds }),
  });
  if (!res.ok) {
    let message = "We couldn't import your drafts.";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  return (await res.json()) as GuestMigrationResult;
}
