/**
 * Structured diagnostic logging + Slack fatal escalation + AI log analysis.
 *
 * Bridges three worlds that were previously separate:
 *   1. Ephemeral console/Cloud Logging lines (`logger.info` / `console.error`)
 *      that vanished from the admin dashboard.
 *   2. Business/operational alerts (`raiseAlert` → Slack `#ops`).
 *   3. Per-user / per-book timeline reconstruction (`systemLogs`), queryable by
 *      time window, severity, source (`frontend` | `backend` | `worker` |
 *      `webhook` | `cron`), domain, `uid`, `projectId`, `sessionId`, `jobId`,
 *      `orderId`, `paymentId`, and free-text search.
 *
 * Hard rules:
 *   - NEVER THROW: logging is strictly best-effort and must never break the
 *     request, webhook, or background worker that called it.
 *   - HIGH SIGNAL ONLY: 4 severities (`info`, `warn`, `error`, `fatal`).
 *     No debug spam.
 *   - SLACK DISCIPLINE: only `fatal` events page `#ops` (via `raiseAlert` with
 *     `severity: "critical"` and `ref` deduplication).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { ensureAdmin } from "./storage";
import { serverConfig } from "./config";
import { raiseAlert, resolveAlert } from "./alerts";
import type { AuthedRequest } from "./auth";
import { getPromptsConfig } from "./appConfig";
import { apiKeyFor, resolveTextAction } from "./modelResolve";
import { recordUsage, withUsage } from "./usage";
import { getTextProvider } from "../../books-frontend/src/core/providers";
import { renderTextPrompt } from "../../books-frontend/src/core/prompts/render";
import {
  clientLogBatchSchema,
  extractErrorDetail,
  LOG_DOMAINS,
  LOG_SEVERITIES,
  LOG_SOURCES,
  logAnalysisOutputSchema,
  sanitizeLogContext,
  type LogAnalysisResult,
  type LogDomain,
  type LogEntry,
  type LogEnvironment,
  type LogSeverity,
  type LogSource,
} from "../../books-frontend/src/core/logging/types";

const COLLECTION = "systemLogs";

/** 30 days for routine info/warn milestones; 90 days for errors and fatals. */
const RETENTION_INFO_WARN_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_ERROR_FATAL_MS = 90 * 24 * 60 * 60 * 1000;

/** Header the frontend sends to correlate browser logs with backend HTTP calls. */
export const CLIENT_SESSION_HEADER = "x-client-session";
export const REQUEST_ID_HEADER = "x-request-id";

export interface AmbientLogContext {
  requestId?: string | null;
  uid?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  jobId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  source?: LogSource;
}

const logStorage = new AsyncLocalStorage<AmbientLogContext>();

/** Run `fn` inside an ambient log context so downstream `log.*` calls inherit IDs. */
export function withLogContext<T>(ctx: AmbientLogContext, fn: () => T): T {
  const parent = logStorage.getStore() ?? {};
  return logStorage.run({ ...parent, ...ctx }, fn);
}

/** Mutate the current ambient log context in-place (e.g. after `attachUser` resolves `uid`). */
export function patchLogContext(patch: Partial<AmbientLogContext>): void {
  const store = logStorage.getStore();
  if (store) {
    Object.assign(store, patch);
  }
}

/** Read the active ambient log context, if any. */
export function currentLogContext(): AmbientLogContext {
  return logStorage.getStore() ?? {};
}

function db() {
  ensureAdmin();
  return getFirestore();
}

function currentLogEnv(): LogEnvironment {
  if (process.env.FUNCTIONS_EMULATOR === "true") return "dev";
  try {
    return serverConfig().stripe.env === "live" ? "live" : "sandbox";
  } catch {
    return "sandbox";
  }
}

export interface WriteLogOptions {
  severity: LogSeverity;
  source?: LogSource;
  domain: LogDomain;
  event: string;
  message: string;
  uid?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  error?: unknown;
  context?: Record<string, unknown> | null;
  /**
   * Optional idempotency / deduplication key. When set on a `fatal` log, Slack
   * `#ops` is paged at most once per underlying incident (`{event}_{ref}`).
   */
  ref?: string | null;
  /** Override timestamp (used by batched frontend logs). */
  at?: number;
  /** Skip raising an `adminAlerts` / Slack notification even if fatal (e.g. when called from `raiseAlert` itself). */
  skipAlert?: boolean;
}

/**
 * Write a structured diagnostic log entry to Firestore (`systemLogs`) and emit
 * a structured line to Cloud Functions logger. If `severity === "fatal"`, also
 * escalates to `adminAlerts` and Slack `#ops` (deduped on `ref`).
 *
 * Strictly best-effort: never throws.
 */
export async function writeLog(opts: WriteLogOptions): Promise<string | null> {
  try {
    const ambient = currentLogContext();
    const now = Date.now();
    const at =
      typeof opts.at === "number" && Number.isFinite(opts.at) && Math.abs(now - opts.at) < 7 * 86_400_000
        ? opts.at
        : now;

    const severity: LogSeverity = opts.severity;
    const source: LogSource = opts.source ?? ambient.source ?? "backend";
    const domain: LogDomain = opts.domain;
    const event = opts.event.trim().slice(0, 120) || "system.unknown";
    const message = opts.message.trim().slice(0, 2000) || event;
    const env = currentLogEnv();

    const uid = opts.uid !== undefined ? opts.uid : (ambient.uid ?? null);
    const projectId = opts.projectId !== undefined ? opts.projectId : (ambient.projectId ?? null);
    const sessionId = opts.sessionId !== undefined ? opts.sessionId : (ambient.sessionId ?? null);
    const requestId = opts.requestId !== undefined ? opts.requestId : (ambient.requestId ?? null);
    const jobId = opts.jobId !== undefined ? opts.jobId : (ambient.jobId ?? null);
    const orderId = opts.orderId !== undefined ? opts.orderId : (ambient.orderId ?? null);
    const paymentId = opts.paymentId !== undefined ? opts.paymentId : (ambient.paymentId ?? null);

    const errorDetail =
      opts.error && typeof opts.error === "object" && "name" in opts.error && "message" in opts.error
        ? extractErrorDetail(opts.error)
        : opts.error
          ? extractErrorDetail(opts.error)
          : null;

    const cleanContext = sanitizeLogContext(opts.context);
    const ref = opts.ref ? opts.ref.trim().slice(0, 160) : null;

    const retentionMs =
      severity === "error" || severity === "fatal"
        ? RETENTION_ERROR_FATAL_MS
        : RETENTION_INFO_WARN_MS;

    const id = randomUUID();
    const doc: Record<string, unknown> = {
      id,
      at,
      expiresAt: new Date(at + retentionMs),
      severity,
      source,
      domain,
      event,
      message,
      env,
      uid: uid || null,
      projectId: projectId || null,
      sessionId: sessionId || null,
      requestId: requestId || null,
      jobId: jobId || null,
      orderId: orderId || null,
      paymentId: paymentId || null,
      ...(errorDetail ? { error: errorDetail } : {}),
      ...(cleanContext ? { context: cleanContext } : {}),
      ...(ref ? { ref } : {}),
      resolvedAt: null,
      resolvedBy: null,
    };

    // 1. Emit structured console/Cloud Logging output for local dev + GCP logs.
    const consolePayload = {
      event,
      source,
      domain,
      env,
      ...(uid ? { uid } : {}),
      ...(projectId ? { projectId } : {}),
      ...(jobId ? { jobId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(paymentId ? { paymentId } : {}),
      ...(errorDetail ? { error: errorDetail } : {}),
      ...(cleanContext ? { context: cleanContext } : {}),
    };
    if (severity === "fatal" || severity === "error") {
      logger.error(`[${source}:${domain}] ${event} — ${message}`, consolePayload);
    } else if (severity === "warn") {
      logger.warn(`[${source}:${domain}] ${event} — ${message}`, consolePayload);
    } else {
      logger.info(`[${source}:${domain}] ${event} — ${message}`, consolePayload);
    }

    // 2. Persist to Firestore `systemLogs/{id}`.
    ensureAdmin();
    await db().collection(COLLECTION).doc(id).set(doc);

    // 3. Escalate `fatal` events to `adminAlerts` + Slack `#ops` (unless already coming from `raiseAlert`).
    if (severity === "fatal" && !opts.skipAlert) {
      const appUrl = serverConfig().stripe.appUrl?.replace(/\/$/, "") || "";
      const logsLink = appUrl ? `\nInspect: ${appUrl}/admin/analysis/logs` : "";
      const anchorSummary = [
        uid ? `uid: \`${uid}\`` : null,
        projectId ? `book: \`${projectId}\`` : null,
        orderId ? `order: \`${orderId}\`` : null,
        paymentId ? `payment: \`${paymentId}\`` : null,
        jobId ? `job: \`${jobId}\`` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const slackMessage =
        `${message}` +
        (anchorSummary ? `\n${anchorSummary}` : "") +
        logsLink;

      await raiseAlert({
        severity: "critical",
        kind: event,
        message: slackMessage,
        meta: {
          logId: id,
          domain,
          source,
          ...(uid ? { uid } : {}),
          ...(projectId ? { projectId } : {}),
          ...(orderId ? { orderId } : {}),
          ...(paymentId ? { paymentId } : {}),
          ...(jobId ? { jobId } : {}),
          ...(cleanContext ?? {}),
        },
        ref: ref ?? `${event}_${Math.floor(at / (15 * 60_000))}`,
        skipSystemLog: true,
      });
    }

    return id;
  } catch (err) {
    console.error("[logs] failed to write diagnostic log", opts.event, err);
    return null;
  }
}

export type LogHelperArgs = Omit<WriteLogOptions, "severity">;

export const log = {
  info: (args: LogHelperArgs) => writeLog({ ...args, severity: "info" }),
  warn: (args: LogHelperArgs) => writeLog({ ...args, severity: "warn" }),
  error: (args: LogHelperArgs) => writeLog({ ...args, severity: "error" }),
  fatal: (args: LogHelperArgs) => writeLog({ ...args, severity: "fatal" }),
};

// ---- Express Request Context & Unhandled Error Middleware -------------------

/**
 * Attach an ambient log context (`requestId`, `sessionId`, `uid`) to every
 * incoming HTTP request, and automatically log any 5xx response that finished
 * without an explicit error log.
 */
export function requestLogMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const rawReqId = req.get(REQUEST_ID_HEADER)?.trim();
  const requestId =
    rawReqId && rawReqId.length <= 120 ? rawReqId : randomUUID();
  const rawSession = req.get(CLIENT_SESSION_HEADER)?.trim();
  const sessionId =
    rawSession && rawSession.length <= 120 ? rawSession : null;

  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  withLogContext(
    {
      requestId,
      sessionId,
      uid: req.uid ?? null,
      source: "backend",
    },
    () => {
      res.on("finish", () => {
        if (res.statusCode >= 500 && !req.path.startsWith("/logs")) {
          const durationMs = Date.now() - startedAt;
          void writeLog({
            severity: "error",
            source: "backend",
            domain: inferDomainFromPath(req.path),
            event: "http.5xx",
            message: `${req.method} ${req.path} responded with HTTP ${res.statusCode} (${durationMs}ms)`,
            uid: req.uid ?? null,
            sessionId,
            requestId,
            context: {
              method: req.method,
              path: req.path,
              status: res.statusCode,
              durationMs,
            },
          });
        }
      });
      next();
    },
  );
}

function inferDomainFromPath(path: string): LogDomain {
  if (path.startsWith("/print") || path.includes("/orders")) return "print";
  if (path.startsWith("/checkout") || path.startsWith("/stripe") || path.includes("/payments")) return "stripe";
  if (path.startsWith("/ai") || path.startsWith("/likeness")) return "ai";
  if (path.startsWith("/auth") || path.startsWith("/session")) return "auth";
  if (path.includes("/email")) return "email";
  if (path.startsWith("/account/renders") || path.startsWith("/internal/render")) return "studio";
  return "system";
}

// ---- Client Log Ingestion (Rate-limited, Sanitized) ------------------------

const CLIENT_LOGS_PER_MINUTE = 60;
const clientLogWindows = new Map<string, { start: number; count: number }>();

/** Track client crash spikes so a widespread frontend break still pages `#ops`. */
const clientCrashTimestamps: number[] = [];
const CLIENT_CRASH_SPIKE_WINDOW_MS = 10 * 60_000;
const CLIENT_CRASH_SPIKE_THRESHOLD = 4;

function checkClientLogQuota(key: string, count: number, now: number): boolean {
  const entry = clientLogWindows.get(key);
  if (!entry || now - entry.start >= 60_000) {
    if (clientLogWindows.size > 5000) {
      for (const [k, v] of clientLogWindows) {
        if (now - v.start >= 60_000) clientLogWindows.delete(k);
      }
    }
    clientLogWindows.set(key, { start: now, count });
    return count <= CLIENT_LOGS_PER_MINUTE;
  }
  entry.count += count;
  return entry.count <= CLIENT_LOGS_PER_MINUTE;
}

function recordClientCrashAndCheckSpike(now: number): boolean {
  while (
    clientCrashTimestamps.length > 0 &&
    now - clientCrashTimestamps[0]! > CLIENT_CRASH_SPIKE_WINDOW_MS
  ) {
    clientCrashTimestamps.shift();
  }
  clientCrashTimestamps.push(now);
  return clientCrashTimestamps.length >= CLIENT_CRASH_SPIKE_THRESHOLD;
}

export function registerClientLogRoute(app: Express): void {
  const json = express.json({ limit: "128kb" });

  // Open to both guests and signed-in users (`attachUser` already ran so
  // `req.uid` is populated when signed in, and tokenless crashes on `/checkout`
  // or landing pages are still captured).
  app.post("/logs", json, async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = clientLogBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Invalid log batch." } });
        return;
      }
      const now = Date.now();
      const rateKey = req.uid || req.ip || "anon";
      if (!checkClientLogQuota(rateKey, parsed.data.entries.length, now)) {
        res.status(202).json({ accepted: 0, dropped: parsed.data.entries.length });
        return;
      }

      const headerSession = req.get(CLIENT_SESSION_HEADER)?.trim() || null;

      await Promise.all(
        parsed.data.entries.map(async (item) => {
          // A single browser cannot directly declare a Slack-paging `fatal`
          // unless multiple client crashes spike within 10 minutes.
          const isCrash =
            item.event === "ui.crash" ||
            item.event === "ui.unhandled_error" ||
            item.severity === "fatal";
          const spike = isCrash && recordClientCrashAndCheckSpike(now);
          const effectiveSeverity: LogSeverity = spike
            ? "fatal"
            : item.severity === "fatal"
              ? "error"
              : item.severity;

          await writeLog({
            at: item.at,
            severity: effectiveSeverity,
            source: "frontend",
            domain: item.domain,
            event: item.event,
            message: item.message,
            uid: req.uid ?? null,
            projectId: item.projectId ?? null,
            sessionId: item.sessionId ?? headerSession,
            requestId: item.requestId ?? null,
            jobId: item.jobId ?? null,
            orderId: item.orderId ?? null,
            paymentId: item.paymentId ?? null,
            error: item.error ?? null,
            context: item.context ?? null,
            ref: spike
              ? `frontend_crash_spike_${Math.floor(now / CLIENT_CRASH_SPIKE_WINDOW_MS)}`
              : null,
          });
        }),
      );

      res.status(202).json({ accepted: parsed.data.entries.length });
    } catch {
      // Never 500 a telemetry beacon.
      res.status(202).json({ accepted: 0 });
    }
  });
}

// ---- Query & Filter Engine (Admin) -----------------------------------------

export interface LogQueryFilters {
  fromMs: number;
  toMs: number;
  severities?: LogSeverity[];
  sources?: LogSource[];
  domains?: LogDomain[];
  uid?: string;
  projectId?: string;
  sessionId?: string;
  requestId?: string;
  jobId?: string;
  orderId?: string;
  paymentId?: string;
  event?: string;
  search?: string;
  unresolvedOnly?: boolean;
  limit?: number;
}

export interface LogQueryResult {
  entries: LogEntry[];
  counts: {
    total: number;
    info: number;
    warn: number;
    error: number;
    fatal: number;
    unresolvedFatal: number;
  };
  facets: {
    byDomain: Record<string, number>;
    bySource: Record<string, number>;
    topEvents: Array<{ event: string; count: number; severity: LogSeverity }>;
  };
  capped: boolean;
  scanned: number;
}

function docToLogEntry(id: string, raw: Record<string, unknown>): LogEntry {
  return {
    id,
    at: typeof raw.at === "number" ? raw.at : 0,
    severity: LOG_SEVERITIES.includes(raw.severity as LogSeverity)
      ? (raw.severity as LogSeverity)
      : "info",
    source: LOG_SOURCES.includes(raw.source as LogSource)
      ? (raw.source as LogSource)
      : "backend",
    domain: LOG_DOMAINS.includes(raw.domain as LogDomain)
      ? (raw.domain as LogDomain)
      : "system",
    event: typeof raw.event === "string" ? raw.event : "unknown",
    message: typeof raw.message === "string" ? raw.message : "",
    env:
      raw.env === "dev" || raw.env === "sandbox" || raw.env === "live"
        ? raw.env
        : "sandbox",
    uid: typeof raw.uid === "string" ? raw.uid : null,
    projectId: typeof raw.projectId === "string" ? raw.projectId : null,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    requestId: typeof raw.requestId === "string" ? raw.requestId : null,
    jobId: typeof raw.jobId === "string" ? raw.jobId : null,
    orderId: typeof raw.orderId === "string" ? raw.orderId : null,
    paymentId: typeof raw.paymentId === "string" ? raw.paymentId : null,
    error: (raw.error as LogEntry["error"]) ?? null,
    context: (raw.context as Record<string, unknown> | undefined) ?? null,
    ref: typeof raw.ref === "string" ? raw.ref : null,
    resolvedAt: typeof raw.resolvedAt === "number" ? raw.resolvedAt : null,
    resolvedBy: typeof raw.resolvedBy === "string" ? raw.resolvedBy : null,
  };
}

function matchesSearch(entry: LogEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (entry.event.toLowerCase().includes(needle)) return true;
  if (entry.message.toLowerCase().includes(needle)) return true;
  if (entry.uid?.toLowerCase().includes(needle)) return true;
  if (entry.projectId?.toLowerCase().includes(needle)) return true;
  if (entry.sessionId?.toLowerCase().includes(needle)) return true;
  if (entry.requestId?.toLowerCase().includes(needle)) return true;
  if (entry.jobId?.toLowerCase().includes(needle)) return true;
  if (entry.orderId?.toLowerCase().includes(needle)) return true;
  if (entry.paymentId?.toLowerCase().includes(needle)) return true;
  if (entry.error?.message.toLowerCase().includes(needle)) return true;
  if (entry.error?.code?.toLowerCase().includes(needle)) return true;
  if (entry.error?.stack?.toLowerCase().includes(needle)) return true;
  if (entry.context && JSON.stringify(entry.context).toLowerCase().includes(needle)) {
    return true;
  }
  return false;
}

export async function queryLogs(q: LogQueryFilters): Promise<LogQueryResult> {
  ensureAdmin();
  const limit = Math.min(Math.max(q.limit ?? 250, 1), 1000);
  const scanLimit = 3000;

  // When an admin filters by a specific `uid` or `projectId`, use a single-field
  // equality query so a quiet user's logs are never pushed out of the scan window
  // by a busy day elsewhere in the app (no composite index needed).
  let snap: FirebaseFirestore.QuerySnapshot;
  if (q.uid) {
    snap = await db()
      .collection(COLLECTION)
      .where("uid", "==", q.uid)
      .limit(scanLimit)
      .get();
  } else if (q.projectId) {
    snap = await db()
      .collection(COLLECTION)
      .where("projectId", "==", q.projectId)
      .limit(scanLimit)
      .get();
  } else if (q.sessionId) {
    snap = await db()
      .collection(COLLECTION)
      .where("sessionId", "==", q.sessionId)
      .limit(scanLimit)
      .get();
  } else {
    snap = await db()
      .collection(COLLECTION)
      .where("at", ">=", q.fromMs)
      .where("at", "<=", q.toMs)
      .orderBy("at", "desc")
      .limit(scanLimit)
      .get();
  }

  const sevSet = q.severities && q.severities.length > 0 ? new Set(q.severities) : null;
  const srcSet = q.sources && q.sources.length > 0 ? new Set(q.sources) : null;
  const domSet = q.domains && q.domains.length > 0 ? new Set(q.domains) : null;
  const search = q.search?.trim() ?? "";

  const counts = {
    total: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
    unresolvedFatal: 0,
  };
  const byDomain: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const eventCounts = new Map<string, { count: number; severity: LogSeverity }>();

  const matched: LogEntry[] = [];

  for (const doc of snap.docs) {
    const entry = docToLogEntry(doc.id, doc.data() as Record<string, unknown>);
    if (entry.at < q.fromMs || entry.at > q.toMs) continue;
    if (q.uid && entry.uid !== q.uid) continue;
    if (q.projectId && entry.projectId !== q.projectId) continue;
    if (q.sessionId && entry.sessionId !== q.sessionId) continue;
    if (q.requestId && entry.requestId !== q.requestId) continue;
    if (q.jobId && entry.jobId !== q.jobId) continue;
    if (q.orderId && entry.orderId !== q.orderId) continue;
    if (q.paymentId && entry.paymentId !== q.paymentId) continue;
    if (q.event && entry.event !== q.event) continue;
    if (q.unresolvedOnly && entry.resolvedAt !== null) continue;
    if (!matchesSearch(entry, search)) continue;

    // Count across severities/domains/sources before applying the pill filters so
    // the severity counters show what's in the current scope.
    counts.total += 1;
    counts[entry.severity] += 1;
    if (entry.severity === "fatal" && !entry.resolvedAt) {
      counts.unresolvedFatal += 1;
    }

    if (sevSet && !sevSet.has(entry.severity)) continue;
    if (srcSet && !srcSet.has(entry.source)) continue;
    if (domSet && !domSet.has(entry.domain)) continue;

    byDomain[entry.domain] = (byDomain[entry.domain] ?? 0) + 1;
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    const prevEvent = eventCounts.get(entry.event);
    if (!prevEvent) {
      eventCounts.set(entry.event, { count: 1, severity: entry.severity });
    } else {
      prevEvent.count += 1;
      if (
        LOG_SEVERITIES.indexOf(entry.severity) >
        LOG_SEVERITIES.indexOf(prevEvent.severity)
      ) {
        prevEvent.severity = entry.severity;
      }
    }

    matched.push(entry);
  }

  matched.sort((a, b) => b.at - a.at);

  const topEvents = [...eventCounts.entries()]
    .map(([event, data]) => ({ event, count: data.count, severity: data.severity }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    entries: matched.slice(0, limit),
    counts,
    facets: {
      byDomain,
      bySource,
      topEvents,
    },
    capped: snap.size >= scanLimit || matched.length > limit,
    scanned: snap.size,
  };
}

// ---- AI Root-Cause Analyzer ------------------------------------------------

const analyzeBodySchema = z.object({
  logIds: z.array(z.string().min(1).max(120)).max(150).optional(),
  filters: z
    .object({
      fromMs: z.number().optional(),
      toMs: z.number().optional(),
      severities: z.array(z.enum(LOG_SEVERITIES)).optional(),
      sources: z.array(z.enum(LOG_SOURCES)).optional(),
      domains: z.array(z.enum(LOG_DOMAINS)).optional(),
      uid: z.string().max(128).optional(),
      projectId: z.string().max(200).optional(),
      sessionId: z.string().max(120).optional(),
      requestId: z.string().max(120).optional(),
      jobId: z.string().max(120).optional(),
      orderId: z.string().max(120).optional(),
      paymentId: z.string().max(120).optional(),
      event: z.string().max(120).optional(),
      search: z.string().max(300).optional(),
    })
    .optional(),
  question: z.string().trim().max(1000).optional(),
});

function formatEntryForAiPrompt(entry: LogEntry): string {
  const iso = new Date(entry.at).toISOString();
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

  const parts = [
    `[${iso}] [${entry.severity.toUpperCase()}] [${entry.source}/${entry.domain}] ${entry.event}: ${entry.message}`,
  ];
  if (anchors) parts.push(`  Anchors: ${anchors} (env=${entry.env})`);
  if (entry.error) {
    parts.push(
      `  Error: ${entry.error.name}${entry.error.code ? ` (${entry.error.code})` : ""}${entry.error.status ? ` [HTTP ${entry.error.status}]` : ""} — ${entry.error.message}`,
    );
    if (entry.error.stack) {
      parts.push(`  Stack: ${entry.error.stack.split("\n").slice(0, 8).join(" | ")}`);
    }
  }
  if (entry.context && Object.keys(entry.context).length > 0) {
    parts.push(`  Context: ${JSON.stringify(entry.context).slice(0, 1200)}`);
  }
  return parts.join("\n");
}

// ---- Admin Routes ----------------------------------------------------------

export function registerAdminLogRoutes(app: Express): void {
  const json = express.json({ limit: "512kb" });

  app.get("/admin/logs", async (req: Request, res: Response) => {
    try {
      const now = Date.now();
      const toMs = Number(req.query.to) || now;
      const fromMs = Number(req.query.from) || toMs - 7 * 86_400_000;

      const parseCsv = <T extends string>(raw: unknown, allowed: readonly T[]): T[] => {
        if (typeof raw !== "string" || !raw.trim()) return [];
        return raw
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is T => (allowed as readonly string[]).includes(s));
      };

      const result = await queryLogs({
        fromMs,
        toMs,
        severities: parseCsv(req.query.severities, LOG_SEVERITIES),
        sources: parseCsv(req.query.sources, LOG_SOURCES),
        domains: parseCsv(req.query.domains, LOG_DOMAINS),
        uid: typeof req.query.uid === "string" && req.query.uid.trim() ? req.query.uid.trim() : undefined,
        projectId:
          typeof req.query.projectId === "string" && req.query.projectId.trim()
            ? req.query.projectId.trim()
            : undefined,
        sessionId:
          typeof req.query.sessionId === "string" && req.query.sessionId.trim()
            ? req.query.sessionId.trim()
            : undefined,
        requestId:
          typeof req.query.requestId === "string" && req.query.requestId.trim()
            ? req.query.requestId.trim()
            : undefined,
        jobId:
          typeof req.query.jobId === "string" && req.query.jobId.trim()
            ? req.query.jobId.trim()
            : undefined,
        orderId:
          typeof req.query.orderId === "string" && req.query.orderId.trim()
            ? req.query.orderId.trim()
            : undefined,
        paymentId:
          typeof req.query.paymentId === "string" && req.query.paymentId.trim()
            ? req.query.paymentId.trim()
            : undefined,
        event:
          typeof req.query.event === "string" && req.query.event.trim()
            ? req.query.event.trim()
            : undefined,
        search:
          typeof req.query.search === "string" && req.query.search.trim()
            ? req.query.search.trim()
            : undefined,
        unresolvedOnly: req.query.unresolvedOnly === "true" || req.query.unresolvedOnly === "1",
        limit: Number(req.query.limit) || 250,
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: { message: (err as Error)?.message ?? "Could not load diagnostic logs." },
      });
    }
  });

  app.post("/admin/logs/:id/resolve", json, async (req: AuthedRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      const resolved = req.body?.resolved !== false;
      const who = req.authToken?.email ?? req.uid ?? "admin";
      const docRef = db().collection(COLLECTION).doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        res.status(404).json({ error: { message: "Log entry not found." } });
        return;
      }
      const resolvedAt = resolved ? Date.now() : null;
      const resolvedBy = resolved ? who : null;
      await docRef.set({ resolvedAt, resolvedBy }, { merge: true });

      // If this log raised an `adminAlerts` entry, resolve that too so Finance
      // and Logs stay in sync.
      const data = snap.data() as Record<string, unknown> | undefined;
      if (resolved && data?.ref && data?.event) {
        await resolveAlert(`${String(data.event)}_${String(data.ref)}`).catch(() => {});
      }

      res.json({ ok: true, id, resolvedAt, resolvedBy });
    } catch (err) {
      res.status(500).json({
        error: { message: (err as Error)?.message ?? "Could not update log status." },
      });
    }
  });

  app.post("/admin/logs/analyze", json, async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = analyzeBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Invalid log analysis request." } });
        return;
      }

      const { logIds, filters, question } = parsed.data;
      let entries: LogEntry[] = [];

      if (logIds && logIds.length > 0) {
        const refs = logIds.slice(0, 120).map((id) => db().collection(COLLECTION).doc(id));
        const docs = await db().getAll(...refs);
        entries = docs
          .filter((d) => d.exists)
          .map((d) => docToLogEntry(d.id, d.data() as Record<string, unknown>));
      } else {
        const now = Date.now();
        const toMs = filters?.toMs ?? now;
        const fromMs = filters?.fromMs ?? toMs - 7 * 86_400_000;
        const queried = await queryLogs({
          fromMs,
          toMs,
          severities: filters?.severities,
          sources: filters?.sources,
          domains: filters?.domains,
          uid: filters?.uid,
          projectId: filters?.projectId,
          sessionId: filters?.sessionId,
          requestId: filters?.requestId,
          jobId: filters?.jobId,
          orderId: filters?.orderId,
          paymentId: filters?.paymentId,
          event: filters?.event,
          search: filters?.search,
          limit: 120,
        });
        entries = queried.entries;
      }

      if (entries.length === 0) {
        res.status(400).json({
          error: { message: "No log entries match the current selection to analyze." },
        });
        return;
      }

      // Chronological order (oldest → newest) so the LLM reads the story as it happened.
      const chronological = [...entries].sort((a, b) => a.at - b.at);
      const logsPayload = chronological
        .map(formatEntryForAiPrompt)
        .join("\n\n")
        .slice(0, 80_000);

      const filterSummaryParts: string[] = [];
      if (filters?.uid) filterSummaryParts.push(`User: ${filters.uid}`);
      if (filters?.projectId) filterSummaryParts.push(`Project: ${filters.projectId}`);
      if (filters?.sessionId) filterSummaryParts.push(`Session: ${filters.sessionId}`);
      if (filters?.severities?.length) {
        filterSummaryParts.push(`Severities: ${filters.severities.join(", ")}`);
      }
      if (filters?.domains?.length) {
        filterSummaryParts.push(`Domains: ${filters.domains.join(", ")}`);
      }
      if (filters?.sources?.length) {
        filterSummaryParts.push(`Sources: ${filters.sources.join(", ")}`);
      }
      if (filters?.search) filterSummaryParts.push(`Query: "${filters.search}"`);
      const filterSummary =
        filterSummaryParts.length > 0
          ? filterSummaryParts.join(" · ")
          : `Selected ${chronological.length} log entries`;

      const [model, prompts] = await Promise.all([
        resolveTextAction("logAnalysis"),
        getPromptsConfig(),
      ]);

      const rendered = renderTextPrompt(prompts, "logAnalysis", {
        vars: {
          filterSummary,
          question: question ?? "",
          entryCount: String(chronological.length),
          logsPayload,
        },
        flags: {
          hasQuestion: Boolean(question && question.length > 0),
        },
      });

      const startedAt = Date.now();
      const { value, events } = await withUsage(
        () =>
          getTextProvider(model.provider).generateStructured<LogAnalysisResult>(
            { apiKey: apiKeyFor(model.provider) },
            {
              model: model.id,
              temperature: model.params?.temperature ?? 0.2,
              schema: logAnalysisOutputSchema,
              schemaName: "DiagnosticLogAnalysis",
              messages: [
                { role: "system", content: rendered.system },
                { role: "user", content: rendered.user },
              ],
            },
          ),
        model.params,
      );
      const durationMs = Date.now() - startedAt;

      if (req.uid) {
        await recordUsage(req.uid, "logAnalysis", events);
      }

      res.json({
        analysis: value,
        model: { provider: model.provider, id: model.id },
        analyzedCount: chronological.length,
        durationMs,
      });
    } catch (err) {
      res.status(500).json({
        error: { message: (err as Error)?.message ?? "AI log analysis failed." },
      });
    }
  });
}
