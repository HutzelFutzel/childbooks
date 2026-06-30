import { useEffect, useState } from "react";
import { MailCheck, RefreshCw, LogOut } from "lucide-react";
import { authErrorMessage, useAuthStore, userLabel } from "../../state/authStore";
import { Button } from "../components/Button";
import { notify } from "../lib/notify";

/**
 * Full-screen gate shown to signed-in users whose email isn't verified yet.
 * Generation and the studio stay locked until they confirm their address.
 *
 * `emailVerified` doesn't update on its own after the user clicks the link, so
 * we poll `refreshUser()` (which calls `user.reload()`) on an interval and offer
 * a manual "I've verified" button. Once verified, `accessLevel` flips to "full"
 * and this gate unmounts.
 */
export function VerifyEmailGate() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  // Auto-poll for verification so the gate clears without a manual refresh.
  useEffect(() => {
    const id = setInterval(() => void refreshUser(), 4000);
    return () => clearInterval(id);
  }, [refreshUser]);

  const check = async () => {
    setChecking(true);
    try {
      await refreshUser();
      if (!useAuthStore.getState().user?.emailVerified) {
        notify.info("Not verified yet", "Click the link in your email, then try again.");
      }
    } finally {
      setChecking(false);
    }
  };

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

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-soft ring-1 ring-ink-100">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600">
          <MailCheck className="size-7" />
        </span>
        <h1 className="mt-5 text-xl font-bold text-ink-900">Verify your email</h1>
        <p className="mt-2 text-sm text-ink-500">
          We sent a verification link to{" "}
          <span className="font-medium text-ink-700">{user?.email ?? "your email"}</span>. Open it to
          unlock the studio.
        </p>

        <div className="mt-6 space-y-2">
          <Button
            className="w-full"
            size="lg"
            loading={checking}
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => void check()}
          >
            I've verified — continue
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            loading={resending}
            onClick={() => void resend()}
          >
            Resend email
          </Button>
        </div>

        <button
          onClick={() => void signOutUser()}
          className="mx-auto mt-6 flex items-center gap-1.5 text-xs font-medium text-ink-400 transition hover:text-ink-600"
        >
          <LogOut className="size-3.5" />
          Sign out ({userLabel(user)})
        </button>
      </div>
    </div>
  );
}
