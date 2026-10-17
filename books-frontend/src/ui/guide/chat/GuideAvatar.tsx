"use client";

import { useAppConfigStore } from "../../../state/appConfigStore";
import { cn } from "../../lib/cn";

/**
 * The guide character's identity in the chat: uses the admin-configured
 * avatar (`branding.guideAvatar`) and name (`guide.agent.persona.name`),
 * falling back to a warm storybook hedgehog illustration and "Guide".
 */
export function useGuideIdentity(): { name: string; avatarUrl: string | null } {
  const configuredName = useAppConfigStore((s) => s.guide.agent.persona.name);
  const avatarUrl = useAppConfigStore((s) => s.branding.guideAvatar?.imageUrl ?? null);
  const name = configuredName.trim() || "Guide";
  return { name, avatarUrl };
}

export function GuideAvatar({
  size = "sm",
  url,
  name,
  className,
}: {
  size?: "xs" | "sm" | "md" | "lg";
  /** Optional explicit URL override (e.g. for admin preview). */
  url?: string | null;
  /** Optional explicit name override. */
  name?: string;
  className?: string;
}) {
  const identity = useGuideIdentity();
  const avatarUrl = url !== undefined ? url : identity.avatarUrl;
  const label = name ?? identity.name;
  const dim =
    size === "xs"
      ? "size-6"
      : size === "sm"
        ? "size-8"
        : size === "md"
          ? "size-10"
          : "size-14";

  return (
    <span
      title={label}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-b from-amber-50 to-orange-100/90 shadow-[0_2px_6px_-1px_rgba(20,22,58,0.12),inset_0_1px_0_rgba(255,255,255,0.8)] ring-1 ring-amber-900/12",
        dim,
        className,
      )}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={label} className="size-full object-cover" />
      ) : (
        <HedgehogPlaceholder className="size-[84%]" />
      )}
    </span>
  );
}

/** Friendly storybook hedgehog placeholder when no admin photo is uploaded yet. */
export function HedgehogPlaceholder({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Warm quills crown */}
      <path
        d="M10 36C8 27 12 19 18 16L17 11L23 13C27 10 31 9 35 10L39 7L42 12C47 14 51 18 53 23L57 22L54 28C56 33 55 39 52 44C47 50 39 53 31 53C21 53 13 46 10 36Z"
        fill="#7C4D34"
      />
      <path
        d="M15 32C14 25 17 19 23 16C29 13 37 13 43 17C48 21 51 27 50 34C48 43 40 49 31 49C22 49 16 41 15 32Z"
        fill="#9A6344"
      />
      {/* Quill texture strokes */}
      <path
        d="M22 18L20 14M29 15L29 11M36 16L38 12M43 20L46 17M47 26L51 25"
        stroke="#5C3622"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Ears */}
      <circle cx="19" cy="26" r="5" fill="#D9A382" stroke="#7C4D34" strokeWidth="2" />
      <circle cx="19" cy="26" r="2.5" fill="#F2C6AE" />
      <circle cx="45" cy="26" r="5" fill="#D9A382" stroke="#7C4D34" strokeWidth="2" />
      <circle cx="45" cy="26" r="2.5" fill="#F2C6AE" />
      {/* Soft cream face */}
      <path
        d="M17 35C17 27.5 23 23 32 23C41 23 47 27.5 47 35C47 43.5 40.5 49 32 49C23.5 49 17 43.5 17 35Z"
        fill="#FCEAD8"
      />
      {/* Rosy cheeks */}
      <ellipse cx="22.5" cy="38.5" rx="3.2" ry="2" fill="#F99B82" fillOpacity="0.65" />
      <ellipse cx="41.5" cy="38.5" rx="3.2" ry="2" fill="#F99B82" fillOpacity="0.65" />
      {/* Friendly eyes with catchlights */}
      <circle cx="25.5" cy="34" r="2.6" fill="#232649" />
      <circle cx="24.7" cy="33.2" r="0.9" fill="#FFFFFF" />
      <circle cx="38.5" cy="34" r="2.6" fill="#232649" />
      <circle cx="37.7" cy="33.2" r="0.9" fill="#FFFFFF" />
      {/* Little button snout & smile */}
      <ellipse cx="32" cy="37.5" rx="2.7" ry="2" fill="#3D2317" />
      <ellipse cx="31.2" cy="36.9" rx="0.8" ry="0.5" fill="#8C5840" />
      <path
        d="M28.8 41.2C30 42.8 34 42.8 35.2 41.2"
        stroke="#5C3622"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
