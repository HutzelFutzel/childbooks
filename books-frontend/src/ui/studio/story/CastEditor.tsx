"use client";

import { Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import type { StoryCastMember } from "../../../core/types";
import { newCastMember } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { cn } from "../../lib/cn";

/**
 * The real people in the book.
 * Optimized with space-awareness so it fits comfortably in narrow sidebars and responsive viewports.
 */
export function CastEditor({
  cast,
  onChange,
}: {
  cast: StoryCastMember[];
  onChange: (cast: StoryCastMember[]) => void;
}) {
  const rows = cast.length > 0 ? cast : [newCastMember()];

  const patch = (id: string, next: Partial<StoryCastMember>) =>
    onChange(rows.map((c) => (c.id === id ? { ...c, ...next } : c)));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-1 px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Who is in the story?
        </span>
        <span className="text-[10.5px] font-medium text-ink-400">
          First person is the hero
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((member, i) => (
          <div
            key={member.id}
            className="flex flex-col gap-2 rounded-2xl bg-white/80 p-2.5 ring-1 ring-ink-100 shadow-2xs transition focus-within:ring-brand-300"
          >
            {/* Top Row: Hero icon / badge + Name (flex-1) + Age + Remove */}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                  i === 0 ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500",
                )}
                title={i === 0 ? "Main Hero" : `Person ${i + 1}`}
                aria-hidden
              >
                {i === 0 ? <Sparkles className="size-3.5" /> : <UserRound className="size-3.5" />}
              </span>

              <Input
                value={member.name}
                onChange={(e) => patch(member.id, { name: e.target.value })}
                placeholder={i === 0 ? "Hero name (e.g. Amanda)" : "Name"}
                maxLength={40}
                aria-label={`Name ${i + 1}`}
                className="h-8.5 min-w-0 flex-1 text-xs"
              />

              <Input
                type="number"
                min={0}
                max={120}
                value={member.age ?? ""}
                onChange={(e) =>
                  patch(member.id, {
                    age: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="Age"
                aria-label={`Age of ${member.name || `person ${i + 1}`}`}
                className="h-8.5 w-16 text-xs text-center shrink-0"
              />

              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((c) => c.id !== member.id))}
                  title="Remove person"
                  aria-label={`Remove ${member.name || `person ${i + 1}`}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            {/* Bottom Row: Who they are (Role / Relationship description) */}
            <div className="pl-8.5">
              <Input
                value={member.role ?? ""}
                onChange={(e) => patch(member.id, { role: e.target.value })}
                placeholder={
                  i === 0
                    ? "Who they are (e.g. the birthday girl)"
                    : "Who they are (e.g. twin brother, pet dog)"
                }
                maxLength={80}
                aria-label={`Who ${member.name || `person ${i + 1}`} is`}
                className="h-8 text-xs bg-ink-50/50 border-ink-100 placeholder:text-ink-300"
              />
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="size-3.5" />}
        className="text-xs h-8"
        onClick={() => onChange([...rows, newCastMember()])}
      >
        Add someone
      </Button>
    </div>
  );
}
