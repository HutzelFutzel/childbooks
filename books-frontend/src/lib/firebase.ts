/**
 * Firebase client SDK init (browser).
 *
 * Auth is wired here (Phase 2). In development it auto-connects to the local
 * Auth emulator. Firestore/Storage clients will be added the same way when the
 * data layer moves off IndexedDB.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
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

const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";
const EMULATOR_HOST = "127.0.0.1";
const FIRESTORE_EMULATOR_PORT = 8080;
const STORAGE_EMULATOR_PORT = 9199;

export function useEmulators(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  // In dev against the emulators the public config may be blank. Provide
  // fallbacks so the SDK doesn't throw — the emulators don't validate the key,
  // and Storage needs *some* bucket name (the emulator accepts any).
  const projectId = config.projectId || "childbook-60f89";
  const opts = {
    ...config,
    apiKey: config.apiKey || "demo-emulator-key",
    projectId,
    storageBucket: config.storageBucket || `${projectId}.appspot.com`,
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
  if (useEmulators()) {
    connectStorageEmulator(storage, EMULATOR_HOST, STORAGE_EMULATOR_PORT);
  }
  return storage;
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
