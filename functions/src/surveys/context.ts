/**
 * What the customer just bought, assembled server-side.
 *
 * The client tells us which purchase and which book it's asking about; everything
 * recorded on the response row is then read from records the backend owns. That
 * split matters twice over. It stops a browser attributing its answers to somebody
 * else's payment, and it means the row carries facts (the print SKU, the copy
 * count, what the story was about) rather than whatever the confirmation screen
 * happened to have in scope.
 *
 * All of it is snapshotted onto the row rather than joined at report time, because
 * a project's theme can be edited after the book ships and the project can be
 * deleted outright. What you want on the row is what they bought. `projectId`
 * survives alongside it for the dimensions nobody thought to snapshot.
 */
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "../storage";
import { projectDocKey, type ProjectMirror } from "../projects";
import {
  emptyPurchaseFacets,
  itemTypeForPurchaseKind,
  type PurchaseFacets,
  type SurveyItemType,
} from "../../../books-frontend/src/core/config/surveys";

/** What the client is allowed to tell us about the purchase. */
export interface ContextHint {
  itemType?: SurveyItemType;
  productId?: string | null;
  projectId?: string | null;
  paymentId?: string | null;
}

function db() {
  ensureAdmin();
  return getFirestore();
}

export async function purchaseFacetsFor(
  uid: string,
  hint: ContextHint,
): Promise<PurchaseFacets> {
  const facets = emptyPurchaseFacets();
  facets.itemType = hint.itemType ?? null;
  facets.productId = trim(hint.productId);
  facets.projectId = trim(hint.projectId);

  const [payment, mirror] = await Promise.all([
    readPayment(uid, trim(hint.paymentId)),
    readMirror(uid, facets.projectId),
  ]);

  if (payment) {
    facets.paymentId = payment.id;
    facets.copies = payment.copies;
    // The payment record is the authority on what was bought. A client hint that
    // disagrees with it is either stale or wrong, and either way the money knows
    // better.
    facets.itemType = payment.itemType ?? facets.itemType;
  }

  if (mirror) {
    const d = mirror.derived;
    facets.themeId = d.themeId ?? null;
    facets.settingId = d.settingId ?? null;
    facets.ageRangeId = d.ageRangeId ?? null;
    facets.artStyleKey = d.artStyleKey ?? null;
    facets.projectSeq = mirror.seq ?? 0;
    // For a print order the SKU is the more useful product id than whatever the
    // catalog called the line item, and it's the one the mirror can vouch for.
    if (!facets.productId && d.productSku) facets.productId = d.productSku;
  }

  return facets;
}

/**
 * The payment, but only if it belongs to this account.
 *
 * The ownership check is the whole reason this isn't done client-side: a payment id
 * is a bearer of attribution, and a row that credits one customer's answers to
 * another's order would corrupt exactly the analysis this feature exists for.
 */
async function readPayment(
  uid: string,
  paymentId: string | null,
): Promise<{ id: string; copies: number; itemType: SurveyItemType | null } | null> {
  if (!paymentId) return null;
  try {
    const snap = await db().doc(`payments/${paymentId}`).get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    if (d.ownerUid !== uid) return null;
    const items = Array.isArray(d.items) ? d.items : [];
    // Summed rather than taken from the first line: a print order is one line with
    // a quantity, but nothing guarantees that forever.
    const copies = items.reduce((sum: number, raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const n = Number(item.quantity);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
    return {
      id: paymentId,
      copies,
      itemType:
        typeof d.kind === "string"
          ? itemTypeForPurchaseKind(paymentKindToConfirmationKind(d.kind)) ?? null
          : null,
    };
  } catch {
    // A row with a missing copy count is worth far more than no row at all.
    return null;
  }
}

/**
 * Map the payment record's own vocabulary onto the confirmation screen's, so
 * {@link itemTypeForPurchaseKind} stays the single place item types are decided.
 * Two mappings would eventually disagree about what a gift is.
 */
function paymentKindToConfirmationKind(kind: string): string {
  switch (kind) {
    case "sparkPack":
      return "sparks";
    case "sparkGift":
      return "gift";
    default:
      return kind;
  }
}

async function readMirror(
  uid: string,
  projectId: string | null,
): Promise<ProjectMirror | null> {
  if (!projectId) return null;
  try {
    const snap = await db().doc(`projects/${projectDocKey(uid, projectId)}`).get();
    if (!snap.exists) return null;
    const mirror = snap.data() as ProjectMirror;
    return { ...mirror, derived: { ...(mirror.derived ?? {}) } } as ProjectMirror;
  } catch {
    return null;
  }
}

function trim(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : null;
}
