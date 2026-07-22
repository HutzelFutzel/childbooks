import { useEffect, useState } from "react";
import { MailCheck, RefreshCw } from "lucide-react";
import { authErrorMessage, useAuthStore } from "../../state/authStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { notify } from "../lib/notify";

/**
 * A slim reminder bar for signed-in users whose email isn't verified yet.
 * Verification no longer gates the studio (unverified users draft + generate
 * with their granted Sparks) — it unlocks the verify bonus and purchases, so
 * this nudges instead of blocking.
 *
 * `emailVerified` doesn't update on its own after the user clicks the link, so
 * we poll `refreshUser()` on an interval; once verified, `accessLevel` flips to
 * "full" and this banner unmounts.
 */
export function VerifyEmailBanner() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const sparks = useAppConfigStore((s) => s.sparks);
  const [resending, setResending] = useState(false);

  // Auto-poll for verification so the banner clears without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => void refreshUser(), 5000);
    return () => clearInterval(id);
  }, [refreshUser]);

  const resend = async () => {
    setResending(true);
    try {
      await resendVerification();
      notify.success("Verification email sent", "Check your inbox (and spam folder).");
    } catch (err) {
      notify.error(authErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  const bonus = sparks.enabled ? sparks.grants.verifyBonusSparks : 0;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-accent-200 bg-accent-50 px-4 py-2 text-xs text-accent-800">
      <span className="flex min-w-0 items-center gap-1.5">
        <MailCheck className="size-4 shrink-0" />
        <span className="truncate">
          Confirm the link we sent to{" "}
          <span className="font-semibold">{user?.email ?? "your email"}</span>
          {bonus > 0 ? (
            <>
              {" "}
              to unlock <span className="font-semibold">+{bonus} ✦</span> and ordering.
            </>
          ) : (
            <> to unlock ordering.</>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={resending}
        className="flex shrink-0 items-center gap-1 rounded-full bg-white/70 px-2.5 py-1 font-semibold text-accent-800 ring-1 ring-inset ring-accent-200 transition hover:bg-white disabled:opacity-50"
      >
        <RefreshCw className={resending ? "size-3 animate-spin" : "size-3"} />
        Resend email
      </button>
    </div>
  );
}
