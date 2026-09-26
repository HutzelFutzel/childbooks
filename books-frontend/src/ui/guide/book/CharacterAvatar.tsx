"use client";

import { UserRound } from "lucide-react";
import { currentPortrait } from "../../../core/guide/portrait";
import type { Project } from "../../../core/types";
import { useBlobUrl } from "../../hooks/useBlobUrl";
import { cn } from "../../lib/cn";

export function characterAvatarBlobId(
  project: Project,
  characterId: string,
): string | undefined {
  const portrait = currentPortrait(project, characterId);
  if (portrait?.blobId) return portrait.blobId;
  const member = project.config.storyBrief?.cast?.find(
    (candidate) => candidate.id === characterId,
  );
  return member?.sourceArt?.[0]?.blobId;
}

export function CharacterAvatar({
  project,
  characterId,
  name,
  className,
}: {
  project: Project;
  characterId: string;
  name: string;
  className?: string;
}) {
  const imageUrl = useBlobUrl(characterAvatarBlobId(project, characterId));
  const initial = name.trim().charAt(0).toLocaleUpperCase();

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#eee8de] font-display font-semibold text-ink-500 shadow-sm ring-1 ring-ink-900/10",
        className,
      )}
      aria-label={name}
      title={name}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="size-full object-cover object-top" />
      ) : initial ? (
        <span aria-hidden>{initial}</span>
      ) : (
        <UserRound className="size-1/2" aria-hidden />
      )}
    </span>
  );
}
