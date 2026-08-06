"use client";

import { Plus, Trash2, UserRound } from "lucide-react";
import type { StoryCastMember } from "../../../core/types";
import { newCastMember } from "../../../core/story/brief";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { cn } from "../../lib/cn";

/**
 * The real people in the book. Roles are free text on purpose ("her twin
 * brother", "the neighbour's dog") — a fixed relationship dropdown can't
 * describe most families, and the model reads prose better than an enum.
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
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
          Who is in the story?
        </span>
        <span className="text-[11px] text-ink-400">
          · the first one is the hero
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((member, i) => (
          <div
            key={member.id}
            className="flex flex-col gap-2 rounded-2xl bg-white/70 p-2.5 ring-1 ring-ink-100 sm:flex-row sm:items-center"
          >
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-bold",
                i === 0 ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500",
              )}
              aria-hidden
            >
              <UserRound className="size-4" />
            </span>
            <Input
              value={member.name}
              onChange={(e) => patch(member.id, { name: e.target.value })}
              placeholder={i === 0 ? "Amanda" : "Another name"}
              maxLength={40}
              aria-label={`Name ${i + 1}`}
              className="sm:w-40"
            />
            <Input
              value={member.role ?? ""}
              onChange={(e) => patch(member.id, { role: e.target.value })}
              placeholder={i === 0 ? "the birthday girl" : "her twin brother"}
              maxLength={80}
              aria-label={`Who ${member.name || `person ${i + 1}`} is`}
              className="flex-1"
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
              className="sm:w-20"
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((c) => c.id !== member.id))}
              disabled={rows.length === 1}
              title="Remove"
              aria-label={`Remove ${member.name || `person ${i + 1}`}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-400"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        leftIcon={<Plus className="size-4" />}
        className="mt-1.5"
        onClick={() => onChange([...rows, newCastMember()])}
      >
        Add someone
      </Button>
    </div>
  );
}
