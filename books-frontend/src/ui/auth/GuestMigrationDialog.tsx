import { useEffect, useState } from "react";
import { useAuthStore } from "../../state/authStore";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { notify } from "../lib/notify";

/**
 * Shown when a guest signs into a PRE-EXISTING account while holding unsaved
 * drafts. Because the two accounts have different uids, the drafts can't be
 * linked automatically — they'd have to be copied across by a backend (Admin
 * SDK) job. That migration isn't built yet, so this dialog wires the UX
 * (which drafts to bring over) and is honest that the copy is coming soon.
 */
export function GuestMigrationDialog() {
  const pending = useAuthStore((s) => s.pendingMigration);
  const clearMigration = useAuthStore((s) => s.clearMigration);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  const confirm = () => {
    // TODO(backend migration): copy the selected drafts' Firestore docs + Storage
    // blobs from `pending.fromUid` into the current account via an Admin SDK job.
    notify.info(
      "Importing guest drafts is coming soon",
      `${selected.size} storybook${selected.size === 1 ? "" : "s"} couldn't be moved automatically yet.`,
    );
    clearMigration();
  };

  return (
    <Modal
      open
      onClose={clearMigration}
      title="Bring your guest storybooks?"
      size="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={clearMigration}>
            Discard
          </Button>
          <Button onClick={confirm} disabled={selected.size === 0}>
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
