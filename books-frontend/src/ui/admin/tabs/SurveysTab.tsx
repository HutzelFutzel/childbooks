"use client";

/**
 * Admin editor for **profiling surveys** (`adminSettings/surveys`).
 *
 * The dashboard next door can tell you what people did and never who they are.
 * A print order doesn't say whether the book was for a grandchild or whether the
 * occasion had a deadline, and two accounts with identical revenue can need
 * completely different marketing. These questions close that gap, and the report
 * in Analysis → Customer profile is where the answers turn into money.
 *
 * The screen is arranged around the two ways this feature fails:
 *
 *   1. **Asking too much.** The card sits on a confirmation screen next to a
 *      download button and an invite prompt. Every extra question costs answers to
 *      the ones before it, so the estimated time to answer is shown next to the
 *      question list, sampling is a first-class field, and the schema refuses more
 *      than one required question.
 *   2. **Asking things you can't act on.** A question whose answers wouldn't change
 *      a decision is a question that spent a customer's goodwill for nothing.
 *      That's a judgement call the software can't make, so the copy here keeps
 *      pointing at it.
 *
 * A survey can be asked more than once, and that's the point of the third control
 * on every question: whether it repeats. "Who is this one for?" belongs on every
 * order — that series is how you learn that first books are for the buyer's own
 * children and later ones are gifts — while "how did you find us?" describes the
 * account and gets a worse answer the second time. The guard rails against the
 * obvious failure of all this (asking somebody three times in one evening because
 * they bought three books) are the two policy fields at the top, which apply across
 * every survey.
 */
import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/Button";
import { Field, Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import { useReadOnly } from "../../components/ReadOnlyContext";
import {
  BUYER_ROLES,
  BUYER_ROLE_LABELS,
  MAX_ASKS_PER_SURVEY,
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUESTIONS_PER_SURVEY,
  QUESTION_KINDS,
  QUESTION_KIND_HINTS,
  QUESTION_KIND_LABELS,
  SURVEY_ITEM_LABELS,
  SURVEY_ITEM_TYPES,
  createOption,
  createQuestion,
  createSurvey,
  describeAskPolicy,
  describeBuyerRoleCoverage,
  describeSurveyAudience,
  estimateSeconds,
  isChoiceQuestion,
  normalizeSurveysConfig,
  type BuyerRole,
  type Survey,
  type SurveyOption,
  type SurveyQuestion,
  type SurveyQuestionKind,
  type SurveysConfig,
} from "../../../core/config/surveys";
import {
  Disclosure,
  Grid,
  ImpactNote,
  NumberField,
  Section,
  TabIntro,
} from "./products/parts";
import { Chips, SwitchField } from "./campaigns/parts";

const KIND_OPTIONS = QUESTION_KINDS.map((value) => ({
  value,
  label: QUESTION_KIND_LABELS[value],
}));

const ITEM_OPTIONS = SURVEY_ITEM_TYPES.map((value) => ({
  value,
  label: SURVEY_ITEM_LABELS[value],
}));

/**
 * "Doesn't say" first and selected by default. The temptation with this control is
 * to tag every option so the report has no "couldn't tell" column, and the untagged
 * answer is often the honest one: "a friend's child" is picked both by parents
 * buying a gift and by people with no children, and there is nothing in the answer
 * to tell them apart.
 */
const ROLE_OPTIONS = [
  { value: "", label: "Doesn't say who's buying" },
  ...BUYER_ROLES.map((value) => ({
    value,
    label: `Buyer is a ${BUYER_ROLE_LABELS[value].toLowerCase()}`,
  })),
];

export function SurveysTab() {
  const readOnly = useReadOnly();
  const load = useAppConfigStore((s) => s.loadSurveysConfig);
  const save = useAppConfigStore((s) => s.saveSurveysConfig);
  const campaigns = useAppConfigStore((s) => s.campaigns);
  const setMarketingTab = useAdminTab((s) => s.setMarketingTab);
  const openAnalysis = useAdminTab((s) => s.openAnalysis);

  const [draft, setDraft] = useState<SurveysConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void load()
      .then((cfg) => {
        if (!live) return;
        setDraft(cfg);
        setSelectedId((id) => id ?? cfg.surveys[0]?.id ?? null);
      })
      .catch((err) =>
        toast.error(
          err instanceof Error ? err.message : "Could not load surveys.",
        ),
      );
    return () => {
      live = false;
    };
  }, [load]);

  if (!draft) return <p className="text-sm text-ink-400">Loading surveys…</p>;

  const selected = draft.surveys.find((s) => s.id === selectedId) ?? null;

  const setConfig = (patch: Partial<SurveysConfig>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const setSurvey = (id: string, patch: Partial<Survey>) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            surveys: d.surveys.map((s) =>
              s.id === id ? { ...s, ...patch } : s,
            ),
          }
        : d,
    );
    setDirty(true);
  };

  const addSurvey = () => {
    const survey = createSurvey();
    setConfig({ surveys: [...draft.surveys, survey] });
    setSelectedId(survey.id);
  };

  const duplicateSurvey = (source: Survey) => {
    // Fresh ids throughout. The survey id is what "already asked" is keyed on, so
    // a copy that kept it would be invisible to everyone who saw the original —
    // which is the whole reason to duplicate one.
    const copy = createSurvey();
    copy.name = `${source.name} (copy)`;
    copy.enabled = false;
    copy.intro = source.intro;
    copy.introRepeat = source.introRepeat;
    copy.thanks = source.thanks;
    copy.appliesTo = [...source.appliesTo];
    copy.minPurchases = source.minPurchases;
    copy.sampleRate = source.sampleRate;
    copy.maxAsks = source.maxAsks;
    // Question ids ARE the answer keys, and they're scoped to the survey, so
    // keeping them means the copy's answers line up with the original's in a
    // side-by-side comparison.
    copy.questions = source.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => ({ ...o })),
    }));
    setConfig({ surveys: [...draft.surveys, copy] });
    setSelectedId(copy.id);
    toast.success("Copied, switched off.");
  };

  const removeSurvey = (survey: Survey) => {
    if (
      !window.confirm(
        `Delete "${survey.name}"? The answers already collected stay in the database, but there'll be ` +
          `no questions left to tabulate them against, so the report disappears. Switching it off keeps both.`,
      )
    ) {
      return;
    }
    const remaining = draft.surveys.filter((s) => s.id !== survey.id);
    setConfig({ surveys: remaining });
    setSelectedId(remaining[0]?.id ?? null);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const saved = await save(normalizeSurveysConfig(draft));
      setDraft(saved);
      setDirty(false);
      toast.success("Surveys saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  // A campaign rewarding `survey_completed` changes what these answers are worth:
  // paid answers are faster to collect and less honest, and it's worth knowing
  // which mode you're in before reading the report.
  const paying = campaigns.campaigns.some(
    (c) =>
      c.status === "active" &&
      c.rules.some((r) => r.enabled && r.trigger === "survey_completed"),
  );

  return (
    <div className="space-y-4">
      <TabIntro
        elsewhere={
          <>
            Answers are cross-tabulated against lifetime revenue in Analysis.
            Rewarding people for answering is a campaign rule (&ldquo;Answers a
            survey&rdquo;), not a setting here.
          </>
        }
        links={[
          {
            label: "Analysis → Customer profile",
            onClick: () => openAnalysis("surveys"),
          },
          { label: "Campaigns", onClick: () => setMarketingTab("campaigns") },
        ]}
      >
        A few questions asked once, just after checkout — the one moment a
        customer is present, finished and well-disposed. The dashboard can tell
        you what people bought; only this can tell you that a third of them were
        grandparents buying against a deadline. Each survey is asked once per
        account, ever, and closing the card counts as an answer: it&apos;s never
        shown to that person again, and it keeps the response rate honest.
      </TabIntro>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SwitchField
          checked={draft.enabled}
          onChange={(v) => setConfig({ enabled: v })}
          label="Ask customers questions"
          hint="The master switch. Off means nobody is asked anything, whatever's switched on below."
        />
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={draft.surveys.length >= 20}
              onClick={addSurvey}
            >
              <Plus className="size-3.5" /> New survey
            </Button>
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={!dirty}
              onClick={() => void onSave()}
            >
              Save
            </Button>
          </div>
        )}
      </div>

      <Section
        title="How often anyone is asked"
        hint={describeAskPolicy(draft.policy)}
      >
        <Grid cols={2}>
          <NumberField
            label="Least time between two cards"
            value={draft.policy.cooldownHours}
            min={0}
            suffix="hours"
            onChange={(n) =>
              setConfig({ policy: { ...draft.policy, cooldownHours: n } })
            }
            hint="Across every survey, not just one. This is the setting that stops somebody who ordered three books in one evening reaching three question cards in ten minutes — the moment an aside becomes harassment."
          />
          <NumberField
            label="Give up after this many are closed in a row"
            value={draft.policy.stopAfterDismissals}
            min={0}
            onChange={(n) =>
              setConfig({ policy: { ...draft.policy, stopAfterDismissals: n } })
            }
            hint="Counted across surveys, and reset by any answer. 0 never gives up, which is rarely the right answer — somebody closing every card is telling you something."
          />
        </Grid>
        {draft.policy.cooldownHours >= 24 && (
          <p className="text-[11px] leading-relaxed text-ink-400">
            A gap this long makes purchase positions sparse: you&apos;ll hold
            answers for somebody&apos;s first, fourth and seventh orders rather
            than their first three. Good enough for &ldquo;first versus
            later&rdquo;, which is the question worth asking; not good enough for
            &ldquo;exactly the second&rdquo;.
          </p>
        )}
      </Section>

      {paying && (
        <ImpactNote>
          A live campaign pays for answering a survey. That fills the report
          faster and makes it less trustworthy — incentivised answers skew
          towards whatever gets past the question quickest. Worth segmenting
          them out before you act on anything.
        </ImpactNote>
      )}

      {draft.surveys.length === 0 ? (
        <Section title="Surveys" hint="Nothing configured yet.">
          <p className="text-xs text-ink-400">
            No surveys. Add one to start — it opens switched off, so nobody sees
            it until you say so.
          </p>
        </Section>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <SurveyList
            surveys={draft.surveys}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          {selected ? (
            <SurveyEditor
              survey={selected}
              onChange={(patch) => setSurvey(selected.id, patch)}
              onDuplicate={() => duplicateSurvey(selected)}
              onRemove={() => removeSurvey(selected)}
            />
          ) : (
            <p className="text-sm text-ink-400">Pick a survey to edit.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SurveyList({
  surveys,
  selectedId,
  onSelect,
}: {
  surveys: Survey[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {surveys.map((survey) => {
        const active = survey.id === selectedId;
        return (
          <button
            key={survey.id}
            type="button"
            onClick={() => onSelect(survey.id)}
            className={`w-full rounded-lg px-3 py-2 text-left ring-1 ring-inset transition ${
              active
                ? "bg-white ring-brand-300"
                : "bg-ink-50/50 ring-ink-100 hover:bg-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`size-1.5 shrink-0 rounded-full ${survey.enabled ? "bg-emerald-500" : "bg-ink-300"}`}
              />
              <span className="truncate text-sm font-medium text-ink-800">
                {survey.name}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              {survey.questions.length} question
              {survey.questions.length === 1 ? "" : "s"} ·{" "}
              {estimateSeconds(survey)}s
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SurveyEditor({
  survey,
  onChange,
  onDuplicate,
  onRemove,
}: {
  survey: Survey;
  onChange: (patch: Partial<Survey>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const readOnly = useReadOnly();
  const seconds = estimateSeconds(survey);
  const repeating = survey.questions.filter((q) => !q.askOnce).length;

  const setQuestion = (id: string, patch: Partial<SurveyQuestion>) =>
    onChange({
      questions: survey.questions.map((q) =>
        q.id === id ? { ...q, ...patch } : q,
      ),
    });

  const addQuestion = (kind: SurveyQuestionKind) =>
    onChange({ questions: [...survey.questions, createQuestion(kind)] });

  const removeQuestion = (id: string) =>
    onChange({ questions: survey.questions.filter((q) => q.id !== id) });

  const moveQuestion = (index: number, delta: number) => {
    const next = [...survey.questions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ questions: next });
  };

  return (
    <div className="min-w-0 space-y-3">
      <Section
        title="Survey"
        hint={describeSurveyAudience(survey)}
        action={
          readOnly ? undefined : (
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onDuplicate}
              >
                <Copy className="size-3.5" /> Duplicate
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )
        }
      >
        <Grid cols={2}>
          <Field
            label="Name"
            hint="Internal only — the customer never sees this."
          >
            <Input
              value={survey.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <SwitchField
              checked={survey.enabled}
              onChange={(v) => onChange({ enabled: v })}
              label="Switched on"
              hint="Off means it's never shown. Nothing already answered is affected."
            />
          </div>
        </Grid>

        <Field
          label="Opening line"
          hint="Read first, and it decides whether the rest is read at all. Say what it's for and how short it is."
        >
          <Input
            value={survey.intro}
            onChange={(e) => onChange({ intro: e.target.value })}
          />
        </Field>

        {survey.maxAsks > 1 && (
          <Field
            label="Opening line, second time onwards"
            hint="Optional. The first-time line usually reads oddly on a repeat — and if it promises a number of questions, that promise breaks once the ask-once ones drop out."
          >
            <Input
              value={survey.introRepeat}
              placeholder={survey.intro}
              onChange={(e) => onChange({ introRepeat: e.target.value })}
            />
          </Field>
        )}

        <Field
          label="Thank you"
          hint="Shown in place of the questions once they've answered."
        >
          <Input
            value={survey.thanks}
            onChange={(e) => onChange({ thanks: e.target.value })}
          />
        </Field>

        <Field
          label="After which purchases"
          hint="Nothing selected means every purchase. Narrow it when the questions only make sense for one thing — asking about the printed book after a Spark top-up reads as a form letter."
        >
          <Chips
            options={ITEM_OPTIONS}
            selected={survey.appliesTo}
            onChange={(next) =>
              onChange({ appliesTo: next as Survey["appliesTo"] })
            }
            allowEmpty
            emptyHint="Any purchase."
          />
        </Field>

        <Disclosure label="Who gets asked">
          <Grid cols={2}>
            <NumberField
              label="Only after this many purchases"
              value={survey.minPurchases}
              min={0}
              onChange={(n) => onChange({ minPurchases: n })}
              hint="1 asks first-time buyers, which is usually right: the answers are about why they came, and that memory fades fast. Raise it to profile repeat customers instead."
            />
            <NumberField
              label="Show to this share of them"
              value={Math.round(survey.sampleRate * 100)}
              min={1}
              suffix="%"
              onChange={(n) =>
                onChange({ sampleRate: Math.min(1, Math.max(0.01, n / 100)) })
              }
              hint="Asking isn't free — the card competes with the download button. Sample when you only need a read on the population, not a census."
            />
            <NumberField
              label="Ask at most this many times"
              value={survey.maxAsks}
              min={1}
              onChange={(n) =>
                onChange({ maxAsks: Math.min(MAX_ASKS_PER_SURVEY, Math.max(1, n)) })
              }
              hint="1 is a one-off profile. Above 1 builds a series — one row per purchase — which is what makes “their first book was for their own child, their third was a gift” a fact rather than a hunch. Mark the questions that shouldn't repeat as ask-once."
            />
          </Grid>
          {survey.maxAsks > 1 && repeating === 0 && (
            <ImpactNote>
              Every question here is ask-once, so from the second ask there&apos;d
              be nothing to show. Let one repeat, or set the limit back to 1 —
              saving will refuse this as it stands.
            </ImpactNote>
          )}
        </Disclosure>

        <p className="text-[11px] leading-relaxed text-ink-400">
          {describeBuyerRoleCoverage(survey)}
        </p>
      </Section>

      <Section
        title="Questions"
        hint={`${survey.questions.length} of ${MAX_QUESTIONS_PER_SURVEY}, about ${seconds}s to answer.`}
      >
        {seconds > 45 && (
          <ImpactNote>
            About {seconds} seconds. Past roughly half a minute this stops
            reading as a question and starts reading as a form — and the people
            who still finish it aren&apos;t a representative sample of your
            customers.
          </ImpactNote>
        )}

        {survey.questions.length === 0 && (
          <p className="text-xs text-ink-400">
            No questions yet. Before adding one, it&apos;s worth being able to
            finish the sentence &ldquo;if the answer is X, I will…&rdquo; — a
            question whose answers wouldn&apos;t change anything has still cost
            the customer their attention.
          </p>
        )}

        <div className="space-y-2">
          {survey.questions.map((question, index) => (
            <QuestionEditor
              key={question.id}
              question={question}
              index={index}
              total={survey.questions.length}
              repeatable={survey.maxAsks > 1}
              onChange={(patch) => setQuestion(question.id, patch)}
              onRemove={() => removeQuestion(question.id)}
              onMove={(delta) => moveQuestion(index, delta)}
            />
          ))}
        </div>

        {!readOnly && survey.questions.length < MAX_QUESTIONS_PER_SURVEY && (
          <div className="flex flex-wrap gap-1.5">
            {QUESTION_KINDS.map((kind) => (
              <Button
                key={kind}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => addQuestion(kind)}
              >
                <Plus className="size-3.5" /> {QUESTION_KIND_LABELS[kind]}
              </Button>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  total,
  repeatable,
  onChange,
  onRemove,
  onMove,
}: {
  question: SurveyQuestion;
  index: number;
  total: number;
  /** The survey may be asked more than once, so "repeats" is a real choice. */
  repeatable: boolean;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const readOnly = useReadOnly();
  const setOption = (id: string, patch: Partial<SurveyOption>) =>
    onChange({
      options: question.options.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });

  return (
    <div className="space-y-2.5 rounded-lg bg-white p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Field label={`Question ${index + 1}`}>
            <Input
              value={question.prompt}
              placeholder="What's the occasion?"
              onChange={(e) => onChange({ prompt: e.target.value })}
            />
          </Field>
        </div>
        <div className="w-40 shrink-0">
          <Field label="Type">
            <Select
              options={KIND_OPTIONS}
              value={question.kind}
              onChange={(e) => {
                const kind = e.target.value as SurveyQuestionKind;
                // Switching into a choice type with nothing to choose from leaves an
                // unanswerable question, so seed it.
                onChange({
                  kind,
                  options:
                    isChoiceQuestion(kind) && question.options.length === 0
                      ? [createOption(), createOption()]
                      : question.options,
                });
              }}
            />
          </Field>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 gap-1 pt-6">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              ↓
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-ink-400">
        {QUESTION_KIND_HINTS[question.kind]}
      </p>

      <Field
        label="Smaller print"
        hint="Optional. Use it to say why you're asking, if that isn't obvious."
      >
        <Input
          value={question.hint}
          onChange={(e) => onChange({ hint: e.target.value })}
        />
      </Field>

      {isChoiceQuestion(question.kind) && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            Options
          </div>
          {question.options.map((option) => (
            <div key={option.id} className="flex items-center gap-1.5">
              <Input
                value={option.label}
                placeholder="A birthday"
                onChange={(e) => setOption(option.id, { label: e.target.value })}
              />
              {/* What choosing this tells you about the BUYER, which is the half of
                  the answer marketing runs on: "my grandchild" identifies a
                  grandparent, and nothing else in the payment record ever will. */}
              <div className="w-56 shrink-0">
                <Select
                  options={ROLE_OPTIONS}
                  value={option.buyerRole ?? ""}
                  onChange={(e) =>
                    setOption(option.id, {
                      buyerRole: (e.target.value || null) as BuyerRole | null,
                    })
                  }
                />
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      options: question.options.filter((o) => o.id !== option.id),
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          ))}
          {!readOnly && question.options.length < MAX_OPTIONS_PER_QUESTION && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() =>
                onChange({ options: [...question.options, createOption()] })
              }
            >
              <Plus className="size-3.5" /> Option
            </Button>
          )}
          <SwitchField
            checked={question.allowOther}
            onChange={(v) => onChange({ allowOther: v })}
            label="Offer a 'something else' box"
            hint="The escape hatch that stops people picking a wrong option to get past the question — and what they type is where next quarter's options come from."
          />
          {question.kind === "multi" && (
            <NumberField
              label="Most they can pick"
              value={question.maxSelections}
              min={0}
              onChange={(n) => onChange({ maxSelections: n })}
              hint="0 for no limit. A cap of 2 or 3 forces a priority, which is usually more useful than a list of everything that appealed."
            />
          )}
        </div>
      )}

      {question.kind === "scale" && (
        <Grid cols={3}>
          <NumberField
            label="Highest number"
            value={question.scaleMax}
            min={2}
            onChange={(n) => onChange({ scaleMax: n })}
            hint="10 for a recommendation score, 5 for anything else."
          />
          <Field label="Label for 1">
            <Input
              value={question.scaleLowLabel}
              placeholder="Not at all likely"
              onChange={(e) => onChange({ scaleLowLabel: e.target.value })}
            />
          </Field>
          <Field label={`Label for ${question.scaleMax}`}>
            <Input
              value={question.scaleHighLabel}
              placeholder="Extremely likely"
              onChange={(e) => onChange({ scaleHighLabel: e.target.value })}
            />
          </Field>
        </Grid>
      )}

      {question.kind === "text" && (
        <Grid cols={2}>
          <Field
            label="Placeholder"
            hint="An example answer does more than any instruction to get a useful one."
          >
            <Input
              value={question.placeholder}
              onChange={(e) => onChange({ placeholder: e.target.value })}
            />
          </Field>
          <NumberField
            label="Character limit"
            value={question.maxLength}
            min={1}
            onChange={(n) => onChange({ maxLength: n })}
          />
        </Grid>
      )}

      <SwitchField
        checked={question.required}
        onChange={(v) => onChange({ required: v })}
        label="Required"
        hint="Blocks the send button. On a card the customer can close, each required question costs you answers to all the others — at most one per survey, and usually none."
      />

      {repeatable && (
        <SwitchField
          checked={question.askOnce}
          onChange={(v) => onChange({ askOnce: v })}
          label="Ask once, then drop it"
          hint="On for anything that describes the ACCOUNT — “how did you find us?” gets a worse answer the second time, because the memory has faded. Off for anything that describes the ORDER, like who this book is for: that series is the whole reason to ask more than once."
        />
      )}
    </div>
  );
}
