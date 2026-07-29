"use client";

/**
 * Tokenless decline page for invitation emails. An opt-out that requires signing
 * up is not an opt-out — this page posts the code to `/invite/decline` and
 * confirms, without any auth.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { declineInvitation, previewInvitation } from "../../platform/referrals";
import { Button } from "../components/Button";

type Phase = "loading" | "confirm" | "done" | "missing";

export function DeclineInvitePage({ code }: { code: string }) {
  const [phase, setPhase] = useState<Phase>(code ? "loading" : "missing");
  const [benefit, setBenefit] = useState("");
  const [inviterName, setInviterName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    let live = true;
    void previewInvitation(code)
      .then((preview) => {
        if (!live) return;
        setBenefit(preview.benefit);
        setInviterName(preview.inviterName);
        setPhase("confirm");
      })
      .catch(() => {
        if (live) setPhase("confirm");
      });
    return () => {
      live = false;
    };
  }, [code]);

  const confirm = async () => {
    setBusy(true);
    try {
      await declineInvitation(code);
    } finally {
      setBusy(false);
      setPhase("done");
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      {phase === "loading" && <Loader2 className="size-7 animate-spin text-brand-400" />}

      {phase === "missing" && (
        <>
          <XCircle className="mb-3 size-10 text-ink-300" />
          <h1 className="font-display text-2xl text-ink-800">No invitation found</h1>
          <p className="mt-2 text-sm text-ink-500">
            This link is missing an invitation code. If you were trying to opt out, open the decline
            link from the original email.
          </p>
        </>
      )}

      {phase === "confirm" && (
        <>
          <h1 className="font-display text-2xl text-ink-800">Decline this invitation?</h1>
          <p className="mt-2 text-sm text-ink-500">
            {inviterName
              ? `${inviterName} invited you${benefit ? ` (${benefit})` : ""}.`
              : "Someone invited you to make a picture book."}{" "}
            Declining means we won&apos;t email you about invitations again.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void confirm()} loading={busy}>
              Yes, decline
            </Button>
            <Link
              href="/studio"
              className="inline-flex h-11 items-center justify-center rounded-xl2 bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Actually, I&apos;m curious
            </Link>
          </div>
        </>
      )}

      {phase === "done" && (
        <>
          <CheckCircle2 className="mb-3 size-10 text-emerald-500" />
          <h1 className="font-display text-2xl text-ink-800">You&apos;re opted out</h1>
          <p className="mt-2 text-sm text-ink-500">
            We won&apos;t send you invitation emails again. Thanks for letting us know.
          </p>
        </>
      )}
    </main>
  );
}
