/**
 * Deterministic page-pacing checks on a finished screenplay.
 *
 * Pagination is the first and only point where "one short sentence per page"
 * can be verified: before it, pages don't exist; after it, the art is already
 * being made. Everything here is counted rather than judged, so it costs
 * nothing, never disagrees with itself, and needs no model call.
 *
 * The result is advisory. A page over the limit is a signal the band's targets
 * and the manuscript disagree — which is sometimes the manuscript and sometimes
 * the band — so this reports, and a human decides.
 */
import type { AudienceProfile } from "../config/audienceCatalog";
import type { ScreenplayDoc } from "../types";
import { wordCount } from "../story/brief";
import { splitSentences } from "./storyValidate";

export interface PageDensityIssue {
  /** 1-based index into `spreads`, which is what the studio labels pages by. */
  index: number;
  words: number;
  limit: number;
}

export interface ScreenplayDensityReport {
  /** The band these numbers came from, so a stale report is recognisable. */
  profileId: string;
  pageCount: number;
  totalWords: number;
  medianWordsPerPage: number;
  overLimit: PageDensityIssue[];
  /** Pages carrying no illustration brief at all — always a defect. */
  emptyBriefs: number[];
  /** True when the plan is outside the band's page budget. */
  pageCountOutOfRange: boolean;
  /** One plain sentence per finding, ready to render. */
  summary: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * A page is only flagged when it is clearly over, not marginally: the target is
 * an editorial aim and the maximum is the line, so this measures against the
 * maximum and gives it a little room on top.
 */
const OVER_LIMIT_TOLERANCE = 1.15;

export function inspectScreenplayDensity(
  screenplay: ScreenplayDoc,
  profile: AudienceProfile,
): ScreenplayDensityReport {
  const { density } = profile;
  const spreads = screenplay.spreads ?? [];
  const perPage = spreads.map((s) => wordCount(s.text ?? ""));
  const totalWords = perPage.reduce((a, b) => a + b, 0);

  const ceiling =
    density.maxWordsPerPage > 0 ? Math.round(density.maxWordsPerPage * OVER_LIMIT_TOLERANCE) : 0;
  const overLimit: PageDensityIssue[] = [];
  if (ceiling > 0) {
    perPage.forEach((words, i) => {
      if (words > ceiling) {
        overLimit.push({ index: i + 1, words, limit: density.maxWordsPerPage });
      }
    });
  }

  const emptyBriefs: number[] = [];
  spreads.forEach((s, i) => {
    if (!s.illustration?.trim()) emptyBriefs.push(i + 1);
  });

  const pageCount = spreads.length;
  const pageCountOutOfRange =
    pageCount > 0 &&
    density.minPages > 0 &&
    density.maxPages > 0 &&
    (pageCount < density.minPages || pageCount > density.maxPages);

  const summary: string[] = [];
  if (overLimit.length > 0) {
    const worst = overLimit.reduce((a, b) => (a.words > b.words ? a : b));
    summary.push(
      `${overLimit.length} page${overLimit.length === 1 ? "" : "s"} carry more text than ${
        profile.label
      } usually holds (up to ${density.maxWordsPerPage} words; page ${worst.index} has ${
        worst.words
      }).`,
    );
  }
  if (pageCountOutOfRange) {
    summary.push(
      `The plan is ${pageCount} pages; books for ${profile.label} usually run ${density.minPages}–${density.maxPages}.`,
    );
  }
  if (emptyBriefs.length > 0) {
    summary.push(
      `${emptyBriefs.length} page${
        emptyBriefs.length === 1 ? " has" : "s have"
      } no illustration brief, so there is nothing for the picture to show.`,
    );
  }

  return {
    profileId: profile.id,
    pageCount,
    totalWords,
    medianWordsPerPage: median(perPage),
    overLimit,
    emptyBriefs,
    pageCountOutOfRange,
    summary,
  };
}

/** Sentence-level pacing per page, for bands that cap sentences hard. */
export function inspectPageSentences(
  screenplay: ScreenplayDoc,
  profile: AudienceProfile,
): { index: number; sentences: number }[] {
  const target = profile.density.targetSentencesPerPage;
  if (target <= 0) return [];
  // Twice the target is the point at which a page stops reading like one beat.
  const ceiling = target * 2;
  const out: { index: number; sentences: number }[] = [];
  (screenplay.spreads ?? []).forEach((s, i) => {
    const count = splitSentences(s.text ?? "").length;
    if (count > ceiling) out.push({ index: i + 1, sentences: count });
  });
  return out;
}
