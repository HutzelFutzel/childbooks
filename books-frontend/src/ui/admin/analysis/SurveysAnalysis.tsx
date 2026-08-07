"use client";

/**
 * Who your customers actually are — their own answers, cross-tabulated against
 * what they've spent.
 *
 * Every other screen in this dashboard measures behaviour. This one is the only
 * place the product knows anything about *people*: that a third of buyers are
 * grandparents, that half the orders are against a deadline, that word of mouth
 * brings in the accounts worth the most. None of that is inferable from a payment
 * record, and all of it changes who the homepage should talk to.
 *
 * The layout puts two things ahead of the answers on purpose:
 *
 *   1. **The response rate.** A 12% rate means everything below describes a
 *      self-selected minority. Reading option shares without knowing that is how a
 *      dashboard talks somebody into a decision the data doesn't support, so it's
 *      the first number on the card and it's called out when it's low.
 *   2. **Revenue per respondent, next to the share.** "38% are grandparents" is
 *      trivia. "38% of buyers, 51% of revenue" is a decision. The bar shows the
 *      share; the number beside it shows what that group is worth.
 *
 * The questions themselves are configured under Marketing → Surveys.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useAppConfigStore } from "../../../state/appConfigStore";
import { useAdminTab } from "../adminTabStore";
import type {
  SurveyQuestionReport,
  SurveyReport,
} from "../../../core/config/surveys";
import { Button } from "../../components/Button";
import { CardBody, CardHeader, CardTitle } from "../../components/Card";
import { cn } from "../../lib/cn";
import { fmtNumber, fmtRelative } from "./format";

export function SurveysAnalysis() {
  const loadReports = useAppConfigStore((s) => s.loadSurveyReports);
  const openMarketingTab = useAdminTab((s) => s.openMarketingTab);

  const [reports, setReports] = useState<SurveyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  // Bumped by Refresh: nothing else in the deps changes when you press it.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void loadReports()
      .then((next) => {
        if (!live) return;
        setReports(next);
        setError(null);
        setLastUpdated(Date.now());
      })
      .catch(
        (err) =>
          live &&
          setError(
            err instanceof Error ? err.message : "Could not load answers.",
          ),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [loadReports, nonce]);

  const openConfig = () => {
    openMarketingTab("surveys");
  };

  const anyAnswers = useMemo(
    () => reports.some((r) => r.respondents > 0),
    [reports],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-ink-400">
          {lastUpdated ? `Updated ${fmtRelative(lastUpdated)}` : "Loading…"}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={openConfig}>
            Edit the questions
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setNonce((n) => n + 1)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <TriangleAlert className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      {!loading && reports.length === 0 && (
        <div className="rounded-xl border border-ink-100 bg-white px-4 py-6 text-center">
          <MessageSquareQuote className="mx-auto size-6 text-ink-300" />
          <p className="mt-2 text-sm font-medium text-ink-700">
            No surveys configured.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-400">
            A few questions after checkout are the only way this dashboard
            learns who your customers are rather than just what they bought.
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={openConfig}>
            Set up a survey
          </Button>
        </div>
      )}

      {!loading && reports.length > 0 && !anyAnswers && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
          Nothing answered yet. The card only appears after a purchase settles,
          so answers arrive at roughly the rate you make sales — and only if the
          master switch under Marketing → Surveys is on.
        </p>
      )}

      {reports.map((report) => (
        <SurveyReportCard key={report.surveyId} report={report} />
      ))}
    </div>
  );
}

function SurveyReportCard({ report }: { report: SurveyReport }) {
  const rate = Math.round(report.responseRate * 100);
  const optOutRate = Math.round(report.optOutRate * 100);
  // Below a third, self-selection dominates: the people who answer a voluntary
  // question are not a random sample of the people who were asked.
  const thin = report.asked >= 20 && rate < 33;

  return (
    <div className="rounded-xl border border-ink-100 bg-white">
      <CardHeader>
        <CardTitle>{report.name}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Answers"
            value={fmtNumber(report.responses)}
            note={`from ${fmtNumber(report.respondents)} ${
              report.respondents === 1 ? "person" : "people"
            }`}
          />
          <Stat
            label="Response rate"
            value={`${rate}%`}
            tone={thin ? "warn" : rate >= 33 ? "good" : "plain"}
            note={`${fmtNumber(report.asked)} asked · ${fmtNumber(report.dismissed)} closed it`}
          />
          {/* Beside the response rate rather than buried below it. A response rate
              can look healthy while the people who hated being asked quietly remove
              themselves, and this is the only number that shows that happening. */}
          <Stat
            label="Asked us to stop"
            value={fmtNumber(report.optedOut)}
            tone={optOutRate >= 5 ? "warn" : "plain"}
            note={`${optOutRate}% of asks`}
          />
          <Stat
            label="Revenue represented"
            value={usd(report.revenueUsd)}
            note="Lifetime, counted once per person"
          />
        </div>

        {optOutRate >= 5 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {optOutRate}% of asks ended with somebody switching these questions off
            for good. That&apos;s a permanent loss, not a skipped card: they&apos;re
            out of every future survey too. Shorten the card, ask less often, or
            drop the question people are stopping at.
          </p>
        )}

        {thin && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            {rate}% answered, so everything below describes the{" "}
            {fmtNumber(report.respondents)} people willing to answer — not your
            customers in general. Treat the shares as directional, and lean on
            the revenue column, which is a fact about the people who did answer
            rather than an estimate about everyone.
          </p>
        )}

        {report.truncated && (
          <p className="text-[11px] text-ink-400">
            Showing the most recent responses only — there are more than the
            report scans in one pass.
          </p>
        )}

        {report.questions.map((question) => (
          <QuestionBlock key={question.questionId} question={question} />
        ))}

        <SegmentsBlock report={report} />
        <OrdinalsBlock report={report} />
        <TransitionsBlock report={report} />
      </CardBody>
    </div>
  );
}

/**
 * Who the buyers are, and how each group's orders differ.
 *
 * The one view here that isn't just a chart of a question: it reads the buyer-role
 * tags on the options people chose, so "grandparent" is a group you can compare on
 * money and on what they buy, rather than a bar labelled "My grandchild".
 *
 * "Couldn't tell" is shown rather than hidden, and it's usually large. Most answers
 * genuinely don't identify a buyer — "a friend's child" is chosen by parents buying
 * a gift and by people with no children alike — and a segment chart that quietly
 * drops those rows would make every visible group look bigger than it is.
 */
function SegmentsBlock({ report }: { report: SurveyReport }) {
  if (report.segments.length === 0) return null;
  const identified = report.segments.filter((s) => s.role !== "unknown");
  if (identified.length === 0) {
    return (
      <div className="rounded-lg bg-ink-50/50 p-3 text-xs leading-relaxed text-ink-400 ring-1 ring-inset ring-ink-100">
        No answer here identifies who&apos;s buying. Tag the options under
        Marketing → Surveys (&ldquo;my grandchild&rdquo; means the buyer is a
        grandparent) and this becomes a comparison of what each kind of customer
        is worth.
      </div>
    );
  }

  const best = Math.max(...report.segments.map((s) => s.revenuePerAccount), 0);

  return (
    <div className="rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <p className="text-sm font-medium text-ink-700">Who&apos;s buying</p>
      <p className="mt-0.5 text-[11px] text-ink-400">
        Read from the answers, counted per answer; the money is counted once per
        person.
      </p>
      <div className="mt-2 space-y-2">
        {report.segments.map((segment) => (
          <div key={segment.role} className="rounded-md bg-white p-2.5 ring-1 ring-inset ring-ink-100">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-xs font-medium text-ink-700">
                {segment.label}
              </span>
              <span className="text-[11px] tabular-nums text-ink-400">
                {fmtNumber(segment.responses)} answers ·{" "}
                {fmtNumber(segment.accounts)}{" "}
                {segment.accounts === 1 ? "person" : "people"} ·{" "}
                <span
                  className={cn(
                    "font-medium",
                    best > 0 && segment.revenuePerAccount >= best * 0.9
                      ? "text-emerald-700"
                      : "text-ink-600",
                  )}
                >
                  {usd(segment.revenuePerAccount)}
                </span>
                <span className="text-ink-300"> each</span>
              </span>
            </div>
            {segment.subjects.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                Books about{" "}
                {segment.subjects
                  .slice(0, 3)
                  .map((s) => `${s.label} (${fmtNumber(s.responses)})`)
                  .join(", ")}
                .
              </p>
            )}
            {segment.ordinals.length > 0 && (
              <p className="mt-0.5 text-[11px] text-ink-400">
                {segment.ordinals
                  .map((o) => `${o.label.toLowerCase()}: ${Math.round(o.share * 100)}%`)
                  .join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * First orders versus later ones — the view the whole per-purchase design exists
 * for.
 *
 * "Mostly parents buy first, and later orders are gifts" is a marketing plan: it
 * says who the acquisition pages should talk to and who the repeat-purchase email
 * should. Nothing in a payment record can tell you it.
 *
 * Positions are buckets, and a bucket can be empty. The ask cooldown makes ordinals
 * sparse on purpose — you hold answers for somebody's first, fourth and seventh
 * orders — so "third or later" is a population where "exactly the third" would be a
 * cell with two people in it.
 */
function OrdinalsBlock({ report }: { report: SurveyReport }) {
  const slices = report.ordinals.filter((o) => o.bucket !== "unknown");
  if (slices.length < 2) return null;

  return (
    <div className="rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <p className="text-sm font-medium text-ink-700">
        What changes between someone&apos;s first order and their later ones
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {slices.map((slice) => (
          <div
            key={slice.bucket}
            className="rounded-md bg-white p-2.5 ring-1 ring-inset ring-ink-100"
          >
            <div className="text-[11px] uppercase tracking-wide text-ink-400">
              {slice.label}
            </div>
            <div className="text-sm font-semibold text-ink-800">
              {fmtNumber(slice.responses)}{" "}
              <span className="text-xs font-normal text-ink-400">answers</span>
            </div>
            {slice.roles.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {slice.roles.slice(0, 4).map((role) => (
                  <li
                    key={role.id}
                    className="flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-ink-600">
                      {role.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-400">
                      {Math.round(role.share * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {slice.subjects.length > 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                Often {slice.subjects[0].label}
                {slice.subjects[1] ? ` or ${slice.subjects[1].label}` : ""}.
              </p>
            )}
          </div>
        ))}
      </div>
      {report.ordinals.some((o) => o.bucket === "unknown") && (
        <p className="mt-2 text-[11px] text-ink-400">
          Some answers couldn&apos;t be placed in a purchase order — a
          confirmation with no payment record, or a payment outside the report&apos;s
          scan. They&apos;re left out above rather than counted as first orders.
        </p>
      )}
    </div>
  );
}

/**
 * How buyers move between one of their orders and the next.
 *
 * Only exists once people have answered twice, which takes a while: the ask
 * cooldown means a second answer is a second purchase on a different day. Worth the
 * wait — "a third of parents' next book is for somebody else's child" is the
 * sentence that decides what the second-purchase email says.
 *
 * Rows where nothing changed are kept. "Parents who buy for their own child again"
 * is as much a finding as anyone changing, and dropping it would make every visible
 * move look more common than it is.
 */
function TransitionsBlock({ report }: { report: SurveyReport }) {
  if (report.transitions.length === 0) return null;
  const moved = report.transitions.filter((t) => t.from !== t.to);

  return (
    <div className="rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <p className="text-sm font-medium text-ink-700">
        From one order to the next
      </p>
      <p className="mt-0.5 text-[11px] text-ink-400">
        People who answered at least twice. {fmtNumber(moved.length)} of{" "}
        {fmtNumber(report.transitions.length)} paths are a change of recipient.
      </p>
      <ul className="mt-2 space-y-1">
        {report.transitions.slice(0, 8).map((t) => (
          <li
            key={`${t.from}>${t.to}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
          >
            <span className="min-w-0 text-ink-700">
              {t.fromLabel}
              <span className="mx-1.5 text-ink-300">then</span>
              <span className={cn(t.from !== t.to && "font-medium")}>
                {t.toLabel}
              </span>
            </span>
            <span className="shrink-0 tabular-nums text-ink-400">
              {Math.round(t.share * 100)}% · {fmtNumber(t.accounts)}{" "}
              {t.accounts === 1 ? "person" : "people"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionBlock({ question }: { question: SurveyQuestionReport }) {
  const top = question.options[0]?.responses ?? 0;
  // Compared against the best-performing option rather than the average: the
  // useful question is "which of these groups is worth most", and that's easier to
  // see when the leader is the reference point.
  const bestValue = Math.max(
    ...question.options.map((o) => o.revenuePerAccount),
    0,
  );

  return (
    <div className="rounded-lg bg-ink-50/50 p-3 ring-1 ring-inset ring-ink-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-700">{question.prompt}</p>
        <p className="text-[11px] text-ink-400">
          {fmtNumber(question.responses)} answered
          {question.kind === "scale" &&
            question.average > 0 &&
            ` · average ${question.average}`}
        </p>
      </div>

      {question.options.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {question.options.map((option) => {
            const width =
              top > 0
                ? Math.max(2, Math.round((option.responses / top) * 100))
                : 0;
            const strong =
              bestValue > 0 && option.revenuePerAccount >= bestValue * 0.9;
            return (
              <div key={option.optionId} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-ink-700">
                    {option.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-400">
                    {Math.round(option.share * 100)}% ·{" "}
                    <span
                      className={cn(
                        "font-medium",
                        strong ? "text-emerald-700" : "text-ink-600",
                      )}
                    >
                      {usd(option.revenuePerAccount)}
                    </span>
                    <span className="text-ink-300"> each</span>
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      strong ? "bg-emerald-500" : "bg-brand-400",
                    )}
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {question.samples.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            In their words
          </div>
          {/* Deliberately not summarized or counted. Free text is where the option
              you forgot to offer shows up, and that only survives being read. */}
          <ul className="space-y-1">
            {question.samples.slice(0, 8).map((sample, i) => (
              <li
                key={`${i}-${sample.slice(0, 12)}`}
                className="text-xs italic leading-relaxed text-ink-500"
              >
                “{sample}”
              </li>
            ))}
          </ul>
          {question.samples.length > 8 && (
            <p className="text-[11px] text-ink-400">
              …and {question.samples.length - 8} more.
            </p>
          )}
        </div>
      )}

      {question.responses === 0 && (
        <p className="mt-1 text-[11px] text-ink-400">
          Nobody has answered this one. If it&apos;s being skipped while the
          others aren&apos;t, the question is the problem.
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  tone = "plain",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 ring-1 ring-inset",
        tone === "good"
          ? "bg-emerald-50 ring-emerald-100"
          : tone === "warn"
            ? "bg-amber-50 ring-amber-100"
            : "bg-white ring-ink-100",
      )}
    >
      <div className="text-[11px] uppercase tracking-wide text-ink-400">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-semibold",
          tone === "good"
            ? "text-emerald-800"
            : tone === "warn"
              ? "text-amber-800"
              : "text-ink-800",
        )}
      >
        {value}
      </div>
      {note && <div className="text-[11px] text-ink-400">{note}</div>}
    </div>
  );
}

function usd(amount: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
