"use client";

/** The age a portrait is drawn at, confirmed or typed beside the person. */
import { useEffect, useState } from "react";
import type { Project, StoryCastMember } from "../../../core/types";
import { CharacterAvatar } from "../book/CharacterAvatar";
import { setCastMemberAge } from "../bookActions";
import { useGuideT } from "../intl";

export function PortraitAgeRow({
  project,
  member,
  label,
}: {
  project: Project;
  member: StoryCastMember;
  /** Shown instead of the avatar and name, when the card already names the person. */
  label?: string;
}) {
  const t = useGuideT("chrome");
  const months =
    member.ageMonths !== undefined &&
    member.ageMonths < 24 &&
    member.age === undefined;
  const value = months
    ? member.ageMonths
    : member.age ?? member.visualAge?.years;
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));

  useEffect(() => {
    setDraft(value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > (months ? 36 : 120)) {
      setDraft(value === undefined ? "" : String(value));
      return;
    }
    // The story follows: where it states another age for this person, it is revised to match.
    void setCastMemberAge(member.id, months ? { ageMonths: parsed, age: undefined } : { age: parsed, ageMonths: undefined });
  };

  return (
    <div className="flex items-center gap-2.5">
      {label ? (
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-600">{label}</span>
      ) : (
        <>
          <CharacterAvatar
            project={project}
            characterId={member.id}
            name={member.name}
            className="size-9 text-xs"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">
            {member.name}
          </span>
        </>
      )}
      {member.visualAge && member.age === undefined && member.ageMonths === undefined && (
        <span className="rounded-full bg-magic-50 px-2 py-1 text-[10px] font-medium text-magic-700">
          {t("estimated")}
        </span>
      )}
      <label className="flex items-center rounded-lg border border-ink-200 bg-white px-2 py-1 shadow-xs focus-within:border-ink-400 focus-within:ring-2 focus-within:ring-ink-200">
        <span className="sr-only">{t("ageFor", { name: member.name })}</span>
        <input
          type="number"
          min={0}
          max={months ? 36 : 120}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="w-8 bg-transparent text-right text-sm font-semibold tabular-nums text-ink-900 outline-none"
        />
        <span className="ml-1 text-[10px] text-ink-400">
          {months ? t("monthsShort") : t("yearsShort")}
        </span>
      </label>
    </div>
  );
}
