"use client";

/**
 * The post-purchase profiling card.
 *
 * This is the one moment in the whole product where a customer is present,
 * finished, and well-disposed: the money has gone through, the thing they wanted
 * exists, and there's nothing left for them to do. Anywhere else, a question is an
 * interruption of something they came here to finish.
 *
 * It's shaped like an aside, not a form. No progress bar, no step count, no
 * required fields unless the admin insists — the "Skip" is as prominent as the
 * submit, and taking it is recorded so the card never comes back for this order.
 * The reason to be that easy to dismiss is that a survey which nags gets answered
 * carelessly, and careless answers are worse than none: they end up in a cross-tab
 * that somebody makes a decision on.
 *
 * The way out of the whole feature is deliberately PROGRESSIVE. A permanent third
 * button reading "never ask again" would advertise the exit to people who weren't
 * yet bothered and cost answers for nothing, so it appears where there's actual
 * evidence of annoyance: after a skip, and on any repeat ask. Nobody who is asked
 * once and answers ever sees it.
 *
 * Shown only once the purchase has actually settled and, for print, only when the
 * order is healthy. A customer whose book didn't reach the press is being asked to
 * help with market research while we've broken something, which is the wrong
 * question at the wrong time.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Gift, MessageSquareHeart, X } from "lucide-react";
import {
  canSubmit,
  emptyAnswer,
  itemTypeForPurchaseKind,
  validateAnswers,
  type Survey,
  type SurveyAnswer,
  type SurveyQuestion,
} from "../../core/config/surveys";
import { previewOffers } from "../../platform/offers";
import {
  dismissSurvey,
  fetchSurvey,
  setSurveyOptOut,
  submitSurvey,
} from "../../platform/surveys";
import { Button } from "../components/Button";
import { Textarea } from "../components/Input";
import { cn } from "../lib/cn";

export function SurveyCard({
  kind,
  paymentId,
  projectId,
  /** False until the purchase has settled and, for print, looks healthy. */
  ready,
}: {
  kind: string;
  paymentId: string | null;
  projectId: string | null;
  ready: boolean;
}) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [askNumber, setAskNumber] = useState(1);
  const [answers, setAnswers] = useState<SurveyAnswer[]>([]);
  const [thanks, setThanks] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * `asking` → `skipped` (they closed it, and the way out is now offered) →
   * `gone` (opted out, or the aside has said its last word).
   */
  const [phase, setPhase] = useState<"asking" | "skipped" | "gone">("asking");
  const [reward, setReward] = useState<string | null>(null);

  const context = useMemo(
    () => ({
      itemType: itemTypeForPurchaseKind(kind),
      paymentId: paymentId ?? undefined,
      projectId: projectId ?? undefined,
    }),
    [kind, paymentId, projectId],
  );

  useEffect(() => {
    // Fetching IS asking — the server records it, and that record is what makes
    // the response rate honest. So this must not run speculatively.
    if (!ready) return;
    let cancelled = false;
    void fetchSurvey(context).then((next) => {
      if (cancelled || !next) return;
      setSurvey(next.survey);
      setAskNumber(next.askNumber);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, context]);

  useEffect(() => {
    if (!survey) return;
    let cancelled = false;
    // Asked through the campaign engine's own preview, so the sentence here is
    // produced by the code that will actually pay: a card promising Sparks that
    // don't arrive is worse than one that promised nothing. Empty when no campaign
    // rewards answering, which is the normal case.
    void previewOffers({
      trigger: "survey_completed",
      surveyId: survey.id,
    }).then((previews) => {
      if (!cancelled && previews.length > 0) setReward(previews[0].message);
    });
    return () => {
      cancelled = true;
    };
  }, [survey]);

  if (phase === "gone" || !survey) return null;

  const errors = validateAnswers(survey, answers).errors;
  const patch = (next: SurveyAnswer) =>
    setAnswers((prev) => [
      ...prev.filter((a) => a.questionId !== next.questionId),
      next,
    ]);
  const answerFor = (id: string) =>
    answers.find((a) => a.questionId === id) ?? emptyAnswer(id);

  const skip = () => {
    setPhase("skipped");
    dismissSurvey(survey.id, paymentId);
  };

  const neverAgain = () => {
    // Optimistic: the preference is what stops the asking, and if the write fails
    // the customer would rather have the card gone now than see an error about a
    // questionnaire. The next ask would be a real failure — but a run of
    // dismissals stops it anyway, so the floor here is one more card at worst.
    setPhase("gone");
    void setSurveyOptOut({ optOut: true, surveyId: survey.id, paymentId });
  };

  const send = async () => {
    setBusy(true);
    // Only answers the customer actually gave are sent; blank ones are dropped by
    // the validator rather than stored as "no opinion", which would be a lie in a
    // report.
    const cleaned = validateAnswers(survey, answers).answers;
    const message = await submitSurvey({
      surveyId: survey.id,
      answers: cleaned,
      context,
    });
    setBusy(false);
    setThanks(message);
  };

  if (thanks) {
    return (
      <div className="mt-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          <Check className="size-5" />
        </span>
        <p className="text-sm font-medium text-emerald-900">{thanks}</p>
      </div>
    );
  }

  // Skipped. The card collapses to one quiet line that says what just happened and
  // offers the door — which is the moment it's worth offering, and the only moment.
  if (phase === "skipped") {
    return (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border border-ink-100 bg-ink-50/40 px-4 py-2.5">
        <p className="text-xs text-ink-400">
          No problem — we won&apos;t ask about this order again.
        </p>
        <button
          type="button"
          onClick={neverAgain}
          className="text-xs font-medium text-ink-500 underline decoration-ink-200 underline-offset-2 transition hover:text-ink-700"
        >
          Don&apos;t ask again
        </button>
      </div>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-ink-100 bg-white px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <MessageSquareHeart className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-800">{survey.intro}</p>
          <p className="mt-0.5 text-xs text-ink-400">
            Optional, and it stays between us — we use it to decide what to
            build next.
          </p>
          {reward && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
              <Gift className="size-3.5" /> {reward}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={skip}
          aria-label="No thanks"
          title="No thanks"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-300 transition hover:bg-ink-50 hover:text-ink-600"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-5">
        {survey.questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            answer={answerFor(question.id)}
            error={errors[question.id]}
            onChange={patch}
          />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {/* Only from the second ask onwards. Somebody being asked for the first time
            hasn't been given a reason to want out, and offering it would just cost
            an answer. */}
        {askNumber > 1 && (
          <button
            type="button"
            onClick={neverAgain}
            disabled={busy}
            className="mr-auto text-xs text-ink-400 underline decoration-ink-200 underline-offset-2 transition hover:text-ink-600"
          >
            Don&apos;t ask again
          </button>
        )}
        <Button variant="ghost" size="sm" onClick={skip} disabled={busy}>
          Skip
        </Button>
        <Button
          size="sm"
          loading={busy}
          disabled={busy || !canSubmit(survey, answers)}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </section>
  );
}

function QuestionField({
  question,
  answer,
  error,
  onChange,
}: {
  question: SurveyQuestion;
  answer: SurveyAnswer;
  error?: string;
  onChange: (answer: SurveyAnswer) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-ink-700">
        {question.prompt}
        {question.required && <span className="ml-1 text-rose-500">*</span>}
      </p>
      {question.hint && (
        <p className="mt-0.5 text-xs text-ink-400">{question.hint}</p>
      )}

      <div className="mt-2">
        {question.kind === "single" || question.kind === "multi" ? (
          <ChoiceAnswer
            question={question}
            answer={answer}
            onChange={onChange}
          />
        ) : question.kind === "scale" ? (
          <ScaleAnswer
            question={question}
            answer={answer}
            onChange={onChange}
          />
        ) : (
          <Textarea
            rows={3}
            maxLength={question.maxLength}
            placeholder={question.placeholder}
            value={answer.text}
            onChange={(e) => onChange({ ...answer, text: e.target.value })}
          />
        )}
      </div>

      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/**
 * Chips rather than radio buttons or a select.
 *
 * A `select` hides the options behind a tap, which on a card people are one
 * gesture from closing is a tap too many; native radios are small targets on
 * touch. Six visible chips get answered.
 */
function ChoiceAnswer({
  question,
  answer,
  onChange,
}: {
  question: SurveyQuestion;
  answer: SurveyAnswer;
  onChange: (answer: SurveyAnswer) => void;
}) {
  const multi = question.kind === "multi";
  const chosen = new Set(answer.optionIds);
  const capped =
    multi &&
    question.maxSelections > 0 &&
    answer.optionIds.length >= question.maxSelections;

  const toggle = (optionId: string) => {
    if (!multi) {
      // Tapping the chosen option again clears it: an answer you can't take back
      // is how people end up leaving one they didn't mean.
      onChange({
        ...answer,
        optionIds: chosen.has(optionId) ? [] : [optionId],
      });
      return;
    }
    if (chosen.has(optionId)) {
      onChange({
        ...answer,
        optionIds: answer.optionIds.filter((id) => id !== optionId),
      });
      return;
    }
    if (capped) return;
    onChange({ ...answer, optionIds: [...answer.optionIds, optionId] });
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option) => {
          const active = chosen.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs ring-1 ring-inset transition",
                active
                  ? "bg-brand-600 font-medium text-white ring-brand-600"
                  : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
                !active && capped && "opacity-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {question.allowOther && (
        <input
          className="mt-2 w-full rounded-lg border border-ink-200 px-3 py-2 text-xs text-ink-700 placeholder:text-ink-300 focus:border-brand-400 focus:outline-none"
          placeholder="Something else…"
          maxLength={200}
          value={answer.text}
          onChange={(e) => onChange({ ...answer, text: e.target.value })}
        />
      )}
    </>
  );
}

function ScaleAnswer({
  question,
  answer,
  onChange,
}: {
  question: SurveyQuestion;
  answer: SurveyAnswer;
  onChange: (answer: SurveyAnswer) => void;
}) {
  const values = Array.from({ length: question.scaleMax }, (_, i) => i + 1);
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() =>
              onChange({ ...answer, value: answer.value === value ? 0 : value })
            }
            className={cn(
              "size-8 rounded-lg text-xs ring-1 ring-inset transition",
              answer.value === value
                ? "bg-brand-600 font-semibold text-white ring-brand-600"
                : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      {(question.scaleLowLabel || question.scaleHighLabel) && (
        <div className="mt-1 flex justify-between text-[10px] text-ink-400">
          <span>{question.scaleLowLabel}</span>
          <span>{question.scaleHighLabel}</span>
        </div>
      )}
    </>
  );
}
