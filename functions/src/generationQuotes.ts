/**
 * Stored generation quotes: the estimate behind a scoped "Draw … · about N
 * Sparks" button, written down so the worker can hold the charge to it.
 *
 * Issued here, consumed per unit by `expandJob` (see {@link consumeQuote}). The
 * documents live at `users/{uid}/generationQuotes/{id}` and are backend-only.
 */
import { createHash, randomUUID } from "node:crypto";
import express, { type Express, type Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import type { AuthedRequest } from "./auth";
import { ensureAdmin } from "./storage";
import { estimateForUser, getBalance, referenceGroupFor } from "./sparks";
import { resolveImageModels } from "./modelResolve";
import { getGenerationTuningConfig } from "./appConfig";
import { normalizeImageTier, type ImageTier } from "../../books-frontend/src/core/config/modelConfig";
import { generationTuningFor } from "../../books-frontend/src/core/config/generationTuning";
import { isImageAction, type ImageActionId } from "../../books-frontend/src/core/ai/actions";
import {
  GENERATION_QUOTE_TTL_MS,
  quoteUnitKey,
  type GenerationQuote,
  type GenerationQuotePurpose,
  type GenerationQuoteUnit,
} from "../../books-frontend/src/core/billing/generationQuote";

const UNIT_RE = /^[a-zA-Z0-9_:.-]{1,160}$/;
const PURPOSES: readonly GenerationQuotePurpose[] = ["portraits", "book", "redraw"];
const MAX_UNITS = 200;

function quoteRef(uid: string, id: string) {
  return getFirestore().doc(`users/${uid}/generationQuotes/${id}`);
}

function parseUnits(raw: unknown): GenerationQuoteUnit[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_UNITS) return null;
  const seen = new Set<string>();
  const out: GenerationQuoteUnit[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { id, action, kind, refs } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !UNIT_RE.test(id) || seen.has(id)) return null;
    if (typeof action !== "string" || !isImageAction(action)) return null;
    if (refs !== undefined && (typeof refs !== "number" || !Number.isInteger(refs) || refs < 0 || refs > 64)) return null;
    const k = kind === "edit" ? "edit" : "fresh";
    seen.add(id);
    out.push({ id, action: action as ImageActionId, kind: k, ...(typeof refs === "number" ? { refs } : {}) });
  }
  return out;
}

export function registerGenerationQuoteRoutes(app: Express): void {
  app.post(
    "/ai/generation-quote",
    express.json({ limit: "64kb" }),
    async (req: AuthedRequest, res: Response) => {
      try {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const units = parseUnits(body.units);
        const purpose = PURPOSES.includes(body.purpose as GenerationQuotePurpose)
          ? (body.purpose as GenerationQuotePurpose)
          : null;
        if (typeof body.projectId !== "string" || !body.projectId || !units || !purpose) {
          res.status(400).json({ error: { message: "The generation quote request is invalid." } });
          return;
        }
        const tier: ImageTier = normalizeImageTier(body.tier);
        const uid = req.uid!;
        // A unit that names its reference count is priced in that count's group,
        // so two portraits of one batch can cost differently (three photos vs none).
        const unitKeys: Record<string, string> = Object.fromEntries(
          await Promise.all(
            units.map(async (u) => [
              u.id,
              quoteUnitKey(
                u.action,
                u.kind,
                u.refs === undefined ? undefined : await referenceGroupFor(u.action, tier, u.refs),
              ),
            ]),
          ),
        );
        const keys = [...new Set(Object.values(unitKeys))];
        const [balanceBefore, tuning, priced] = await Promise.all([
          getBalance(uid),
          getGenerationTuningConfig(),
          Promise.all(
            keys.map(async (key) => {
              const unit = units.find((u) => unitKeys[u.id] === key)!;
              const [sparks, models] = await Promise.all([
                estimateForUser(uid, unit.action, tier, unit.kind, unit.refs),
                resolveImageModels(unit.action, tier),
              ]);
              return { key, action: unit.action, sparks, model: models.imageModel };
            }),
          ),
        ]);
        const byKey = Object.fromEntries(priced.map((p) => [p.key, p.sparks]));
        const maximumSparks = units.reduce((sum, u) => sum + (byKey[unitKeys[u.id]!] ?? 0), 0);
        const configRevision = createHash("sha256")
          .update(
            JSON.stringify(
              priced.map((p) => ({
                key: p.key,
                sparks: p.sparks,
                model: p.model,
                tuning: generationTuningFor(tuning, p.action),
              })),
            ),
          )
          .digest("hex")
          .slice(0, 24);
        const issuedAt = Date.now();
        const quote: GenerationQuote = {
          id: randomUUID(),
          projectId: body.projectId,
          purpose,
          tier,
          configRevision,
          units,
          byKey,
          unitKeys,
          maximumSparks,
          balanceBefore,
          balanceAfter: balanceBefore - maximumSparks,
          issuedAt,
          expiresAt: issuedAt + GENERATION_QUOTE_TTL_MS,
        };
        ensureAdmin();
        await quoteRef(uid, quote.id).set({ ...quote, consumed: {} });
        res.json(quote);
      } catch (err) {
        res.status(500).json({
          error: { message: (err as Error)?.message ?? "The generation quote could not be created." },
        });
      }
    },
  );
}

/** How long a quote stays good once the reader leaves to buy the Sparks for it. */
const CHECKOUT_QUOTE_HOLD_MS = 2 * 60 * 60_000;

/**
 * Keep a quote's price while the reader is at checkout buying the Sparks for
 * it, so the book starts at the number they saw when they come back. Returns
 * the new expiry, or null when the quote isn't theirs or is already used.
 */
export async function holdQuoteForCheckout(uid: string, quoteId: string): Promise<number | null> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(quoteId)) return null;
  ensureAdmin();
  const ref = quoteRef(uid, quoteId);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const quote = snap.data() as GenerationQuote;
    if (quote.expiresAt <= Date.now() || Object.keys(quote.consumed ?? {}).length > 0) return null;
    const expiresAt = Math.max(quote.expiresAt, Date.now() + CHECKOUT_QUOTE_HOLD_MS);
    tx.update(ref, { expiresAt });
    return expiresAt;
  });
}

/**
 * Consume the units of a quote that one job runs, atomically.
 *
 * Returns the settlement caps to persist on the job, and which cap each unit
 * settles against. Throws a reader-facing
 * message when the quote is missing, expired, for another book, does not cover
 * a task, or a unit was already consumed by a different job. Re-expanding the
 * same job (reaper) is idempotent: its own units read as already consumed by it.
 */
export async function consumeQuote(
  uid: string,
  quoteId: string,
  jobId: string,
  projectId: string | undefined,
  taskIds: readonly string[],
): Promise<{ byKey: Record<string, number>; unitKeys: Record<string, string>; units: GenerationQuoteUnit[] }> {
  ensureAdmin();
  const ref = quoteRef(uid, quoteId);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("This price is no longer available. Please check the new one.");
    const quote = snap.data() as GenerationQuote;
    if (projectId && quote.projectId !== projectId) {
      throw new Error("This price belongs to another book.");
    }
    const consumed = { ...(quote.consumed ?? {}) };
    const mine = taskIds.every((id) => consumed[id] === jobId);
    if (!mine && quote.expiresAt <= Date.now()) {
      throw new Error("This price has expired. Please check the new one.");
    }
    const covered = new Set(quote.units.map((u) => u.id));
    for (const id of taskIds) {
      if (!covered.has(id)) throw new Error("This price doesn't cover everything in this batch.");
      if (consumed[id] && consumed[id] !== jobId) {
        throw new Error("This picture has already been started.");
      }
      consumed[id] = jobId;
    }
    tx.update(ref, { consumed });
    return { byKey: quote.byKey, unitKeys: quote.unitKeys ?? {}, units: quote.units };
  });
}
