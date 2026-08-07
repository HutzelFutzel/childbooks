/**
 * The survey report: answers cross-tabulated against money, purchase position, and
 * what the book was actually about.
 *
 * "38% of our buyers are grandparents" is trivia. "Grandparents are 38% of buyers
 * and 51% of revenue, and two thirds of their first orders are birthday books" is a
 * decision about who the homepage talks to and what it shows them. Getting from the
 * first sentence to the second is the entire reason to ask anyone anything.
 *
 * Four deliberate choices:
 *
 *   - **Revenue is joined live, not snapshotted.** Lifetime value keeps moving
 *     after somebody answers a survey; a figure frozen at answer time would peg
 *     every cohort to its first order and make the newest cohort look worst
 *     forever. The join reuses the analytics dashboard's own cached payment scan,
 *     so "revenue" means one thing across the admin.
 *
 *   - **Purchase ordinals are computed here too.** Storing "this was their second
 *     order" at answer time races the webhook that increments the counter, and an
 *     ordinal that was written one short stays one short. Recomputed from the
 *     payment history, the report corrects itself as payments settle.
 *
 *   - **Subjects are labelled from the story-craft catalog.** Themes and settings
 *     are stored as ids, which is what makes them aggregate at all; nobody wants to
 *     read `theme_first_day`, so the labels are resolved across every age band at
 *     read time and a since-deleted theme falls back to its id rather than
 *     vanishing.
 *
 *   - **The maths lives in `core/`.** {@link buildSurveyReport} is pure and shared,
 *     so shares and revenue-per-account are defined once. Two plausible
 *     denominators (answers vs. people — and they now differ, because one customer
 *     can answer three times) give materially different percentages, and choosing
 *     one in two places is how a dashboard starts contradicting itself.
 */
import {
  buildSurveyReport,
  type SurveyReport,
  type SurveyResponseRow,
} from "../../../books-frontend/src/core/config/surveys";
import { AGE_RANGES } from "../../../books-frontend/src/core/config/options";
import { resolveStoryCraft } from "../../../books-frontend/src/core/config/storyCraft";
import { getStoryCraftConfig, getSurveysConfig } from "../appConfig";
import { fetchPurchaseOrdinals, fetchRevenueByUid } from "../analytics";
import { listResponses, MAX_REPORT_ROWS } from "./store";

/**
 * One survey's report, or null when the survey no longer exists.
 *
 * A deleted survey's answers are deliberately left in Firestore — they cost
 * nothing and someone always wants last quarter's numbers back — but there are no
 * questions left to tabulate them against, so there's no report to build.
 */
export async function surveyReport(
  surveyId: string,
): Promise<SurveyReport | null> {
  const config = await getSurveysConfig();
  const survey = config.surveys.find((s) => s.id === surveyId);
  if (!survey) return null;

  const [{ rows, truncated }, revenue, ordinals, labels] = await Promise.all([
    listResponses(surveyId, MAX_REPORT_ROWS),
    fetchRevenueByUid().catch(() => new Map<string, { total: number }>()),
    fetchPurchaseOrdinals().catch(() => new Map<string, number>()),
    subjectLabels().catch(() => ({}) as Record<string, string>),
  ]);

  const joined: SurveyResponseRow[] = rows.map((row) => ({
    uid: row.uid,
    surveyId: row.surveyId,
    status: row.status,
    askedAt: row.askedAt,
    answeredAt: row.answeredAt,
    askNumber: row.askNumber,
    optedOut: row.optedOut,
    answers: row.answers,
    context: row.context,
    // Zero means "couldn't place this purchase" — a payment outside the scan, or a
    // confirmation with no payment record at all. Reported as unknown rather than
    // folded into "first", which would quietly inflate the most-read column.
    ordinal: row.context.paymentId
      ? ordinals.get(row.context.paymentId) ?? 0
      : 0,
    revenueUsd: revenue.get(row.uid)?.total ?? 0,
  }));

  return buildSurveyReport(survey, joined, { truncated, labels });
}

/** Every survey's report, for the analysis tab's overview. */
export async function surveyReports(): Promise<SurveyReport[]> {
  const config = await getSurveysConfig();
  const out: SurveyReport[] = [];
  for (const survey of config.surveys) {
    const report = await surveyReport(survey.id);
    if (report) out.push(report);
  }
  return out;
}

/**
 * id → label for every theme, setting and device across every age band.
 *
 * Flattened into one map because a response row records the id without recording
 * which band's catalog it came from, and ids are unique enough in practice that a
 * collision would mean two bands deliberately sharing a concept. Where they do
 * collide, the first band's wording wins, which is a cosmetic difference rather
 * than a counting one — the ids are what the tallies group on.
 */
async function subjectLabels(): Promise<Record<string, string>> {
  const config = await getStoryCraftConfig().catch(() => null);
  const labels: Record<string, string> = {};
  for (const band of AGE_RANGES) {
    const craft = resolveStoryCraft(band.id, config);
    for (const option of [...craft.themes, ...craft.settings, ...craft.devices]) {
      if (!labels[option.id]) labels[option.id] = option.label;
    }
  }
  return labels;
}
