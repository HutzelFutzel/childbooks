/**
 * Shared diagnostic log schema, redaction utilities, and export formatters.
 *
 * Pure data + pure functions only (no Firebase, no React, no Node-only APIs) so
 * both `functions/` and `books-frontend/` can share the exact same contract.
 *
 * Design principles:
 *   - 4 strict severity levels (`info` | `warn` | `error` | `fatal`) — no debug
 *     noise. Only `fatal` pages Slack (`#ops`), and every Slack alert is deduped
 *     on `ref`.
 *   - Every entry carries its `source` (`frontend` | `backend` | `worker` |
 *     `webhook` | `cron`), a `domain` (`studio` | `ai` | `print` | `stripe` |
 *     `auth` | `email` | `system`), and correlation anchors (`uid`, `projectId`,
 *     `sessionId`, `requestId`, `jobId`, `orderId`, `paymentId`).
 *   - Structured `context` is automatically scrubbed of secret/token keys and
 *     bounded in size before persisting.
 */
import { z } from "zod";

export const LOG_SEVERITIES = ["info", "warn", "error", "fatal"] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

export const LOG_SOURCES = ["frontend", "backend", "worker", "webhook", "cron"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_DOMAINS = [
  "studio",
  "ai",
  "print",
  "stripe",
  "auth",
  "email",
  "system",
] as const;
export type LogDomain = (typeof LOG_DOMAINS)[number];

export const LOG_ENVIRONMENTS = ["dev", "sandbox", "live"] as const;
export type LogEnvironment = (typeof LOG_ENVIRONMENTS)[number];

export interface LogErrorDetail {
  name: string;
  message: string;
  code?: string;
  stack?: string;
  provider?: string;
  status?: number;
  retryable?: boolean;
}

export interface LogEntry {
  id: string;
  /** Epoch milliseconds when the event occurred. */
  at: number;
  severity: LogSeverity;
  source: LogSource;
  domain: LogDomain;
  /** Dot-separated event key, e.g. `ai.illustration.failed`, `ui.crash`. */
  event: string;
  /** Concise human-readable summary of what happened. */
  message: string;
  env: LogEnvironment;

  // ---- Correlation anchors (all optional; indexed/filtered by the dashboard)
  uid?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;

  /** Structured error breakdown when an exception or failure was captured. */
  error?: LogErrorDetail | null;

  /**
   * High-signal structured state (e.g. step, model, durationMs, route,
   * componentId, recent breadcrumbs). Never holds raw base64 images or secrets.
   */
  context?: Record<string, unknown> | null;

  /** Idempotency key for Slack fatal notifications and alert deduplication. */
  ref?: string | null;

  /** When a fatal/error log was marked resolved by an admin. */
  resolvedAt?: number | null;
  resolvedBy?: string | null;
}

/** Client-side breadcrumb kept in a ring buffer and attached to frontend warnings/errors. */
export interface ClientBreadcrumb {
  at: number;
  category: "route" | "ui" | "api" | "studio" | "auth";
  action: string;
  detail?: string;
}

// ---- Redaction & Bounding --------------------------------------------------

const SENSITIVE_KEY_RE =
  /^(authorization|x-auth-token|x-firebase-appcheck|cookie|set-cookie|password|secret|token|api[-_]?key|client[-_]?secret|webhook[-_]?secret|private[-_]?key|credit[-_]?card|cvv)$/i;

const DATA_URL_RE = /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i;

const MAX_STRING_LEN = 2_000;
const MAX_STACK_LEN = 4_000;
const MAX_DEPTH = 4;
const MAX_KEYS_PER_OBJECT = 40;
const MAX_ARRAY_ITEMS = 30;

/**
 * Sanitize and bound an arbitrary context payload so it is safe for Firestore
 * (no `undefined`, no functions/symbols, no secrets, no base64 image blobs).
 */
export function sanitizeLogContext(
  input: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, unknown> = {};
  const entries = Object.entries(input as Record<string, unknown>).slice(
    0,
    MAX_KEYS_PER_OBJECT,
  );
  for (const [rawKey, rawVal] of entries) {
    const key = rawKey.trim().slice(0, 80);
    if (!key) continue;
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    const cleaned = sanitizeValue(rawVal, depth + 1);
    if (cleaned !== undefined) {
      out[key] = cleaned;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeValue(val: unknown, depth: number): unknown {
  if (val === null) return null;
  if (val === undefined) return undefined;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return Number.isFinite(val) ? val : String(val);
  if (typeof val === "string") {
    if (DATA_URL_RE.test(val)) return "[BASE64_DATA_URL_OMITTED]";
    if (val.length > 500 && /^[A-Za-z0-9+/=]+$/.test(val.slice(0, 200))) {
      return `[BASE64_BLOB_${val.length}_CHARS]`;
    }
    return val.length > MAX_STRING_LEN
      ? `${val.slice(0, MAX_STRING_LEN)}… [truncated ${val.length - MAX_STRING_LEN} chars]`
      : val;
  }
  if (val instanceof Error) {
    return extractErrorDetail(val);
  }
  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }
  if (Array.isArray(val)) {
    return val
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof val === "object") {
    return sanitizeLogContext(val, depth);
  }
  return String(val).slice(0, MAX_STRING_LEN);
}

/** Extract a structured, Firestore-safe `LogErrorDetail` from any thrown value. */
export function extractErrorDetail(err: unknown): LogErrorDetail | null {
  if (!err) return null;
  if (err instanceof Error) {
    const anyErr = err as Error & {
      code?: unknown;
      kind?: unknown;
      provider?: unknown;
      status?: unknown;
      retryable?: unknown;
    };
    const code =
      typeof anyErr.code === "string"
        ? anyErr.code
        : typeof anyErr.kind === "string"
          ? anyErr.kind
          : undefined;
    return {
      name: (err.name || "Error").slice(0, 120),
      message: (err.message || "Unknown error").slice(0, MAX_STRING_LEN),
      ...(code ? { code: code.slice(0, 120) } : {}),
      ...(typeof anyErr.stack === "string"
        ? { stack: anyErr.stack.slice(0, MAX_STACK_LEN) }
        : {}),
      ...(typeof anyErr.provider === "string"
        ? { provider: anyErr.provider.slice(0, 60) }
        : {}),
      ...(typeof anyErr.status === "number" && Number.isFinite(anyErr.status)
        ? { status: anyErr.status }
        : {}),
      ...(typeof anyErr.retryable === "boolean"
        ? { retryable: anyErr.retryable }
        : {}),
    };
  }
  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const message =
      typeof o.message === "string"
        ? o.message
        : JSON.stringify(sanitizeLogContext(o) ?? {}).slice(0, 500);
    return {
      name: typeof o.name === "string" ? o.name.slice(0, 120) : "Error",
      message: message.slice(0, MAX_STRING_LEN),
      ...(typeof o.code === "string" ? { code: o.code.slice(0, 120) } : {}),
      ...(typeof o.stack === "string" ? { stack: o.stack.slice(0, MAX_STACK_LEN) } : {}),
    };
  }
  return {
    name: "Error",
    message: String(err).slice(0, MAX_STRING_LEN),
  };
}

// ---- Client Ingest Validation Schema ---------------------------------------

export const clientLogErrorSchema = z.object({
  name: z.string().max(120),
  message: z.string().max(MAX_STRING_LEN),
  code: z.string().max(120).optional(),
  stack: z.string().max(MAX_STACK_LEN).optional(),
  provider: z.string().max(60).optional(),
  status: z.number().int().optional(),
  retryable: z.boolean().optional(),
});

export const clientLogItemSchema = z.object({
  at: z.number().int().optional(),
  severity: z.enum(["info", "warn", "error", "fatal"]),
  domain: z.enum(LOG_DOMAINS),
  event: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(MAX_STRING_LEN),
  projectId: z.string().trim().max(200).nullable().optional(),
  sessionId: z.string().trim().max(120).nullable().optional(),
  requestId: z.string().trim().max(120).nullable().optional(),
  jobId: z.string().trim().max(120).nullable().optional(),
  orderId: z.string().trim().max(120).nullable().optional(),
  paymentId: z.string().trim().max(120).nullable().optional(),
  error: clientLogErrorSchema.nullable().optional(),
  context: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const clientLogBatchSchema = z.object({
  entries: z.array(clientLogItemSchema).min(1).max(25),
});

export type ClientLogItemInput = z.infer<typeof clientLogItemSchema>;

// ---- AI Log Analysis Output Schema -----------------------------------------

export const logAnalysisOutputSchema = z.object({
  summary: z.string(),
  rootCause: z.string(),
  userImpact: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  suspectedFiles: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
    }),
  ),
  recommendedActions: z.array(z.string()),
  reproductionSteps: z.array(z.string()),
});

export type LogAnalysisResult = z.infer<typeof logAnalysisOutputSchema>;

// ---- Copy / Export Formatters (for Cursor / Claude / Support) --------------

export interface FormatLogsOptions {
  filters?: {
    from?: number;
    to?: number;
    severities?: LogSeverity[];
    sources?: LogSource[];
    domains?: LogDomain[];
    uid?: string;
    projectId?: string;
    sessionId?: string;
    search?: string;
  };
  aiAnalysis?: LogAnalysisResult | null;
}

/**
 * Format a slice of logs into a structured Markdown bundle designed to be
 * pasted directly into Cursor, Claude, or a GitHub issue with full context.
 */
export function formatLogsAsMarkdown(
  entries: LogEntry[],
  opts: FormatLogsOptions = {},
): string {
  const lines: string[] = [];
  lines.push("# Diagnostic Log Bundle");
  lines.push("");

  const f = opts.filters;
  if (f) {
    const filterParts: string[] = [];
    if (f.from && f.to) {
      filterParts.push(
        `Window: ${new Date(f.from).toISOString()} → ${new Date(f.to).toISOString()}`,
      );
    }
    if (f.uid) filterParts.push(`User: \`${f.uid}\``);
    if (f.projectId) filterParts.push(`Project: \`${f.projectId}\``);
    if (f.sessionId) filterParts.push(`Session: \`${f.sessionId}\``);
    if (f.severities?.length) filterParts.push(`Severities: ${f.severities.join(", ")}`);
    if (f.sources?.length) filterParts.push(`Sources: ${f.sources.join(", ")}`);
    if (f.domains?.length) filterParts.push(`Domains: ${f.domains.join(", ")}`);
    if (f.search) filterParts.push(`Query: "${f.search}"`);
    if (filterParts.length > 0) {
      lines.push(`**Scope:** ${filterParts.join(" · ")}`);
      lines.push(`**Total entries:** ${entries.length}`);
      lines.push("");
    }
  }

  if (opts.aiAnalysis) {
    const a = opts.aiAnalysis;
    lines.push("## AI Root-Cause Analysis");
    lines.push(`- **Summary:** ${a.summary}`);
    lines.push(`- **Root cause (${a.confidence} confidence):** ${a.rootCause}`);
    lines.push(`- **User impact:** ${a.userImpact}`);
    if (a.suspectedFiles.length > 0) {
      lines.push(
        `- **Suspected files:** ${a.suspectedFiles.map((sf) => `\`${sf.path}\` (${sf.reason})`).join(", ")}`,
      );
    }
    if (a.recommendedActions.length > 0) {
      lines.push("- **Recommended actions:**");
      for (const act of a.recommendedActions) lines.push(`  - ${act}`);
    }
    lines.push("");
  }

  lines.push("## Chronological Timeline (Oldest → Newest)");
  lines.push("");

  // Sort oldest-first so a story reads top-to-bottom when debugging.
  const chronological = [...entries].sort((a, b) => a.at - b.at);

  for (const entry of chronological) {
    const iso = new Date(entry.at).toISOString();
    const sev = entry.severity.toUpperCase();
    const anchors = [
      entry.uid ? `uid=${entry.uid}` : null,
      entry.projectId ? `project=${entry.projectId}` : null,
      entry.sessionId ? `session=${entry.sessionId}` : null,
      entry.requestId ? `req=${entry.requestId}` : null,
      entry.jobId ? `job=${entry.jobId}` : null,
      entry.orderId ? `order=${entry.orderId}` : null,
      entry.paymentId ? `payment=${entry.paymentId}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    lines.push(
      `### [${iso}] [${sev}] [${entry.source}/${entry.domain}] \`${entry.event}\``,
    );
    if (anchors) {
      lines.push(`- **Anchors:** \`${anchors}\` · env=\`${entry.env}\``);
    }
    lines.push(`- **Message:** ${entry.message}`);
    if (entry.error) {
      const codePart = entry.error.code ? ` (code: ${entry.error.code})` : "";
      const statusPart = entry.error.status ? ` [HTTP ${entry.error.status}]` : "";
      lines.push(
        `- **Error:** \`${entry.error.name}${codePart}${statusPart}\`: ${entry.error.message}`,
      );
      if (entry.error.stack) {
        lines.push("```text");
        lines.push(entry.error.stack);
        lines.push("```");
      }
    }
    if (entry.context && Object.keys(entry.context).length > 0) {
      lines.push("```json");
      lines.push(JSON.stringify(entry.context, null, 2));
      lines.push("```");
    }
    lines.push("");
  }

  return lines.join("\n");
}
