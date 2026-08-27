/**
 * Firebase client SDK init (browser).
 *
 * Auth is wired here (Phase 2). In development it auto-connects to the local
 * Auth emulator. Firestore/Storage clients will be added the same way when the
 * data layer moves off IndexedDB.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import {
  getToken as getAppCheckToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  type Firestore,
} from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage as getFbStorage,
  type FirebaseStorage,
} from "firebase/storage";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

/** reCAPTCHA Enterprise site key for App Check. Empty ⇒ App Check is inert. */
const APP_CHECK_SITE_KEY = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;

const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";
const EMULATOR_HOST = "127.0.0.1";
/** Matches `emulators.firestore.port` in firebase.json. Not 8080: Cursor binds that locally. */
const FIRESTORE_EMULATOR_PORT = 8081;
const STORAGE_EMULATOR_PORT = 9199;

export function useEmulators(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * Storage is the one emulator dev does NOT use by default: the backend hands
 * print files to the print provider and ebook links to buyers, and both must be
 * fetchable from outside this machine (and outlive a restart), which emulated
 * Storage URLs — `127.0.0.1` — are not. Client and backend must agree on which
 * bucket they're talking to or the browser reads an empty bucket, so this mirrors
 * `USE_STORAGE_EMULATOR` on the backend side.
 */
export function useStorageEmulator(): boolean {
  if (!useEmulators()) return false;
  return process.env.NEXT_PUBLIC_USE_STORAGE_EMULATOR === "true";
}

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  // In dev against the emulators the public config may be blank. Provide
  // fallbacks so the SDK doesn't throw — the emulators don't validate the key.
  // The bucket fallback mirrors the backend's `storageBucketName()` derivation
  // (`<projectId>.firebasestorage.app`), NOT the legacy `.appspot.com` name:
  // dev talks to the real bucket, so a mismatch here reads an empty one.
  const projectId = config.projectId || "childbook-60f89";
  const opts = {
    ...config,
    apiKey: config.apiKey || "demo-emulator-key",
    projectId,
    storageBucket: config.storageBucket || `${projectId}.firebasestorage.app`,
  };
  app = getApps().length ? getApp() : initializeApp(opts);
  return app;
}

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(getFirebaseApp());
  if (useEmulators()) {
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  }
  return auth;
}

let db: Firestore | null = null;

export function getFirebaseDb(): Firestore {
  if (db) return db;
  // `ignoreUndefinedProperties`: generation jobs (and published-book writes)
  // embed rich snapshots — the full project, resolved models, render tasks —
  // whose optional fields are frequently `undefined`. Firestore rejects
  // `undefined` by default ("Unsupported field value: undefined"), so configure
  // the client to drop those keys instead of throwing on `addDoc`/`setDoc`.
  db = initializeFirestore(getFirebaseApp(), { ignoreUndefinedProperties: true });
  if (useEmulators()) {
    connectFirestoreEmulator(db, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
  }
  return db;
}

let storage: FirebaseStorage | null = null;

export function getFirebaseStorage(): FirebaseStorage {
  if (storage) return storage;
  storage = getFbStorage(getFirebaseApp());
  if (useStorageEmulator()) {
    connectStorageEmulator(storage, EMULATOR_HOST, STORAGE_EMULATOR_PORT);
  }
  return storage;
}

let appCheckPromise: Promise<AppCheck | null> | null = null;

/**
 * Initialize App Check (browser only, memoized).
 *
 * NOT gated on cookie consent, unlike {@link initAnalytics}. App Check is a
 * fraud-prevention measure protecting the public contact endpoint, not analytics
 * — and gating it on consent would make it trivially bypassable, since declining
 * cookies would also switch off the abuse defense. It's processed under
 * legitimate interest as a strictly necessary security function.
 *
 * Resolves to null (a silent no-op) when no site key is configured or when
 * running against the emulators, which have no App Check backend to verify
 * tokens against — the backend's `verifyAppCheck` skips emulated requests to
 * match.
 */
export function initAppCheck(): Promise<AppCheck | null> {
  if (appCheckPromise) return appCheckPromise;
  appCheckPromise = (async () => {
    if (typeof window === "undefined") return null;
    if (useEmulators()) return null;
    if (!APP_CHECK_SITE_KEY) return null;
    try {
      return initializeAppCheck(getFirebaseApp(), {
        provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch {
      return null;
    }
  })();
  return appCheckPromise;
}

/**
 * The current App Check token, or null when App Check isn't configured/available.
 *
 * Callers attach this to backend requests themselves: the Cloud Functions
 * endpoints are plain `fetch` targets, not Firebase SDK calls, so the SDK's
 * automatic header injection doesn't apply. Never throws — a missing token must
 * degrade to an unattested request rather than blocking the call, because
 * enforcement is staged on the backend.
 */
export async function appCheckToken(): Promise<string | null> {
  const appCheck = await initAppCheck();
  if (!appCheck) return null;
  try {
    return (await getAppCheckToken(appCheck, /* forceRefresh */ false)).token;
  } catch {
    return null;
  }
}

let analyticsPromise: Promise<Analytics | null> | null = null;

/**
 * Initialize Google Analytics for Firebase (browser only). Resolves to null
 * during SSR, against the emulators, when no measurement id is configured, or in
 * environments where Analytics isn't supported (e.g. some privacy modes). Safe
 * to call repeatedly — the result is memoized.
 */
export function initAnalytics(): Promise<Analytics | null> {
  if (analyticsPromise) return analyticsPromise;
  analyticsPromise = (async () => {
    if (typeof window === "undefined") return null;
    if (useEmulators()) return null; // nothing to measure against local emulators
    if (!config.measurementId) return null;
    try {
      if (!(await isSupported())) return null;
      return getAnalytics(getFirebaseApp());
    } catch {
      return null;
    }
  })();
  return analyticsPromise;
}
