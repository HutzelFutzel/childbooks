/**
 * Silent client-side diagnostic logger + breadcrumb ring buffer.
 *
 * Designed around two guarantees:
 *   1. ZERO CONSOLE SPAM FOR CUSTOMERS: in production (`!isDev()`), this logger
 *      never prints to the browser's DevTools console. In local dev, warnings
 *      and errors print a compact collapsible group.
 *   2. FULL REPRODUCTION CONTEXT WITHOUT BLOAT: routine UI interactions and
 *      route changes are recorded into an in-memory ring buffer (`breadcrumbs`,
 *      last 25 actions). They are only shipped to the backend when a `warn`,
 *      `error`, or high-signal milestone is logged — giving the admin the exact
 *      sequence of steps leading up to an issue without spamming Firestore on
 *      every click.
 */
import { isDev } from "./runtime";
import {
  extractErrorDetail,
  sanitizeLogContext,
  type ClientBreadcrumb,
  type ClientLogItemInput,
  type LogDomain,
  type LogSeverity,
} from "../core/logging/types";

const SESSION_STORAGE_KEY = "cb_diag_session_id";
const MAX_BREADCRUMBS = 25;
const MAX_QUEUE_SIZE = 25;
const FLUSH_INTERVAL_MS = 2_500;
const DEDUPE_WINDOW_MS = 5_000;

let cachedSessionId: string | null = null;
let activeProjectId: string | null = null;
const breadcrumbs: ClientBreadcrumb[] = [];
const queue: ClientLogItemInput[] = [];
const recentSignatures = new Map<string, number>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stable session id for the current browser tab. Shared with `backendFetch` via `X-Client-Session`. */
export function getClientSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
    const fresh = randomId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    cachedSessionId = fresh;
    return fresh;
  } catch {
    cachedSessionId = randomId();
    return cachedSessionId;
  }
}

/** Set the currently active studio `projectId` so client logs and breadcrumbs attach to it automatically. */
export function setClientLogProjectId(projectId: string | null): void {
  activeProjectId = projectId;
}

export function getClientLogProjectId(): string | null {
  return activeProjectId;
}

/**
 * Append a lightweight breadcrumb to the in-memory ring buffer. Never triggers
 * a network call on its own; attached automatically when a warning or error is logged.
 */
export function recordBreadcrumb(
  category: ClientBreadcrumb["category"],
  action: string,
  detail?: string,
): void {
  if (typeof window === "undefined") return;
  breadcrumbs.push({
    at: Date.now(),
    category,
    action: action.slice(0, 120),
    ...(detail ? { detail: detail.slice(0, 240) } : {}),
  });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

export interface ClientLogArgs {
  domain: LogDomain;
  event: string;
  message: string;
  projectId?: string | null;
  requestId?: string | null;
  jobId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  error?: unknown;
  context?: Record<string, unknown> | null;
}

function isDuplicate(event: string, message: string, now: number): boolean {
  const sig = `${event}|${message.slice(0, 160)}`;
  const prev = recentSignatures.get(sig);
  if (prev !== undefined && now - prev < DEDUPE_WINDOW_MS) {
    return true;
  }
  if (recentSignatures.size > 200) {
    for (const [k, t] of recentSignatures) {
      if (now - t >= DEDUPE_WINDOW_MS) recentSignatures.delete(k);
    }
  }
  recentSignatures.set(sig, now);
  return false;
}

function enqueueClientLog(severity: LogSeverity, args: ClientLogArgs): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (isDuplicate(args.event, args.message, now)) return;

  const errorDetail = args.error ? extractErrorDetail(args.error) : null;
  const pathname = window.location?.pathname ?? null;
  const includeBreadcrumbs = severity !== "info" && breadcrumbs.length > 0;

  const rawContext: Record<string, unknown> = {
    ...(pathname ? { pathname } : {}),
    ...(args.context ?? {}),
    ...(includeBreadcrumbs ? { breadcrumbs: [...breadcrumbs] } : {}),
  };

  const entry: ClientLogItemInput = {
    at: now,
    severity,
    domain: args.domain,
    event: args.event.trim().slice(0, 120) || "client.event",
    message: args.message.trim().slice(0, 2000) || args.event,
    projectId: args.projectId !== undefined ? args.projectId : activeProjectId,
    sessionId: getClientSessionId(),
    requestId: args.requestId ?? null,
    jobId: args.jobId ?? null,
    orderId: args.orderId ?? null,
    paymentId: args.paymentId ?? null,
    ...(errorDetail ? { error: errorDetail } : {}),
    context: sanitizeLogContext(rawContext),
  };

  // Dev-only collapsible console output; silent for customers in production.
  if (isDev() && (severity === "warn" || severity === "error" || severity === "fatal")) {
    try {
      const label = `[diag:${severity}] ${entry.domain}/${entry.event} — ${entry.message}`;
      console.groupCollapsed(label);
      if (errorDetail) console.error(errorDetail);
      if (entry.context) console.log("context:", entry.context);
      console.groupEnd();
    } catch {
      // ignore console errors
    }
  }

  queue.push(entry);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }

  if (severity === "error" || severity === "fatal" || queue.length >= 10) {
    void flushClientLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushClientLogs();
    }, FLUSH_INTERVAL_MS);
  }
}

export async function flushClientLogs(): Promise<void> {
  if (typeof window === "undefined" || queue.length === 0) return;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue.splice(0, MAX_QUEUE_SIZE);
  try {
    const { backendUrl, withAuthHeaders } = await import("./backend");
    const headers = await withAuthHeaders({
      "Content-Type": "application/json",
      "X-Client-Session": getClientSessionId(),
    });
    await fetch(backendUrl("/logs"), {
      method: "POST",
      headers,
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
  } catch {
    // Strictly best-effort: never re-throw or log a failed telemetry flush.
  }
}

export const clientLog = {
  info: (args: ClientLogArgs) => enqueueClientLog("info", args),
  warn: (args: ClientLogArgs) => enqueueClientLog("warn", args),
  error: (args: ClientLogArgs) => enqueueClientLog("error", args),
  fatal: (args: ClientLogArgs) => enqueueClientLog("fatal", args),
};

/**
 * Attach global browser error / unhandledrejection / visibilitychange listeners
 * once per page load.
 */
export function initClientLogger(): void {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  window.addEventListener("error", (event) => {
    const msg = event.message || "Uncaught window error";
    // Ignore benign ResizeObserver loop notifications from browsers.
    if (msg.includes("ResizeObserver loop")) return;
    enqueueClientLog("error", {
      domain: "system",
      event: "ui.unhandled_error",
      message: msg,
      error: event.error ?? new Error(msg),
      context: {
        filename: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    // Ignore deliberate AbortErrors when a request is cancelled on navigation.
    if (
      reason &&
      typeof reason === "object" &&
      ((reason as { name?: string }).name === "AbortError" ||
        (reason as { kind?: string }).kind === "aborted")
    ) {
      return;
    }
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection";
    enqueueClientLog("error", {
      domain: "system",
      event: "ui.unhandled_rejection",
      message,
      error: reason instanceof Error ? reason : new Error(message),
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && queue.length > 0) {
      void flushClientLogs();
    }
  });
}
