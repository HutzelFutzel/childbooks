"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { Check, Pencil } from "lucide-react";
import { getFirebaseAuth, getFirebaseDb } from "../../lib/firebase";
import { useAppConfigStore } from "@/state/appConfigStore";
import { cn } from "../lib/cn";
import { useEditMode } from "./editMode";

/**
 * Floating "Edit page" control for the public landing page, shown ONLY to a
 * signed-in admin. It observes the *persisted* Firebase session directly and
 * never forces an anonymous sign-in, so normal visitors incur no auth and never
 * see the control. Toggling on subscribes to the live config docs so inline
 * edits (images/text) reflect immediately.
 */
export function AdminEditBar() {
  const admin = useEditMode((s) => s.admin);
  const setAdmin = useEditMode((s) => s.setAdmin);
  const enabled = useEditMode((s) => s.enabled);
  const toggle = useEditMode((s) => s.toggle);
  const subscribe = useAppConfigStore((s) => s.subscribe);

  useEffect(() => {
    const unsub = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (user && !user.isAnonymous) {
        try {
          const snap = await getDoc(doc(getFirebaseDb(), "admins", user.uid));
          setAdmin(snap.exists());
        } catch {
          setAdmin(false);
        }
      } else {
        setAdmin(false);
      }
    });
    return () => unsub();
  }, [setAdmin]);

  useEffect(() => {
    if (admin && enabled) subscribe();
  }, [admin, enabled, subscribe]);

  if (!admin) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2">
      {enabled && (
        <span className="rounded-full bg-ink-900/90 px-3 py-1.5 text-xs font-medium text-white shadow-lifted backdrop-blur">
          Click text to edit · drop images to replace
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lifted transition",
          enabled
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : "bg-white text-ink-800 ring-1 ring-ink-200 hover:bg-ink-50",
        )}
      >
        {enabled ? <Check className="size-4" /> : <Pencil className="size-4" />}
        {enabled ? "Done editing" : "Edit page"}
      </button>
    </div>
  );
}
