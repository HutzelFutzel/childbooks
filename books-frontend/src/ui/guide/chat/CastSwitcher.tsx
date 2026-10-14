"use client";

/**
 * Who the looks card is about, and a way to go to anyone else.
 *
 * The chat asks one person's look at a time, but the reader is never held to
 * that order: tapping a name opens that person's choices in place (a settled
 * look opens on what was chosen, and changing it touches nobody else). The
 * person the card is about is marked, and a check says whose look is settled.
 * Shown only when there is more than one person and something to go back to.
 */
import { Check } from "lucide-react";
import { lookDecided, portraitSubjects } from "../../../core/guide/portrait";
import type { Project } from "../../../core/types";
import { useChatStudio } from "../../../state/chatStudio";
import { cn } from "../../lib/cn";
import { CharacterAvatar } from "../book/CharacterAvatar";
import { useGuideT } from "../intl";

export function CastSwitcher({
  project,
  currentId,
  offeredId,
}: {
  project: Project;
  /** The person whose choices are showing now. */
  currentId: string;
  /** The person the chat asked about; selecting them again drops the chip. */
  offeredId: string;
}) {
  const t = useGuideT("looks");
  const setChip = useChatStudio((s) => s.setChip);
  const people = portraitSubjects(project);
  if (people.length < 2 || !people.some((member) => lookDecided(project, member))) return null;

  return (
    <div role="group" aria-label={t("switchLabel")} className="flex flex-wrap items-center gap-1.5">
      <span className="px-0.5 text-xs font-medium text-ink-500">{t("switchLabel")}</span>
      {people.map((member) => {
        const name = member.name.trim();
        const decided = lookDecided(project, member);
        const current = member.id === currentId;
        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={current}
            aria-label={t(decided ? "switchDone" : "switchOpen", { name })}
            onClick={() => setChip(member.id === offeredId ? null : { kind: "person", castId: member.id, name })}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[13px] font-medium ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400",
              current ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-800 ring-ink-200 hover:ring-ink-400",
            )}
          >
            <CharacterAvatar project={project} characterId={member.id} name={name} className="size-6 text-[10px]" />
            <span className="max-w-[8rem] truncate">{name}</span>
            {decided && <Check className={cn("size-3.5", current ? "text-white/80" : "text-emerald-600")} aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
