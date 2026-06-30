import { useRouter } from "next/navigation";
import { LogOut, Shield, User as UserIcon } from "lucide-react";
import { useAuthStore, userLabel } from "../../state/authStore";
import { Button } from "../components/Button";

export function AuthMenu() {
  const user = useAuthStore((s) => s.user);
  const ready = useAuthStore((s) => s.ready);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const openAuthDialog = useAuthStore((s) => s.openAuthDialog);
  const router = useRouter();

  if (!ready) {
    return <div className="h-8 w-24 animate-pulse rounded-lg bg-ink-100" />;
  }

  const signedIn = Boolean(user) && !user?.isAnonymous;

  return (
    <div className="flex items-center gap-2">
      {signedIn && isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Shield className="size-4" />}
          onClick={() => router.push("/admin")}
        >
          Admin
        </Button>
      )}
      {user && (
        <span className="hidden items-center gap-1.5 rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 sm:flex">
          <UserIcon className="size-3.5" />
          {userLabel(user)}
        </span>
      )}
      {signedIn ? (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<LogOut className="size-4" />}
          onClick={() => void signOutUser()}
        >
          Sign out
        </Button>
      ) : (
        <Button variant="secondary" size="sm" onClick={openAuthDialog}>
          Sign in
        </Button>
      )}
    </div>
  );
}
