/**
 * Infrastructure (Firebase / Google Cloud) costs → the finance stream.
 *
 * Two admin-configurable modes (adminSettings.infra, edited in the dashboard):
 *   1. **BigQuery billing export** — when `bigQueryTable` names a Cloud Billing
 *      "standard/detailed usage cost" export table, the daily job queries
 *      yesterday's spend grouped by service and records one negative `infra/
 *      cloudCost` event per service (idempotent per day+service). This is the
 *      exact figure Google bills. (Enable the export under Billing → Billing
 *      export → BigQuery, then paste `project.dataset.table` into settings.)
 *   2. **Monthly budget fallback** — when only `monthlyBudgetUsd` is set, a
 *      prorated daily slice is recorded as `infra/infraBudget` instead
 *      (approximate, zero setup).
 *
 * BigQuery is reached through its REST API with a metadata-server token, so no
 * extra SDK dependency is needed. Failures raise an admin alert and are retried
 * naturally the next day (events are idempotent on day+service).
 */
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import { ensureAdmin } from "./storage";
import { getAdminSettings } from "./adminSettings";
import { recordFinanceEvent, toUsd } from "./finance";
import { sweepCustomCosts } from "./customCosts";
import { raiseAlert } from "./alerts";

/** Fetch an access token from the metadata server (available in deployed Functions). */
async function metadataToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000) },
  );
  if (!res.ok) throw new Error(`Metadata token request failed: ${res.status}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Metadata server returned no access token.");
  return json.access_token;
}

interface ServiceCost {
  service: string;
  currency: string;
  cost: number;
}

/**
 * Yesterday's (or the given day's) spend per service from the billing export.
 * Credits (sustained-use discounts, free-tier grants…) are folded in so the
 * figure matches the invoice.
 */
async function queryBillingExport(table: string, date: string): Promise<ServiceCost[]> {
  // The table name is admin-entered — validate strictly before inlining it.
  if (!/^[A-Za-z0-9_$-]+([.:][A-Za-z0-9_$-]+){2}$/.test(table)) {
    throw new Error(`Invalid BigQuery table name: ${table}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);

  const projectId =
    table.split(/[.:]/)[0] ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "";
  if (!projectId) throw new Error("Could not determine the BigQuery project id.");

  const query = `
    SELECT
      service.description AS service,
      currency,
      SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost
    FROM \`${table.replace(/:/g, ".")}\`
    WHERE DATE(usage_start_time) = "${date}"
    GROUP BY service, currency
    HAVING ABS(cost) > 0.0001
    ORDER BY cost DESC`;

  const token = await metadataToken();
  const res = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 30_000 }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BigQuery query failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    jobComplete?: boolean;
    rows?: { f: { v: unknown }[] }[];
  };
  if (json.jobComplete === false) throw new Error("BigQuery query timed out.");
  return (json.rows ?? []).map((r) => ({
    service: String(r.f[0]?.v ?? "unknown"),
    currency: String(r.f[1]?.v ?? "USD"),
    cost: Number(r.f[2]?.v ?? 0),
  }));
}

function yesterdayUtc(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export interface InfraImportResult {
  mode: "bigquery" | "budget" | "off";
  date: string;
  events: number;
  totalUsd: number;
}

/**
 * Import one day of infrastructure costs into the finance stream. Idempotent —
 * events are keyed on day (+service), so re-running a day is a no-op.
 */
export async function importInfraCosts(dateOverride?: string): Promise<InfraImportResult> {
  ensureAdmin();
  const settings = await getAdminSettings();
  const date = dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride) ? dateOverride : yesterdayUtc();
  const { bigQueryTable, monthlyBudgetUsd } = settings.infra;

  if (bigQueryTable) {
    const rows = await queryBillingExport(bigQueryTable, date);
    let total = 0;
    for (const row of rows) {
      const usd = await toUsd(row.cost, row.currency);
      total += usd;
      await recordFinanceEvent({
        category: "infra",
        kind: "cloudCost",
        amountUsd: -usd,
        currency: row.currency,
        amount: row.cost,
        ref: `${date}_${slug(row.service)}`,
        at: new Date(`${date}T12:00:00Z`).getTime(),
        meta: { service: row.service, date },
      });
    }
    return { mode: "bigquery", date, events: rows.length, totalUsd: Math.round(total * 100) / 100 };
  }

  if (monthlyBudgetUsd && monthlyBudgetUsd > 0) {
    const daily = Math.round(((monthlyBudgetUsd * 12) / 365.25) * 100) / 100;
    await recordFinanceEvent({
      category: "infra",
      kind: "infraBudget",
      amountUsd: -daily,
      ref: `budget_${date}`,
      at: new Date(`${date}T12:00:00Z`).getTime(),
      meta: { monthlyBudgetUsd, date },
    });
    return { mode: "budget", date, events: 1, totalUsd: daily };
  }

  return { mode: "off", date, events: 0, totalUsd: 0 };
}

/**
 * Daily bookkeeping run (03:15 UTC, after the billing export lands): imports
 * yesterday's infra spend and books any newly due custom operating costs.
 */
export const importInfraCostsDaily = onSchedule(
  {
    schedule: "15 3 * * *",
    timeZone: "UTC",
    timeoutSeconds: 120,
  },
  async () => {
    try {
      const result = await importInfraCosts();
      if (result.mode !== "off") {
        logger.info(
          `[infra-costs] imported ${result.events} event(s) for ${result.date} (${result.mode}): $${result.totalUsd}`,
        );
      }
    } catch (err) {
      logger.error("[infra-costs] import failed", err);
      await raiseAlert({
        severity: "warning",
        kind: "infra.importFailed",
        message: `Daily infrastructure cost import failed: ${(err as Error)?.message ?? "unknown error"}`,
        ref: `infraImport_${yesterdayUtc()}`,
      }).catch(() => {});
    }

    try {
      const sweep = await sweepCustomCosts();
      if (sweep.recorded > 0) {
        logger.info(`[custom-costs] booked ${sweep.recorded} due period(s) across ${sweep.costs} cost(s)`);
      }
    } catch (err) {
      logger.error("[custom-costs] sweep failed", err);
      await raiseAlert({
        severity: "warning",
        kind: "ops.sweepFailed",
        message: `Daily custom-cost sweep failed: ${(err as Error)?.message ?? "unknown error"}`,
        ref: `customCosts_${yesterdayUtc()}`,
      }).catch(() => {});
    }
  },
);
