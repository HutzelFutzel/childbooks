"use client";

import { Image as ImageIcon, LogOut, User as UserIcon } from "lucide-react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { useAuthStore, userLabel } from "../../state/authStore";
import { useAccountUiStore } from "../../state/accountUiStore";
import { usePreferredImageTier, setPreferredImageTier } from "../../state/imageTier";
import { ImageTierPicker } from "./ImageTierPicker";

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <header className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
          {hint && <p className="text-xs text-ink-500">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * The user Settings modal. Currently centered on the image quality tier — the
 * user's default "Fast" vs "High-Quality" choice — plus quick account access
 * (who you're signed in as + sign out). Opened from the account dropdown.
 */
export function SettingsDialog() {
  const open = useAccountUiStore((s) => s.settingsOpen);
  const close = useAccountUiStore((s) => s.closeSettings);
  const user = useAuthStore((s) => s.user);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const tier = usePreferredImageTier();

  return (
    <Modal open={open} onClose={close} title="Settings" size="max-w-lg">
      <div className="space-y-6">
        <Section
          icon={<ImageIcon className="size-4" />}
          title="Image quality"
          hint="Applies to every image you generate. You can switch anytime — even per image."
        >
          {tier === null && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
              You haven&apos;t picked a default yet. Choose one below — you&apos;ll be able to change
              it here or right on any generate button.
            </p>
          )}
          <ImageTierPicker value={tier} onChange={(t) => void setPreferredImageTier(t)} />
        </Section>

        {user && !user.isAnonymous && (
          <Section icon={<UserIcon className="size-4" />} title="Account">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-800">{userLabel(user)}</p>
                {user.email && <p className="truncate text-xs text-ink-500">{user.email}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<LogOut className="size-4" />}
                onClick={() => {
                  close();
                  void signOutUser();
                }}
              >
                Sign out
              </Button>
            </div>
          </Section>
        )}
      </div>
    </Modal>
  );
}
