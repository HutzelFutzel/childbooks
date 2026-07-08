/**
 * Persistence for the admin Analysis dashboard settings.
 *
 * Stored in `adminSettings/global`, which the Firestore rules deny to ALL
 * clients — it holds the email/domain exclusion list, so it must never be
 * world-readable (unlike `appConfig/*`). Read/written only via the admin-gated
 * `/admin/settings` routes using the Admin SDK.
 */
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { ensureAdmin } from "./storage";
import { DEFAULT_ADMIN_SETTINGS, type AdminSettings } from "../../books-frontend/src/core/analytics/types";

const DOC = "adminSettings/global";
const CACHE_TTL_MS = 10_000;
let cache: { value: AdminSettings; at: number } | null = null;

const settingsSchema = z.object({
  excludedEmails: z.array(z.string().max(320)).max(2000).optional(),
  excludedDomains: z.array(z.string().max(255)).max(2000).optional(),
  timezone: z.string().max(80).optional(),
  autoRefreshSec: z.number().int().positive().max(86_400).nullable().optional(),
  infra: z
    .object({
      bigQueryTable: z.string().max(1024).nullable().optional(),
      monthlyBudgetUsd: z.number().min(0).max(10_000_000).nullable().optional(),
    })
    .optional(),
  ops: z
    .object({
      reclaimVat: z.boolean().optional(),
    })
    .optional(),
});

function dedupe(list: string[]): string[] {
  return Array.from(new Set(list));
}

/** Validate the IANA timezone; fall back to UTC when unsupported. */
function safeTimezone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Coerce an arbitrary payload into clean {@link AdminSettings}. */
export function normalizeSettings(raw: unknown): AdminSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(r.excludedEmails)
    ? r.excludedEmails
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const domains = Array.isArray(r.excludedDomains)
    ? r.excludedDomains
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim().toLowerCase().replace(/^@/, ""))
        .filter(Boolean)
    : [];
  const infraRaw = (r.infra ?? {}) as Record<string, unknown>;
  const bigQueryTable =
    typeof infraRaw.bigQueryTable === "string" && infraRaw.bigQueryTable.trim()
      ? infraRaw.bigQueryTable.trim()
      : null;
  const monthlyBudgetUsd =
    typeof infraRaw.monthlyBudgetUsd === "number" &&
    Number.isFinite(infraRaw.monthlyBudgetUsd) &&
    infraRaw.monthlyBudgetUsd > 0
      ? infraRaw.monthlyBudgetUsd
      : null;
  return {
    excludedEmails: dedupe(emails),
    excludedDomains: dedupe(domains),
    timezone: safeTimezone(r.timezone),
    autoRefreshSec:
      typeof r.autoRefreshSec === "number" && Number.isFinite(r.autoRefreshSec) && r.autoRefreshSec > 0
        ? Math.floor(r.autoRefreshSec)
        : null,
    infra: { bigQueryTable, monthlyBudgetUsd },
    ops: { reclaimVat: (r.ops as Record<string, unknown> | undefined)?.reclaimVat === true },
  };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  ensureAdmin();
  let raw: unknown;
  try {
    const snap = await getFirestore().doc(DOC).get();
    raw = snap.exists ? snap.data() : undefined;
  } catch {
    raw = undefined;
  }
  const value = raw === undefined ? { ...DEFAULT_ADMIN_SETTINGS } : normalizeSettings(raw);
  cache = { value, at: Date.now() };
  return value;
}

/** Validate + persist settings. Throws a ZodError on malformed input. */
export async function saveAdminSettings(input: unknown): Promise<AdminSettings> {
  const parsed = settingsSchema.parse(input ?? {});
  const next = normalizeSettings(parsed);
  ensureAdmin();
  await getFirestore().doc(DOC).set(next, { merge: false });
  cache = { value: next, at: Date.now() };
  return next;
}
