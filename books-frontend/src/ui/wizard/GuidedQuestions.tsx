import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Pencil, type LucideIcon } from "lucide-react";
import type { BookConfig } from "../../core/types";
import { Button } from "../components/Button";
import { cn } from "../lib/cn";
import { spring } from "../lib/motion";
import type { StepProps } from "./steps/types";

/**
 * One question in a guided flow. All answers live on the shared `BookConfig`
 * (persisted via the projects store), so the flow is a pure *view* over that
 * state: jumping between questions never loses anything, because there is no
 * local answer state to lose.
 */
export interface GuidedQuestion {
  id: string;
  /** Question heading, shown above the body. */
  title: string;
  /** Optional one-line explanation under the title. */
  subtitle?: string;
  /** Icon used in the summary rows. */
  icon: LucideIcon;
  /** Whether the question applies to the current config (e.g. reading mode). */
  visible?: (config: BookConfig) => boolean;
  /** Whether the question currently has a valid answer. */
  isAnswered: (config: BookConfig) => boolean;
  /** A short human summary of the current answer, for the hub + nav tooltip. */
  summary: (config: BookConfig) => string;
  /** The editor body for this question. */
  render: (props: StepProps) => React.ReactNode;
}

type Phase =
  | { kind: "guided"; index: number }
  | { kind: "hub" }
  | { kind: "spoke"; index: number };

export interface GuidedQuestionsProps {
  questions: GuidedQuestion[];
  config: BookConfig;
  update: (patch: Partial<BookConfig>) => void;
  /**
   * "guided" walks one question at a time (first-run). "review" opens the hub:
   * a scannable summary of every answer with jump-to-edit, so returning users
   * never replay the whole flow.
   */
  mode: "guided" | "review";
  /** CTA label on the final guided question (e.g. "Create characters"). */
  finishLabel?: string;
  /** Called when the guided flow's final Continue is pressed. */
  onFinish?: () => void;
  /** Whether `onFinish` is currently allowed (extra gate beyond per-question validity). */
  canFinish?: boolean;
  /** Optional action shown in the hub header (e.g. "Back to design"). */
  exitReviewLabel?: string;
  onExitReview?: () => void;
}

/**
 * A beautiful step-by-step question flow with a hub/summary mode.
 *
 * - Guided mode presents one question after another with a live progress rail
 *   you can use to jump back to any answered question.
 * - Review mode presents a summary hub (answers + jump-to-edit), the
 *   "hub and spoke" pattern: land on the hub, edit one spoke, return.
 */
export function GuidedQuestions({
  questions,
  config,
  update,
  mode,
  finishLabel = "Continue",
  onFinish,
  canFinish = true,
  exitReviewLabel,
  onExitReview,
}: GuidedQuestionsProps) {
  // Only the applicable questions participate (e.g. reading mode is age-gated),
  // so the rail, counts and navigation all stay honest.
  const active = useMemo(
    () => questions.filter((q) => q.visible?.(config) ?? true),
    [questions, config],
  );

  const [phase, setPhase] = useState<Phase>(
    mode === "review" ? { kind: "hub" } : { kind: "guided", index: 0 },
  );
  // Furthest question reached in the guided flow — lets the rail expose forward
  // jumps only up to where the reader has already been (plus anything answered).
  const [furthest, setFurthest] = useState(0);

  const stepProps: StepProps = { config, update };

  if (phase.kind === "hub") {
    return (
      <Hub
        active={active}
        config={config}
        exitReviewLabel={exitReviewLabel}
        onExitReview={onExitReview}
        onEdit={(index) => setPhase({ kind: "spoke", index })}
      />
    );
  }

  const index = Math.min(phase.index, Math.max(0, active.length - 1));
  const question = active[index];
  if (!question) return null;

  const answered = question.isAnswered(config);
  const isSpoke = phase.kind === "spoke";
  const isLast = index === active.length - 1;

  const goTo = (i: number) => {
    setFurthest((f) => Math.max(f, i));
    setPhase((p) => ({ kind: p.kind === "spoke" ? "spoke" : "guided", index: i }));
  };

  const onContinue = () => {
    if (isSpoke) {
      setPhase({ kind: "hub" });
      return;
    }
    if (isLast) {
      if (canFinish) onFinish?.();
      return;
    }
    goTo(index + 1);
  };

  return (
    <div className="space-y-6">
      <QuestionRail
        active={active}
        config={config}
        currentIndex={index}
        furthest={furthest}
        onJump={goTo}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={question.id}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-ink-900">{question.title}</h2>
            {question.subtitle && (
              <p className="mt-1 text-sm text-ink-500">{question.subtitle}</p>
            )}
          </div>
          {question.render(stepProps)}
        </motion.div>
      </AnimatePresence>

      <div className="sticky bottom-4 z-10">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-white/90 p-3 shadow-lifted backdrop-blur">
          <div className="flex items-center gap-2">
            {isSpoke ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<ArrowLeft className="size-4" />}
                onClick={() => setPhase({ kind: "hub" })}
              >
                All answers
              </Button>
            ) : (
              index > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<ArrowLeft className="size-4" />}
                  onClick={() => goTo(index - 1)}
                >
                  Back
                </Button>
              )
            )}
          </div>
          <div className="flex items-center gap-3">
            {!isSpoke && (
              <span className="hidden text-xs tabular-nums text-ink-400 sm:inline">
                {index + 1} of {active.length}
              </span>
            )}
            <Button
              size="md"
              disabled={!answered || (isLast && !isSpoke && !canFinish)}
              rightIcon={
                isSpoke ? (
                  <Check className="size-4" />
                ) : (
                  <ArrowRight className="size-4" />
                )
              }
              onClick={onContinue}
            >
              {isSpoke ? "Done" : isLast ? finishLabel : "Continue"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The always-visible progress + quick-navigation rail for the guided flow. */
function QuestionRail({
  active,
  config,
  currentIndex,
  furthest,
  onJump,
}: {
  active: GuidedQuestion[];
  config: BookConfig;
  currentIndex: number;
  furthest: number;
  onJump: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {active.map((q, i) => {
        const answered = q.isAnswered(config);
        const current = i === currentIndex;
        // You can jump back to anything you've seen, and forward to anything
        // already answered (or the next step in line).
        const reachable = i <= furthest || answered || i === currentIndex + 1;
        return (
          <div key={q.id} className="flex flex-1 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={!reachable}
              title={answered ? q.summary(config) : q.title}
              onClick={() => reachable && onJump(i)}
              className={cn(
                "group relative flex flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition",
                current
                  ? "bg-brand-50 ring-1 ring-brand-200"
                  : reachable
                    ? "hover:bg-ink-50"
                    : "cursor-not-allowed opacity-45",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition",
                  answered && !current
                    ? "bg-emerald-500 text-white"
                    : current
                      ? "bg-brand-600 text-(--color-brand-foreground)"
                      : "bg-white text-ink-500 ring-1 ring-inset ring-ink-200",
                )}
              >
                {answered && !current ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "hidden min-w-0 truncate text-xs font-semibold sm:block",
                  current ? "text-brand-700" : answered ? "text-ink-700" : "text-ink-500",
                )}
              >
                {q.title}
              </span>
              {current && (
                <motion.span
                  layoutId="guided-rail-underline"
                  className="absolute inset-x-2 -bottom-0.5 hidden h-0.5 rounded-full bg-brand-500 sm:block"
                  transition={spring}
                />
              )}
            </button>
            {i < active.length - 1 && (
              <span className="h-0.5 w-3 shrink-0 rounded-full bg-ink-100 sm:w-5" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The summary hub: every answer with a jump-to-edit affordance. */
function Hub({
  active,
  config,
  exitReviewLabel,
  onExitReview,
  onEdit,
}: {
  active: GuidedQuestion[];
  config: BookConfig;
  exitReviewLabel?: string;
  onExitReview?: () => void;
  onEdit: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <ul className="divide-y divide-ink-100">
          {active.map((q, i) => {
            const Icon = q.icon;
            const answered = q.isAnswered(config);
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onEdit(i)}
                  className="group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-ink-50"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500 transition group-hover:bg-brand-100 group-hover:text-brand-600">
                    <Icon className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-ink-400">{q.title}</span>
                    <span
                      className={cn(
                        "block truncate text-sm font-semibold",
                        answered ? "text-ink-800" : "text-ink-400",
                      )}
                    >
                      {answered ? q.summary(config) : "Not chosen yet"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-400 transition group-hover:text-brand-600">
                    <Pencil className="size-3.5" /> Edit
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {exitReviewLabel && onExitReview && (
        <Button variant="secondary" onClick={onExitReview} leftIcon={<ArrowLeft className="size-4" />}>
          {exitReviewLabel}
        </Button>
      )}
    </div>
  );
}
