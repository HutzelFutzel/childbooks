/**
 * Recording **how an account arrived**, and resolving the QR indirection that
 * makes a printed code trackable at all.
 *
 * ## Why QR codes needed a redirect
 *
 * The QR library (`appConfig/qrCodes`) encodes whatever URL the admin typed
 * straight into the image. That's fine for "put our homepage on the back cover"
 * and useless for attribution: the scan is indistinguishable from a direct
 * visit, the destination is frozen in ink the moment it's printed, and there's no
 * server hop where anything could be counted.
 *
 * So a code can now encode `{site}/q/{qrId}` instead. One hop through
 * {@link resolveQrArrival} buys three things that matter more than the extra
 * redirect: the scan is counted, the destination can be changed after the poster
 * is on a wall, and the arrival token is attached to the session that follows.
 * Codes that don't opt in are untouched and still encode their raw data — a code
 * already printed in a book must render byte-for-byte as it always has.
 *
 * ## Trust boundary
 *
 * The client PROPOSES an arrival (`POST /acquisition/arrival`); the server
 * decides what to record. Nothing here is taken on faith, because an arrival
 * token can entitle an account to a discount — a client that could write its own
 * would be a client that could grant itself any arrival-gated coupon in the
 * system.
 */
import { FieldValue } from "firebase-admin/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { ensureAdmin } from "./storage";
import { getQrCodesConfig, getSeoConfig } from "./appConfig";
import {
  arrivalToken,
  mergeArrival,
  normalizeAcquisitionProfile,
  normalizeArrival,
  normalizeArrivalId,
  type AcquisitionProfile,
  type ArrivalProposal,
  type ArrivalRecord,
} from "../../books-frontend/src/core/profile/acquisition";
import {
  findQrCode,
  qrScanDestination,
  type QrScanStats,
} from "../../books-frontend/src/core/config/qrCodes";

function db() {
  ensureAdmin();
  return getFirestore();
}

/** Per-QR scan counters, so a poster's performance is visible without a join. */
const SCANS = "qrScans";

export async function readAcquisition(uid: string): Promise<AcquisitionProfile> {
  try {
    const snap = await db().doc(`users/${uid}`).get();
    return normalizeAcquisitionProfile(snap.exists ? snap.get("acquisition") : undefined);
  } catch {
    return normalizeAcquisitionProfile(undefined);
  }
}

/**
 * Fold an arrival into `users/{uid}.acquisition`.
 *
 * Transactional because `first` must be written exactly once and `tokens` is a
 * capped set — both of which a blind merge would get wrong under two concurrent
 * page loads. Returns the record when something was actually recorded, so the
 * caller knows whether to run the arrival's side effects (auto-granting a
 * coupon, most importantly) or whether this was a repeat it should ignore.
 */
export async function recordArrival(
  uid: string,
  proposal: ArrivalProposal,
): Promise<{ arrival: ArrivalRecord; isNewToken: boolean } | null> {
  const arrival = normalizeArrival(proposal);
  if (!arrival) return null;
  try {
    return await db().runTransaction(async (tx) => {
      const ref = db().doc(`users/${uid}`);
      const snap = await tx.get(ref);
      const current = normalizeAcquisitionProfile(snap.exists ? snap.get("acquisition") : undefined);
      const isNewToken = !current.tokens.includes(arrival.token);
      tx.set(ref, { acquisition: mergeArrival(current, arrival) }, { merge: true });
      return { arrival, isNewToken };
    });
  } catch (err) {
    // An attribution failure must never break a page load.
    console.warn("[acquisition] could not record arrival for", uid, err);
    return null;
  }
}

/**
 * Resolve `/q/{qrId}` to the URL a scanner should be sent to, and count the scan.
 *
 * The arrival token is appended to the destination as `?qr=` rather than being
 * recorded here, because at scan time there is usually no account yet — the
 * person may not sign up for two more sessions. The client parks the token and
 * offers it back once there's an identity to attach it to, exactly as the
 * referral flow already does with `?ref=`.
 *
 * A code that isn't in the library, or has nowhere safe to send the scan,
 * resolves to null and the caller sends them to the homepage. A dead QR that
 * lands somewhere sensible is a bad scan; a dead QR that 404s is a bad brand.
 */
export async function resolveQrArrival(
  rawId: string,
): Promise<{ destination: string; token: string } | null> {
  const qrId = normalizeArrivalId(rawId);
  if (!qrId) return null;
  try {
    const [config, seo] = await Promise.all([getQrCodesConfig(), getSeoConfig()]);
    // Match on the normalized id so a code whose stored id has different casing
    // or punctuation still resolves — the id travels through a printed image and
    // a URL, and both flatten it.
    const code =
      findQrCode(config, rawId) ??
      config.codes.find((c) => normalizeArrivalId(c.id) === qrId);
    if (!code) return null;

    const token = arrivalToken("qr", code.id);
    // Await the best-effort write before returning the redirect. A Cloud
    // Function may freeze as soon as the response is sent, so fire-and-forget
    // telemetry here silently loses scans under load. `countScan` catches its
    // own failures, which preserves the more important guarantee that a person
    // always reaches the destination.
    await countScan(code.id);

    // The destination rules live in the shared model beside `qrEncodedValue`,
    // so the half that decides what a code encodes and the half that decides
    // where its scans land can't drift apart.
    const destination = qrScanDestination(code.data, code.id, seo.siteUrl ?? "");
    return destination ? { destination, token } : null;
  } catch (err) {
    console.warn("[acquisition] could not resolve QR", rawId, err);
    return null;
  }
}

/** Count one scan. Telemetry: never allowed to fail a redirect. */
async function countScan(qrId: string): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10);
    await db()
      .doc(`${SCANS}/${qrId.replace(/[^A-Za-z0-9_-]/g, "_")}`)
      .set(
        {
          qrId,
          scans: FieldValue.increment(1),
          [`daily.${day}`]: FieldValue.increment(1),
          lastScanAt: Date.now(),
        },
        { merge: true },
      );
  } catch {
    // telemetry only
  }
}

/** Scan counters for the admin QR list. */
export async function qrScanStats(qrIds: string[]): Promise<Record<string, QrScanStats>> {
  const out: Record<string, QrScanStats> = {};
  if (qrIds.length === 0) return out;
  try {
    const refs = qrIds
      .slice(0, 200)
      .map((id) => db().doc(`${SCANS}/${id.replace(/[^A-Za-z0-9_-]/g, "_")}`));
    const snaps = await db().getAll(...refs);
    snaps.forEach((snap, i) => {
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const daily = (snap.get("daily") ?? {}) as Record<string, unknown>;
      out[qrIds[i]] = {
        qrId: qrIds[i],
        scans: n(snap.get("scans")),
        lastScanAt: n(snap.get("lastScanAt")),
        daily: Object.fromEntries(
          Object.entries(daily).map(([day, count]) => [day, n(count)]),
        ),
      };
    });
  } catch {
    // A stats failure leaves the admin list without counts, which is fine.
  }
  return out;
}
