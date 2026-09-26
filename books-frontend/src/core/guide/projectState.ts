/**
 * The Chat studio's additive state on a book, read and written in one place.
 *
 * Everything the Chat needs beyond the shared book lives on
 * `Project.authoringState`, and every field in it is optional. That is what keeps
 * a book portable: Steps ignores the field entirely, and a book begun in Steps
 * opens in Chat with an empty state that the journey derives from the book itself.
 *
 * Reads go through {@link authoringOf}, which repairs whatever is stored rather
 * than trusting it — an unknown entry, a negative timestamp or a list of numbers
 * reads as absent, never as a crash.
 */
import type {
  GuideEntry,
  HardcoverDecision,
  Project,
  SourceArtRef,
  StudioAuthoringState,
} from "../types";

const ENTRIES: readonly GuideEntry[] = ["guided", "own"];
const HARDCOVER: readonly HardcoverDecision[] = ["spread", "keep", "thin"];

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
  return out.length > 0 ? out : undefined;
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function sameAgeGroups(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups = value
    .map((group) => (Array.isArray(group) ? strings(group)?.slice(0, 8) : undefined))
    .filter((group): group is string[] => Boolean(group && group.length >= 2))
    .slice(0, 6);
  return groups.length > 0 ? groups : undefined;
}

function sourceArtRefs(value: unknown): SourceArtRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter(
      (item): item is SourceArtRef =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.blobId === "string" &&
        Boolean(item.blobId) &&
        typeof item.mimeType === "string" &&
        typeof item.createdAt === "number" &&
        Number.isFinite(item.createdAt),
    )
    .slice(0, 3);
  return refs.length > 0 ? refs : undefined;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** A repaired copy of the stored state. Never throws, never returns undefined. */
export function normalizeStudioAuthoringState(input: unknown): StudioAuthoringState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { version: 1 };
  const raw = input as Partial<StudioAuthoringState> & Record<string, unknown>;

  const storyRun =
    raw.storyRun &&
    typeof raw.storyRun === "object" &&
    typeof raw.storyRun.signature === "string" &&
    time(raw.storyRun.startedAt) &&
    ["running", "failed", "done"].includes(raw.storyRun.status)
      ? compact({
          signature: raw.storyRun.signature,
          startedAt: raw.storyRun.startedAt,
          status: raw.storyRun.status,
          error: typeof raw.storyRun.error === "string" ? raw.storyRun.error : undefined,
        })
      : undefined;

  const cover =
    raw.cover && typeof raw.cover === "object"
      ? compact({
          subtitle: typeof raw.cover.subtitle === "string" ? raw.cover.subtitle : undefined,
          author: typeof raw.cover.author === "string" ? raw.cover.author : undefined,
          titleEdited: raw.cover.titleEdited === true ? true : undefined,
        })
      : undefined;

  const extraction =
    raw.extraction &&
    typeof raw.extraction === "object" &&
    typeof raw.extraction.storyHash === "string" &&
    time(raw.extraction.at)
      ? {
          storyHash: raw.extraction.storyHash,
          at: raw.extraction.at,
          names: strings(raw.extraction.names) ?? [],
          unresolved: strings(raw.extraction.unresolved) ?? [],
        }
      : undefined;

  const drawBook =
    raw.drawBook &&
    typeof raw.drawBook === "object" &&
    time(raw.drawBook.startedAt) &&
    ["cast", "pages", "done"].includes(raw.drawBook.phase)
      ? compact({
          quoteId: typeof raw.drawBook.quoteId === "string" ? raw.drawBook.quoteId : undefined,
          startedAt: raw.drawBook.startedAt,
          phase: raw.drawBook.phase,
          jobId: typeof raw.drawBook.jobId === "string" ? raw.drawBook.jobId : undefined,
          error: typeof raw.drawBook.error === "string" ? raw.drawBook.error : undefined,
        })
      : undefined;

  const pendingAction =
    raw.pendingAction &&
    typeof raw.pendingAction === "object" &&
    ["portraits", "book", "redraw"].includes(raw.pendingAction.purpose) &&
    typeof raw.pendingAction.quoteId === "string" &&
    time(raw.pendingAction.at)
      ? {
          purpose: raw.pendingAction.purpose,
          quoteId: raw.pendingAction.quoteId,
          confirmed: raw.pendingAction.confirmed === true,
          at: raw.pendingAction.at,
        }
      : undefined;

  const portraits =
    raw.portraits && typeof raw.portraits === "object" && !Array.isArray(raw.portraits)
      ? Object.fromEntries(
          Object.entries(raw.portraits).filter(
            ([, tree]) => tree && typeof tree === "object" && "nodes" in (tree as object),
          ),
        )
      : undefined;
  const bookSetup =
    raw.bookSetup && typeof raw.bookSetup === "object"
      ? compact({
          formatConfirmedAt: time(raw.bookSetup.formatConfirmedAt),
          layoutConfirmedAt: time(raw.bookSetup.layoutConfirmedAt),
        })
      : undefined;

  return compact({
    version: 1 as const,
    entry: ENTRIES.includes(raw.entry as GuideEntry) ? raw.entry : undefined,
    sparksNoticeAt: time(raw.sparksNoticeAt),
    portraits: portraits && Object.keys(portraits).length > 0 ? portraits : undefined,
    styleSourceArt: sourceArtRefs(raw.styleSourceArt),
    styleSourceOnly: raw.styleSourceOnly === true ? true : undefined,
    saidFacts: strings(raw.saidFacts),
    skippedFacts: strings(raw.skippedFacts),
    askedFacts: strings(raw.askedFacts),
    answeredFacts: strings(raw.answeredFacts),
    chatLocale: typeof raw.chatLocale === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw.chatLocale) ? raw.chatLocale : undefined,
    ownComposer: raw.ownComposer === true ? true : undefined,
    planRequestedFor: typeof raw.planRequestedFor === "string" && raw.planRequestedFor ? raw.planRequestedFor : undefined,
    planBasis: typeof raw.planBasis === "string" && raw.planBasis ? raw.planBasis.slice(0, 200) : undefined,
    bookSetup:
      bookSetup && Object.keys(bookSetup).length > 0 ? bookSetup : undefined,
    sameAge: sameAgeGroups(raw.sameAge),
    languageSaid: raw.languageSaid === true ? true : undefined,
    storyRun,
    hardcover: HARDCOVER.includes(raw.hardcover as HardcoverDecision) ? raw.hardcover : undefined,
    cover: cover && Object.keys(cover).length > 0 ? cover : undefined,
    extraction,
    drawBook,
    lockedAt: time(raw.lockedAt),
    pendingAction,
    seenAt: time(raw.seenAt),
    replaced: Array.isArray(raw.replaced)
      ? raw.replaced
          .filter((r): r is { at: number; fields: Record<string, unknown> } =>
            Boolean(r) && typeof r === "object" && typeof r.at === "number" && Boolean(r.fields) && typeof r.fields === "object",
          )
          .slice(0, 5)
      : undefined,
  });
}

/** The book's Chat state, repaired. */
export function authoringOf(project: Pick<Project, "authoringState">): StudioAuthoringState {
  return normalizeStudioAuthoringState(project.authoringState);
}

/** A copy of the book with part of its Chat state replaced. */
export function withAuthoring(
  project: Project,
  patch: Partial<Omit<StudioAuthoringState, "version">>,
): Project {
  return {
    ...project,
    authoringState: normalizeStudioAuthoringState({ ...authoringOf(project), ...patch }),
  };
}

/** Add ids to one of the fact lists without duplicates. */
export function withFactMarks(
  project: Project,
  key: "saidFacts" | "skippedFacts" | "askedFacts" | "answeredFacts",
  ids: readonly string[],
): Project {
  const current = authoringOf(project)[key] ?? [];
  const next = [...new Set([...current, ...ids])];
  if (next.length === current.length) return project;
  return withAuthoring(project, { [key]: next });
}

/** Whether the pages have started, which locks everything before them. */
export function pagesLocked(project: Pick<Project, "authoringState">): boolean {
  return authoringOf(project).lockedAt !== undefined;
}
