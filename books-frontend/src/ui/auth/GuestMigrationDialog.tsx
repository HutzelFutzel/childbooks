import { useEffect, useState } from "react";
import { useAuthStore } from "../../state/authStore";
import { useProjectsStore } from "../../state/projectsStore";
import { migrateGuestDrafts } from "../../platform/migration";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";

/**
 * Shown when a guest signs into a PRE-EXISTING account while holding unsaved
 * drafts. Because the two accounts have different uids, the backend copies the
 * selected drafts' Firestore docs + Storage blobs across (ownership of the
 * guest side is proven by the guest ID token captured before the switch).
 */
export function GuestMigrationDialog() {
  const pending = useAuthStore((s) => s.pendingMigration);
  const clearMigration = useAuthStore((s) => s.clearMigration);
  const reloadProjects = useProjectsStore((s) => s.load);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // Default to "bring everything over" whenever a new prompt appears.
  useEffect(() => {
    setSelected(new Set(pending?.projects.map((p) => p.id) ?? []));
  }, [pending]);

  if (!pending) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    setImporting(true);
    try {
      const result = await migrateGuestDrafts(pending.guestToken, [...selected]);
      await reloadProjects();
      const n = result.migrated.length;
      if (n > 0) {
        notify.success(
          `${n} storybook${n === 1 ? "" : "s"} added to your account`,
          result.skipped.length > 0 ? "Some were already in your account and were left as-is." : undefined,
        );
      } else {
        notify.info(
          "Nothing to import",
          "Those storybooks are already in your account or are no longer available.",
        );
      }
      clearMigration();
    } catch (err) {
      notify.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open
      onClose={importing ? () => {} : clearMigration}
      title="Bring your guest storybooks?"
      size="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={clearMigration} disabled={importing}>
            Discard
          </Button>
          <Button onClick={() => void confirm()} disabled={selected.size === 0} loading={importing}>
            Add to my account
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-600">
        You created these as a guest. Choose which to add to the account you just signed into —
        anything you leave out will stay only in your guest session.
      </p>
      <ul className="mt-4 space-y-1.5">
        {pending.projects.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-200 px-3 py-2.5 transition hover:bg-ink-50">
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="size-4 accent-brand-600"
              />
              <span className="truncate text-sm font-medium text-ink-800">{p.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
