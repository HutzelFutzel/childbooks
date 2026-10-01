"use client";

/**
 * Story options: what parents can shape before the Chat writes the story, and
 * whether it waits for them. Code owns what each choice means and how the
 * story uses it (`core/guide/storyDetails.ts`); this decides only the policy.
 */
import { RotateCcw } from "lucide-react";
import {
  createDefaultGuideBriefConfig,
  describeBriefPolicy,
  offeredDetails,
  askedDetails,
  type BriefStart,
  type GuideBriefConfig,
  type StoryDetailPolicy,
} from "../../../../core/guide/briefPolicy";
import { STORY_DETAIL_GROUPS, STORY_DETAIL_IDS, STORY_DETAILS, type StoryDetailId } from "../../../../core/guide/storyDetails";
import { Button } from "../../../components/Button";
import { cn } from "../../../lib/cn";
import { ImpactNote, Section } from "../products/parts";

const STARTS: { value: BriefStart; label: string; detail: string }[] = [
  {
    value: "wait",
    label: "When the parent says go",
    detail:
      "After names and ages, parents see a “Shape the story” card with the choices below and a Write the story button. Nothing is written until they tap it or say so.",
  },
  {
    value: "auto",
    label: "Right away",
    detail:
      "The story starts as soon as names and ages are known and any Ask questions are answered. Parents can still mention details in the chat, and those are used.",
  },
];

const POLICIES: { value: StoryDetailPolicy; label: string; detail: string }[] = [
  { value: "off", label: "Off", detail: "Not on the card. If a parent mentions it anyway, the story still uses it." },
  { value: "offer", label: "Offer", detail: "A tap-to-choose option on the card. Parents can ignore it." },
  { value: "ask", label: "Ask", detail: "On the card, and the guide asks about it once before writing. Parents can skip." },
];

/** More questions than this before the story starts begins to feel like a form. */
const ASK_COMFORT = 2;

export function GuideStoryPanel({
  brief,
  onChange,
  readOnly,
}: {
  brief: GuideBriefConfig;
  onChange: (next: GuideBriefConfig) => void;
  readOnly: boolean;
}) {
  const setDetail = (id: StoryDetailId, policy: StoryDetailPolicy) =>
    onChange({ ...brief, details: { ...brief.details, [id]: policy } });
  const asked = askedDetails(brief);
  const offered = offeredDetails(brief);
  const isDefault = JSON.stringify(brief) === JSON.stringify(createDefaultGuideBriefConfig());

  return (
    <div className="space-y-8">
      <Section
        title="When the story starts"
        hint="What happens once the Chat knows who the book is for."
        action={
          !readOnly && !isDefault ? (
            <Button variant="ghost" size="sm" onClick={() => onChange(createDefaultGuideBriefConfig())}>
              <RotateCcw className="size-3.5" />
              Reset to defaults
            </Button>
          ) : null
        }
      >
        <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="When the story starts">
          {STARTS.map((option) => {
            const on = brief.start === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={readOnly}
                onClick={() => onChange({ ...brief, start: option.value })}
                className={cn(
                  "rounded-xl bg-white p-3.5 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:cursor-default",
                  on ? "ring-2 ring-ink-900" : "ring-ink-100 enabled:hover:ring-ink-300",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full ring-1",
                      on ? "bg-ink-900 ring-ink-900" : "ring-ink-300",
                    )}
                    aria-hidden
                  >
                    {on && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-sm font-semibold text-ink-900">{option.label}</span>
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-ink-500">{option.detail}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Story choices"
        hint="What parents can pick before the story is written. Everything is optional for them."
      >
        <dl className="grid gap-x-4 gap-y-1 rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-600 sm:grid-cols-3">
          {POLICIES.map((policy) => (
            <div key={policy.value}>
              <dt className="font-semibold text-ink-800">{policy.label}</dt>
              <dd className="leading-relaxed">{policy.detail}</dd>
            </div>
          ))}
        </dl>
        {brief.start === "auto" && asked.length === 0 && offered.length > 0 && (
          <ImpactNote>
            With “Right away” and no Ask questions, the story starts immediately, so parents never see the card. Offered
            choices only appear while an Ask question is open.
          </ImpactNote>
        )}
        {asked.length > ASK_COMFORT && (
          <ImpactNote>
            {asked.length} questions come before the story. More than {ASK_COMFORT} can start to feel like a form; Offer
            keeps a choice on the card without asking.
          </ImpactNote>
        )}
        <div className="overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
          {STORY_DETAIL_GROUPS.map((group, groupIndex) => {
            const ids = STORY_DETAIL_IDS.filter((id) => STORY_DETAILS[id].group === group.id);
            if (ids.length === 0) return null;
            return (
              <div key={group.id} className={cn(groupIndex > 0 && "border-t border-ink-100")}>
                <p className="bg-ink-50/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {group.label}
                </p>
                {ids.map((id) => (
                  <DetailRow
                    key={id}
                    id={id}
                    policy={brief.details[id]}
                    readOnly={readOnly}
                    onChange={(policy) => setDetail(id, policy)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </Section>

      <div className="space-y-2 rounded-lg bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
        <p>
          <span className="font-semibold text-ink-800">What parents see: </span>
          {describeBriefPolicy(brief)}
        </p>
        {offered.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Card preview">
            {offered.map((id) => (
              <span key={id} className="rounded-full bg-white px-2.5 py-1 text-[11px] text-ink-700 ring-1 ring-ink-200">
                {STORY_DETAILS[id].label}
                {brief.details[id] === "ask" && <span className="text-ink-400"> · asked</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  id,
  policy,
  readOnly,
  onChange,
}: {
  id: StoryDetailId;
  policy: StoryDetailPolicy;
  readOnly: boolean;
  onChange: (policy: StoryDetailPolicy) => void;
}) {
  const def = STORY_DETAILS[id];
  return (
    <div className="grid gap-2 border-t border-ink-100 px-4 py-3 first-of-type:border-t-0 md:grid-cols-[1fr_auto] md:items-center md:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-900">{def.label}</p>
        <p className="text-xs leading-relaxed text-ink-500">{def.effect}</p>
        {policy === "ask" && (
          <p className="mt-1 text-[11px] text-ink-400">
            The guide asks: “{def.question.replace(/\{names\}/g, "Maya")}”
          </p>
        )}
      </div>
      <div
        className="inline-flex w-fit rounded-full bg-ink-100/70 p-0.5"
        role="radiogroup"
        aria-label={`${def.label}: off, offer or ask`}
      >
        {POLICIES.map((option) => {
          const on = policy === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={option.detail}
              disabled={readOnly}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:cursor-default",
                on ? "bg-white text-ink-900 shadow-soft" : "text-ink-500 enabled:hover:text-ink-800",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
