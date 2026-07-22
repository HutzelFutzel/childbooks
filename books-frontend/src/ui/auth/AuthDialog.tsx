import { useEffect, useState } from "react";
import { AlertCircle, BookHeart, LogIn, Mail, Sparkles, UserPlus } from "lucide-react";
import { authErrorMessage, useAuthStore } from "../../state/authStore";
import { useAppConfigStore } from "../../state/appConfigStore";
import { Button } from "../components/Button";
import { Field, Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { PasswordStrength, scorePassword } from "./PasswordStrength";

type Mode = "signin" | "signup";

export function AuthDialog() {
  const open = useAuthStore((s) => s.dialogOpen);
  const closeAuthDialog = useAuthStore((s) => s.closeAuthDialog);
  const signInEmail = useAuthStore((s) => s.signInEmail);
  const signUpEmail = useAuthStore((s) => s.signUpEmail);
  const signInGoogle = useAuthStore((s) => s.signInGoogle);
  const isGuest = useAuthStore((s) => s.accessLevel === "guest");
  const sparks = useAppConfigStore((s) => s.sparks);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "email" | "google">(null);
  const [error, setError] = useState<string | null>(null);

  // Guests are here to UPGRADE (keep their drafts + earn the ladder bonuses),
  // so open on "create account"; everyone else most likely wants to sign in.
  useEffect(() => {
    if (open) {
      setMode(isGuest ? "signup" : "signin");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const signupBonus = sparks.enabled ? sparks.grants.signupBonusSparks : 0;
  const verifyBonus = sparks.enabled ? sparks.grants.verifyBonusSparks : 0;

  const close = () => {
    setError(null);
    closeAuthDialog();
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const run = async (kind: "email" | "google", fn: () => Promise<void>) => {
    setError(null);
    setBusy(kind);
    try {
      await fn();
      close();
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      // Trying to sign up with an existing email → guide them to sign in.
      if (
        mode === "signup" &&
        (code === "auth/email-already-in-use" ||
          code === "auth/account-exists-with-different-credential")
      ) {
        setMode("signin");
      }
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "signup" && scorePassword(password) === 0) {
      setError("Password should be at least 6 characters.");
      return;
    }
    void run("email", () =>
      mode === "signin" ? signInEmail(email, password) : signUpEmail(email, password),
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={mode === "signin" ? "Sign in" : isGuest ? "Keep your storybook" : "Create account"}
      size="max-w-md"
    >
      {/* The upgrade pitch: guests aren't "signing up", they're keeping the
          book they already made — and pocketing the ladder bonuses. */}
      {mode === "signup" && isGuest && (
        <div className="mb-4 space-y-1.5 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-ink-700">
          <p className="flex items-center gap-2">
            <BookHeart className="size-4 shrink-0 text-brand-600" />
            Your storybook and Sparks come with you — nothing is lost.
          </p>
          {signupBonus > 0 && (
            <p className="flex items-center gap-2">
              <Sparkles className="size-4 shrink-0 text-magic-500" />
              <span>
                Get <span className="font-semibold text-brand-700">+{signupBonus} ✦</span> instantly
                {verifyBonus > 0 && <> — and +{verifyBonus} ✦ more when you verify your email</>}.
              </span>
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={submitEmail} className="space-y-4">
        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError(null);
            }}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="••••••••"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
          />
          {mode === "signup" && <PasswordStrength password={password} />}
        </Field>

        <Button
          type="submit"
          className="w-full"
          loading={busy === "email"}
          leftIcon={mode === "signin" ? <LogIn className="size-4" /> : <UserPlus className="size-4" />}
        >
          {mode === "signin" ? "Sign in" : "Create free account"}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-ink-400">
        <span className="h-px flex-1 bg-ink-200" /> or <span className="h-px flex-1 bg-ink-200" />
      </div>

      <div className="space-y-2">
        <Button
          variant="secondary"
          className="w-full"
          loading={busy === "google"}
          leftIcon={<Mail className="size-4" />}
          onClick={() => void run("google", signInGoogle)}
        >
          Continue with Google
        </Button>
      </div>

      <p className="mt-4 text-center text-sm text-ink-500">
        {mode === "signin" ? "Don't have an account?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="font-medium text-brand-600 hover:underline"
          onClick={() => switchMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </Modal>
  );
}
