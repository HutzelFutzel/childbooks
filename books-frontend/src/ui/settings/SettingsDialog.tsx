"use client";

import { useState } from "react";
import {
  Image as ImageIcon,
  LogOut,
  MessageSquareHeart,
  User as UserIcon,
} from "lucide-react";
import { Modal } from "../components/Modal";
import { Button } from "../components/Button";
import { useAuthStore, userLabel, userSecondaryLine } from "../../state/authStore";
import { useAccountUiStore } from "../../state/accountUiStore";
import { usePreferredImageTier, setPreferredImageTier } from "../../state/imageTier";
import { useProfileStore } from "../../state/profileStore";
import { setSurveyOptOut } from "../../platform/surveys";
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
 * Whether we may ask the occasional question after a purchase.
 *
 * The same preference the card's "don't ask again" sets, surfaced here so it's
 * reversible and discoverable rather than a one-way trapdoor somebody has to
 * regret. Written through the backend route, which is the single writer of the
 * field — two writers to something that silences a whole feature is how it comes
 * back on by accident.
 */
function SurveyPreference() {
  const optedOut = useProfileStore(
    (s) => s.profile?.preferences?.surveyOptOut === true,
  );
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    // No optimistic flip: the profile subscription pushes the new value, and a
    // switch that snaps back after a failed write is worse than one that waits.
    await setSurveyOptOut({ optOut: !optedOut });
    setBusy(false);
  };

  return (
    <Section
      icon={<MessageSquareHeart className="size-4" />}
      title="Occasional questions"
      hint="After a purchase we sometimes ask a question or two about who the book was for. Always optional."
    >
      <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/60 px-3 py-2.5">
        <p className="min-w-0 text-sm text-ink-600">
          {optedOut
            ? "You've asked us not to. We won't."
            : "Fine to ask now and then."}
        </p>
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() => void toggle()}
        >
          {optedOut ? "Allow again" : "Stop asking"}
        </Button>
      </div>
    </Section>
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

  return (
    <Modal open={open} onClose={close} title="Settings" size="max-w-lg">
      <SettingsContent onSignedOut={close} />
    </Modal>
  );
}

/** Route-friendly settings body shared with the legacy modal entry point. */
export function SettingsContent({ onSignedOut }: { onSignedOut?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const signOutUser = useAuthStore((s) => s.signOutUser);
  const tier = usePreferredImageTier();
  const profileLoaded = useProfileStore((s) => s.profileLoaded);

  return (
    <div className="space-y-6">
      <Section
        icon={<ImageIcon className="size-4" />}
        title="Image quality"
        hint="Applies to every image you generate. You can switch anytime — even per image."
      >
        {profileLoaded && tier === null && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            You haven&apos;t picked a default yet. Choose one below — you&apos;ll be able to change
            it here or right on any generate button.
          </p>
        )}
        <ImageTierPicker value={tier} onChange={(t) => void setPreferredImageTier(t)} />
      </Section>

      {user && !user.isAnonymous && <SurveyPreference />}

      {user && !user.isAnonymous && (
        <Section icon={<UserIcon className="size-4" />} title="Account">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-800">{userLabel(user)}</p>
              {userSecondaryLine(user) && (
                <p className="truncate text-xs text-ink-500">{userSecondaryLine(user)}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<LogOut className="size-4" />}
              onClick={() => {
                onSignedOut?.();
                void signOutUser();
              }}
            >
              Sign out
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}
