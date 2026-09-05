/**
 * **How an account arrived** — the attribution layer coupons target.
 *
 * Two attribution paths already existed and neither generalizes. `?ref=CODE`
 * answers "which customer invited them" and `?via=CODE` answers "which affiliate
 * gets paid"; both are about WHO earns something, and both immediately consume
 * the token into a program-specific record. Nothing recorded the plainer fact
 * "this session came off the poster in the Berlin shop", which is exactly the
 * fact an auto-applied coupon needs to key on.
 *
 * This module is that fact, and only that fact. It records arrivals; it decides
 * nothing. Deliberately kept separate from the referral and affiliate stores,
 * because attribution that also grants things is attribution you can't safely
 * write from an untrusted client.
 *
 * ## The two-timestamp rule
 *
 * Arrivals are kept as `first` and `latest`, never as a list. First-touch is what
 * an acquisition channel should be credited for; last-touch is what explains the
 * session in front of you. Keeping both is a few bytes; keeping a full history is
 * an unbounded array on a hot document, and keeping only one guarantees the wrong
 * answer to half of all questions.
 *
 * `tokens` is the flattened union of every arrival token ever seen for the
 * account, and it is the field coupon audiences and campaign conditions match
 * against. It's a set, it only grows, and it's capped — so a bot cycling
 * thousands of QR ids can't grow a user document without bound.
 *
 * ## Why the token is a namespaced string
 *
 * `qr:berlin-window`, not `{ type: "qr", id: "berlin-window" }`. A flat string
 * survives a Firestore `array-contains` query, which is what makes "every account
 * that came off this poster" answerable at all. The namespace prefix keeps a QR
 * id from ever colliding with a UTM campaign of the same name.
 *
 * Pure module: no browser APIs (the client half lives in `platform/acquisition`),
 * no Firebase.
 */

/** Arrival channels we can distinguish. `direct` means we learned nothing. */
export const ARRIVAL_KINDS = ["qr", "link", "referral", "affiliate", "utm", "direct"] as const;

export type ArrivalKind = (typeof ARRIVAL_KINDS)[number];

export const ARRIVAL_KIND_LABELS: Record<ArrivalKind, string> = {
  qr: "QR code",
  link: "Tracked link",
  referral: "Customer referral",
  affiliate: "Affiliate",
  utm: "Campaign link",
  direct: "Direct",
};

/** Longest token we'll store. Long enough for a UTM pair, short enough to index. */
export const MAX_ARRIVAL_TOKEN_LENGTH = 64;

/** Most tokens kept per account. Past this the oldest are dropped. */
export const MAX_ARRIVAL_TOKENS = 40;

/**
 * Fold an identifier to the safe subset: lower-case, alphanumerics plus `-` and
 * `_`. Everything a QR id, link token or UTM value can legitimately contain, and
 * nothing that could break out of a namespaced token or a Firestore field path.
 */
export function normalizeArrivalId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ARRIVAL_TOKEN_LENGTH - 4);
}

/**
 * Build the namespaced token an audience matches on (`qr:berlin-window`).
 *
 * Truncated against the whole token, not just the id: the namespaces are
 * different lengths (`qr:` against `affiliate:`), so trimming the id alone would
 * let the longest prefix push the result past what's indexable.
 */
export function arrivalToken(kind: ArrivalKind, id: string): string {
  const normalized = normalizeArrivalId(id);
  if (!normalized) return kind;
  return `${kind}:${normalized}`.slice(0, MAX_ARRIVAL_TOKEN_LENGTH);
}

/** Split a token back into its parts, for display. */
export function parseArrivalToken(token: string): { kind: ArrivalKind; id: string } {
  const [head, ...rest] = token.split(":");
  const kind = (ARRIVAL_KINDS as readonly string[]).includes(head)
    ? (head as ArrivalKind)
    : "direct";
  return { kind, id: rest.join(":") };
}

/** Human-readable form of a token, for the admin report and support view. */
export function describeArrivalToken(token: string): string {
  const { kind, id } = parseArrivalToken(token);
  return id ? `${ARRIVAL_KIND_LABELS[kind]} · ${id}` : ARRIVAL_KIND_LABELS[kind];
}

/** One arrival, as recorded. */
export interface ArrivalRecord {
  /** The namespaced token — the thing audiences match on. */
  token: string;
  kind: ArrivalKind;
  /** The bare id inside the token. */
  id: string;
  /** UTM triple, when the link carried one. */
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** Path they landed on, no query string (which can carry personal data). */
  landingPath: string | null;
  /** Referring HOST only, for the same reason. */
  referrerHost: string | null;
  at: number;
}

/**
 * The `users/{uid}.acquisition` sub-object.
 *
 * Server-owned: the client proposes an arrival, the backend decides what to
 * record. A client that could write this directly could grant itself any
 * arrival-gated coupon in the system.
 */
export interface AcquisitionProfile {
  first: ArrivalRecord | null;
  latest: ArrivalRecord | null;
  /** Union of every token ever seen. What `array-contains` queries hit. */
  tokens: string[];
  /** Total arrivals recorded, including ones that only updated `latest`. */
  arrivals: number;
}

export function emptyAcquisitionProfile(): AcquisitionProfile {
  return { first: null, latest: null, tokens: [], arrivals: 0 };
}

/**
 * What the client is allowed to propose. A narrow, dumb shape on purpose — every
 * field is re-normalized server-side, and nothing here is trusted.
 */
export interface ArrivalProposal {
  kind?: string;
  id?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  landingPath?: string;
  referrer?: string;
  at?: number;
}

function cleanText(raw: unknown, max = 64): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, max);
  return value || null;
}

/**
 * Reduce a referrer to its host.
 *
 * A full referrer URL can carry a search query, a session id, or somebody's
 * email in a path — none of which we want on a user document forever. The host
 * is the entire analytic value of the field.
 */
function referrerHost(raw: unknown): string | null {
  const value = cleanText(raw, 300);
  if (!value) return null;
  try {
    return new URL(value).host.slice(0, 100) || null;
  } catch {
    return null;
  }
}

/** Strip a landing path of its query and fragment. */
function landingPath(raw: unknown): string | null {
  const value = cleanText(raw, 200);
  if (!value) return null;
  const path = value.split(/[?#]/)[0];
  return path.startsWith("/") ? path.slice(0, 200) : null;
}

/**
 * Turn an untrusted proposal into a record, or reject it.
 *
 * Returns null when there's nothing worth recording — an unknown kind, or an
 * arrival with no identifier at all. A `direct` arrival is not recorded: writing
 * "we learned nothing" to a user document on every visit would be a write per
 * page view for zero information.
 */
export function normalizeArrival(
  proposal: ArrivalProposal,
  at = Date.now(),
): ArrivalRecord | null {
  const kind = (ARRIVAL_KINDS as readonly string[]).includes(proposal.kind ?? "")
    ? (proposal.kind as ArrivalKind)
    : null;
  if (!kind || kind === "direct") return null;

  const id = normalizeArrivalId(proposal.id ?? "");
  const source = cleanText(proposal.source);
  const campaign = cleanText(proposal.campaign);
  // A UTM arrival identifies itself by its source/campaign pair when it has no
  // explicit id, so a plain `?utm_source=newsletter` link is still attributable.
  const resolvedId = id || (kind === "utm" ? normalizeArrivalId(source ?? campaign ?? "") : "");
  if (!resolvedId) return null;

  return {
    token: arrivalToken(kind, resolvedId),
    kind,
    id: resolvedId,
    source,
    medium: cleanText(proposal.medium),
    campaign,
    landingPath: landingPath(proposal.landingPath),
    referrerHost: referrerHost(proposal.referrer),
    // A client-supplied timestamp is only ever accepted as a sanity-checked
    // hint; anything in the future or absurdly old becomes "now".
    at:
      typeof proposal.at === "number" &&
      Number.isFinite(proposal.at) &&
      proposal.at > 0 &&
      proposal.at <= at + 60_000
        ? Math.round(proposal.at)
        : at,
  };
}

/**
 * Fold a new arrival into an existing profile.
 *
 * Pure, so the backend transaction and the invariant script run the same merge.
 * `first` is written once and never again — a first touch that can be overwritten
 * isn't a first touch.
 */
export function mergeArrival(
  profile: AcquisitionProfile,
  arrival: ArrivalRecord,
): AcquisitionProfile {
  const tokens = profile.tokens.includes(arrival.token)
    ? profile.tokens
    : // Newest last, oldest dropped first: a capped set that keeps recent
      // arrivals is more useful than one that keeps ancient ones.
      [...profile.tokens, arrival.token].slice(-MAX_ARRIVAL_TOKENS);
  return {
    first: profile.first ?? arrival,
    latest: arrival,
    tokens,
    arrivals: profile.arrivals + 1,
  };
}

export function normalizeAcquisitionProfile(raw: unknown): AcquisitionProfile {
  const p = (raw ?? {}) as Record<string, unknown>;
  const record = (value: unknown): ArrivalRecord | null => {
    if (!value || typeof value !== "object") return null;
    const r = value as Record<string, unknown>;
    if (typeof r.token !== "string" || !r.token) return null;
    const { kind, id } = parseArrivalToken(r.token);
    return {
      token: r.token.slice(0, MAX_ARRIVAL_TOKEN_LENGTH),
      kind,
      id,
      source: cleanText(r.source),
      medium: cleanText(r.medium),
      campaign: cleanText(r.campaign),
      landingPath: landingPath(r.landingPath),
      referrerHost: cleanText(r.referrerHost, 100),
      at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
    };
  };
  const tokens = Array.isArray(p.tokens)
    ? Array.from(
        new Set(
          p.tokens
            .filter((t): t is string => typeof t === "string" && t.length > 0)
            .map((t) => t.slice(0, MAX_ARRIVAL_TOKEN_LENGTH)),
        ),
      ).slice(-MAX_ARRIVAL_TOKENS)
    : [];
  return {
    first: record(p.first),
    latest: record(p.latest),
    tokens,
    arrivals: typeof p.arrivals === "number" && p.arrivals > 0 ? Math.round(p.arrivals) : 0,
  };
}

/**
 * Does this account's arrival history satisfy an `arrivedVia` filter?
 *
 * An empty filter matches everything (the filter is unset, not "matches
 * nothing"), and a filter entry may be either a full token (`qr:berlin-window`)
 * or a bare kind (`qr`, meaning "any QR arrival").
 */
export function matchesArrival(tokens: string[], arrivedVia: string[]): boolean {
  if (arrivedVia.length === 0) return true;
  return arrivedVia.some((filter) => {
    if (tokens.includes(filter)) return true;
    return (
      (ARRIVAL_KINDS as readonly string[]).includes(filter) &&
      tokens.some((token) => parseArrivalToken(token).kind === filter)
    );
  });
}
