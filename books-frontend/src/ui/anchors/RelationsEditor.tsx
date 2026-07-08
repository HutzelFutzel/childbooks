import { Link2, Plus } from "lucide-react";
import type { Anchor } from "../../core/types";
import { suggestLinkedAnchors } from "../../state/ai";

type RelField = "containedIds" | "relatedIds";

/**
 * Explicit, id-based relationship editor for an anchor. Lets the user declare
 * which other anchors this one CONTAINS (places/objects) or RELATES to / resembles.
 * Replaces fragile name-matching so the dependency & staleness graphs only follow
 * links the user actually created. Offers one-click suggestions from the text.
 */
export function RelationsEditor({
  anchor,
  all,
  onChange,
}: {
  anchor: Anchor;
  all: Anchor[];
  onChange: (patch: Partial<Anchor>) => void;
}) {
  const others = all.filter((a) => a.id !== anchor.id);
  if (others.length === 0) return null;

  const canContain = anchor.type !== "character";
  const contained = new Set(anchor.containedIds ?? []);
  const related = new Set(anchor.relatedIds ?? []);
  const suggestions = suggestLinkedAnchors(anchor, all);

  // Containment is limited to ONE level: nesting a parent inside another parent
  // (grandchildren) can't be rendered faithfully — the model would have to match
  // a reference-inside-a-reference. Chips that would create depth 2 are
  // disabled with an explanation (already-selected ones stay removable).
  const isContainedElsewhere = others.some((o) => (o.containedIds ?? []).includes(anchor.id));
  const containDisabledReason = (o: Anchor): string | null => {
    if (contained.has(o.id)) return null; // always allow unselecting
    if ((o.containedIds ?? []).length > 0)
      return `${o.name} already contains other subjects — nested containers can't be matched reliably.`;
    if (isContainedElsewhere)
      return `${anchor.name} is itself contained in another subject — only one level of nesting is supported.`;
    return null;
  };

  function toggle(field: RelField, id: string) {
    const set = new Set(anchor[field] ?? []);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange({ [field]: [...set] });
  }

  function addSuggestion(field: RelField, id: string) {
    const set = new Set(anchor[field] ?? []);
    set.add(id);
    onChange({ [field]: [...set] });
  }

  return (
    <div className="space-y-4 border-t border-ink-100 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-ink-700">
        <Link2 className="size-4" /> Relationships
      </div>

      {suggestions.length > 0 && (
        <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <p className="text-xs text-brand-800">
            Mentioned in the description — link so they stay consistent:
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center overflow-hidden rounded-md border border-brand-200 bg-white text-xs">
                <span className="px-2 py-1 font-medium text-ink-700">{s.name}</span>
                {canContain && s.type !== "character" && !containDisabledReason(s) && (
                  <button
                    type="button"
                    onClick={() => addSuggestion("containedIds", s.id)}
                    className="border-l border-brand-200 px-2 py-1 text-brand-600 hover:bg-brand-50"
                    title="Add as contained"
                  >
                    Contains
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => addSuggestion("relatedIds", s.id)}
                  className="border-l border-brand-200 px-2 py-1 text-brand-600 hover:bg-brand-50"
                  title="Add as related"
                >
                  Relates
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {canContain && (
        <>
          <RelationGroup
            label="Contains"
            hint="Subjects physically inside this one (drawn here, matched exactly)."
            options={others}
            selected={contained}
            onToggle={(id) => toggle("containedIds", id)}
            disabledReason={containDisabledReason}
          />
          {contained.size > 3 && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
              With more than 3 embedded subjects, each one gets matched less accurately. For best
              results keep the 2–3 most important ones here and describe the rest in the text.
            </p>
          )}
        </>
      )}

      <RelationGroup
        label="Relates to / resembles"
        hint="Context only (e.g. a sibling to match traits) — not drawn as a separate figure."
        options={others}
        selected={related}
        onToggle={(id) => toggle("relatedIds", id)}
      />
    </div>
  );
}

function RelationGroup({
  label,
  hint,
  options,
  selected,
  onToggle,
  disabledReason,
}: {
  label: string;
  hint: string;
  options: Anchor[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  /** When set and returning a string, that chip is disabled with the reason as tooltip. */
  disabledReason?: (option: Anchor) => string | null;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-600">{label}</p>
      <p className="mb-2 text-[11px] text-ink-400">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.has(o.id);
          const reason = disabledReason?.(o) ?? null;
          return (
            <button
              key={o.id}
              type="button"
              disabled={Boolean(reason)}
              title={reason ?? undefined}
              onClick={() => onToggle(o.id)}
              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                on
                  ? "border-brand-400 bg-brand-100 text-brand-700"
                  : reason
                    ? "cursor-not-allowed border-ink-100 text-ink-300"
                    : "border-ink-200 text-ink-500 hover:border-ink-300"
              }`}
            >
              {!on && <Plus className="size-3" />}
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
