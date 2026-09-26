"use client";

/**
 * What the Chat must know before it writes the story, and what it does when
 * the reader never said it. Code owns what each fact means and how it is read
 * off the book; this decides only the policy.
 */
import {
  GUIDE_FACT_IDS,
  GUIDE_FACTS,
  type GuideFactPolicies,
  type GuideFactPolicy,
  type GuideFactUnsaid,
} from "../../../../core/guide/factPolicy";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Toggle";
import { cn } from "../../../lib/cn";

const UNSAID: { value: GuideFactUnsaid; label: string; detail: string }[] = [
  { value: "use", label: "Use it", detail: "Save the derived value and move on." },
  { value: "confirmOnce", label: "Say it once", detail: "Name the derived value once; continuing accepts it." },
  { value: "never", label: "Leave empty", detail: "Only what the reader said." },
];

export function GuideFactsPanel({
  facts,
  onChange,
  readOnly,
}: {
  facts: GuideFactPolicies;
  onChange: (next: GuideFactPolicies) => void;
  readOnly: boolean;
}) {
  const patch = (id: (typeof GUIDE_FACT_IDS)[number], change: Partial<GuideFactPolicy>) =>
    onChange({ ...facts, [id]: { ...facts[id], ...change } });

  const broad = GUIDE_FACT_IDS.filter((id) => facts[id].askInBroad).map((id) => GUIDE_FACTS[id].label.toLowerCase());

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
        <div className="hidden grid-cols-[1fr_6rem_8rem_10rem] gap-4 border-b border-ink-100 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400 md:grid">
          <span>Fact</span>
          <span>Required</span>
          <span>In the first question</span>
          <span>When unsaid</span>
        </div>
        {GUIDE_FACT_IDS.map((id, index) => {
          const info = GUIDE_FACTS[id];
          const policy = facts[id];
          return (
            <div
              key={id}
              className={cn(
                "grid gap-3 px-4 py-3.5 md:grid-cols-[1fr_6rem_8rem_10rem] md:items-center md:gap-4",
                index > 0 && "border-t border-ink-100",
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{info.label}</p>
                <p className="text-xs leading-relaxed text-ink-500">{info.help}</p>
              </div>
              <label className="flex items-center justify-between gap-2 md:justify-start">
                <span className="text-xs text-ink-500 md:hidden">Required</span>
                <Toggle
                  checked={policy.required}
                  disabled={readOnly}
                  onChange={(required) => patch(id, { required })}
                  label={`${info.label} required`}
                />
              </label>
              <label className="flex items-center justify-between gap-2 md:justify-start">
                <span className="text-xs text-ink-500 md:hidden">In the first question</span>
                <Toggle
                  checked={policy.askInBroad}
                  disabled={readOnly}
                  onChange={(askInBroad) => patch(id, { askInBroad })}
                  label={`Ask ${info.label} in the first question`}
                />
              </label>
              <div>
                <Select
                  value={info.derivable ? policy.whenUnsaid : "never"}
                  disabled={readOnly || !info.derivable}
                  options={UNSAID.filter((o) => info.derivable || o.value === "never").map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onChange={(event) => patch(id, { whenUnsaid: event.target.value as GuideFactUnsaid })}
                  className="h-9 text-xs"
                />
                <p className="mt-1 text-[11px] text-ink-400">
                  {info.derivable ? UNSAID.find((o) => o.value === policy.whenUnsaid)?.detail : "Nothing to derive it from."}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
        As set: the first question asks about{" "}
        <strong>{broad.length > 0 ? broad.join(", ") : "nothing in particular"}</strong>. The story starts on the
        answer that settles the last required fact, never on a timer.
      </p>
    </div>
  );
}
