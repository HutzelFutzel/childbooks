"use client";

/**
 * Everyone's age for the pictures, asked before any portrait. Estimates are
 * filled in and can be changed; whoever has none is left blank and asked.
 * Twins move together: changing one changes the other until the reader types
 * a different age for them. Nothing is saved until the reader agrees.
 */
import { useChatStudio } from "../../../state/chatStudio";
import { useWellDraft } from "../../../state/wellDrafts";
import { useGuideT } from "../intl";

export function CastAgesWell({
  people,
}: {
  people: { id: string; name: string; years?: number; mates?: string[] }[];
}) {
  const t = useGuideT("chrome");
  const tap = useChatStudio((s) => s.tap);
  const confirmCastAges = useChatStudio((s) => s.confirmCastAges);
  const [drafts, setDrafts, clearDrafts] = useWellDraft<Record<string, string>>("castAges", {});

  const firstBlank = people.find((person) => person.years === undefined)?.id;
  const valueOf = (person: (typeof people)[number]): string =>
    drafts[person.id] ?? (person.years !== undefined ? String(person.years) : "");
  const parsed = people.map((person) => {
    const years = Number.parseInt(valueOf(person), 10);
    const ok = Number.isInteger(years) && years >= 0 && years <= 120;
    return { id: person.id, name: person.name, years, ok };
  });
  const ready = parsed.every((person) => person.ok);

  const edit = (id: string, value: string) => {
    const mates = people.find((person) => person.id === id)?.mates ?? [];
    const next = { ...drafts, [id]: value };
    for (const mate of mates) if (drafts[mate] === undefined || drafts[mate] === drafts[id]) next[mate] = value;
    setDrafts(next);
  };

  const confirm = () => {
    if (!ready) return;
    const label = parsed.length === 1 ? t("ageSetOne", { name: parsed[0]!.name, n: parsed[0]!.years }) : t("useTheseAges");
    void tap(
      label,
      async () => {
        await confirmCastAges(parsed.map((person) => ({ id: person.id, years: person.years })));
        clearDrafts();
      },
      { undoable: true },
    );
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {parsed.map((person, index) => (
        <div key={person.id} className="flex items-center gap-2.5">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{person.name}</span>
          <label className="flex items-center rounded-lg border border-ink-200 bg-white px-2 py-1 shadow-xs focus-within:border-ink-400 focus-within:ring-2 focus-within:ring-ink-200">
            <span className="sr-only">{t("ageFor", { name: person.name })}</span>
            <input
              type="number"
              min={0}
              max={120}
              inputMode="numeric"
              value={valueOf(people[index]!)}
              placeholder="?"
              autoFocus={person.id === firstBlank}
              onChange={(event) => edit(person.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirm();
                }
              }}
              className="w-10 bg-transparent text-right text-sm font-semibold tabular-nums text-ink-900 outline-none"
            />
            <span className="ml-1 text-[10px] text-ink-400">{t("yearsShort")}</span>
          </label>
        </div>
      ))}
      <button
        type="button"
        disabled={!ready}
        onClick={confirm}
        className="mt-1 inline-flex min-h-9 items-center self-start rounded-full bg-ink-900 px-3.5 text-[13px] font-medium text-white transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-500"
      >
        {t("useTheseAges")}
      </button>
    </div>
  );
}
