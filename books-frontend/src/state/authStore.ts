import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb, useEmulators } from "../lib/firebase";
import { backendFetch } from "../platform/backend";
import { useProjectsStore } from "./projectsStore";

/**
 * Kick off the branded welcome + email-verification email (Option B): the
 * backend generates a Firebase verification action link and sends our own
 * ZeptoMail template carrying it (or a plain welcome for already-verified
 * identities like Google). Best-effort — the account is valid regardless, so a
 * mail hiccup must never break signup. Also powers the "Resend" button, which
 * re-sends a fresh link.
 */
async function requestWelcomeEmail(): Promise<void> {
  try {
    await backendFetch("/auth/welcome", { method: "POST" });
  } catch (err) {
    console.warn("[auth] welcome/verification email request failed", err);
  }
}

/**
 * The studio is guest-first: nobody is blocked from browsing, so when nobody is
 * signed in we transparently create an anonymous session. Guests use the full
 * studio — drafting AND generating with their granted Sparks — and upgrade to a
 * (verified) account for the signup/verify Spark bonuses, the premium image
 * tier, and purchases.
 *
 * Upgrading is done by LINKING the anonymous account (same uid → all the guest's
 * Firestore docs + Storage blobs are preserved automatically). Only when the
 * email/Google identity already belongs to another account do we fall back to a
 * plain sign-in and offer to migrate the guest's drafts (see `pendingMigration`).
 *
 * NOTE: Anonymous, Email/Password and Google sign-in must be enabled in the
 * Firebase console for prod. The Auth emulator allows them by default.
 */
const GUEST_FIRST = true;

/**
 * Coarse capability gate derived from the auth state:
 *   - loading:    auth state not resolved yet (or the guest session is forming)
 *   - guest:      anonymous user — full studio, quick tier only, no purchases
 *   - unverified: email/password account whose address isn't verified yet —
 *                 full studio, purchases locked until verified
 *   - full:       verified account (or Google, which is verified by the provider)
 */
export type AccessLevel = "loading" | "guest" | "unverified" | "full";

/** A snapshot of the drafts a guest had when switching to an existing account. */
export interface GuestMigration {
  fromUid: string;
  /**
   * The guest session's ID token, captured BEFORE the account switch. It proves
   * to the backend that this browser really owned the guest account, so the
   * drafts can be copied across securely (tokens last ~1h — plenty for the
   * dialog flow).
   */
  guestToken: string;
  projects: { id: string; title: string }[];
}

interface AuthState {
  /** The signed-in user, or null when signed out. */
  user: User | null;
  /** True once the initial auth state has been resolved. */
  ready: boolean;
  initialized: boolean;
  /** Derived capability gate (kept in state so email-verify changes re-render). */
  accessLevel: AccessLevel;
  /**
   * Whether the signed-in user is an admin (Firestore `admins/{uid}`). Cosmetic
   * UI gate only — every admin write is independently enforced by the backend.
   */
  isAdmin: boolean;
  /** Set when a guest signs into a pre-existing account with unsaved drafts. */
  pendingMigration: GuestMigration | null;
  /** Whether the global sign-in dialog is open. */
  dialogOpen: boolean;

  /** Attach the auth-state listener (idempotent). Call once on app mount. */
  init: () => void;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInGuest: () => Promise<void>;
  signOutUser: () => Promise<void>;
  /** Re-send the verification email to the current user. */
  resendVerification: () => Promise<void>;
  /** Reload the user from Firebase (picks up a freshly-verified email). */
  refreshUser: () => Promise<void>;

  openAuthDialog: () => void;
  closeAuthDialog: () => void;
  clearMigration: () => void;
}

function levelFor(user: User | null, ready: boolean): AccessLevel {
  if (!ready || !user) return "loading";
  if (user.isAnonymous) return "guest";
  if (user.emailVerified) return "full";
  // The Auth emulator never delivers verification emails, so don't trap local
  // development behind the gate — treat unverified accounts as full in dev.
  if (useEmulators()) return "full";
  return "unverified";
}

/** True for the link/sign-in collisions where the identity already exists. */
function isIdentityCollision(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  return code === "auth/email-already-in-use" || code === "auth/credential-already-in-use";
}

/** Capture the guest's drafts + a proof-of-ownership token before switching accounts. */
async function snapshotGuestDrafts(user: User): Promise<GuestMigration> {
  const projects = useProjectsStore
    .getState()
    .projects.map((p) => ({ id: p.id, title: p.title }));
  const guestToken = await user.getIdToken();
  return { fromUid: user.uid, guestToken, projects };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  initialized: false,
  accessLevel: "loading",
  isAdmin: false,
  pendingMigration: null,
  dialogOpen: false,

  init() {
    if (get().initialized) return;
    set({ initialized: true });
    const auth = getFirebaseAuth();
    onAuthStateChanged(auth, (user) => {
      set({ user, ready: true, accessLevel: levelFor(user, true) });
      if (!user && GUEST_FIRST) {
        // The listener won't re-fire on failure, so this can't loop — but a
        // failure (e.g. anonymous auth disabled in the Firebase console) must
        // not be silent: without a session the studio can never save or
        // generate, so log it loudly for diagnosis.
        void signInAnonymously(auth).catch((err) => {
          console.error(
            "[auth] Guest sign-in failed — is Anonymous auth enabled in the Firebase console?",
            err,
          );
        });
      }
      // Resolve admin status from Firestore for non-guest accounts (cosmetic).
      if (user && !user.isAnonymous) {
        void getDoc(doc(getFirebaseDb(), "admins", user.uid))
          .then((snap) => set({ isAdmin: snap.exists() }))
          .catch(() => set({ isAdmin: false }));
      } else {
        set({ isAdmin: false });
      }
    });
  },

  async signInEmail(email, password) {
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    const draft = current?.isAnonymous ? await snapshotGuestDrafts(current) : null;
    await signInWithEmailAndPassword(auth, email, password);
    if (draft && draft.projects.length > 0) set({ pendingMigration: draft });
  },

  async signUpEmail(email, password) {
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    const credential = EmailAuthProvider.credential(email, password);
    // On collision the link/create throws (the guest stays anonymous), and the
    // dialog routes the user to "sign in" — where the guest drafts get picked up
    // for migration. So we deliberately don't silently sign in here.
    if (current?.isAnonymous) {
      await linkWithCredential(current, credential);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    // Linking an anonymous user in place keeps the same uid, so the auth
    // listener may not fire — sync the derived level so the verify gate shows.
    set({ user: auth.currentUser, accessLevel: levelFor(auth.currentUser, true) });
    // Send the branded welcome + verification email via the backend (which mints
    // the Firebase verification link). Fire-and-forget.
    await requestWelcomeEmail();
  },

  async signInGoogle() {
    const auth = getFirebaseAuth();
    const current = auth.currentUser;
    const provider = new GoogleAuthProvider();
    const draft = current?.isAnonymous ? await snapshotGuestDrafts(current) : null;
    if (current?.isAnonymous) {
      try {
        await linkWithPopup(current, provider);
        // Same uid → the listener may not fire; sync the derived level.
        set({ user: auth.currentUser, accessLevel: levelFor(auth.currentUser, true) });
        // New (Google-verified) account → send the plain welcome email + fire the
        // signup ping. Deduped server-side, so it goes out at most once.
        await requestWelcomeEmail();
        return; // linked in place → same uid, drafts preserved, Google verified
      } catch (err) {
        if (!isIdentityCollision(err)) throw err;
        // Google account already exists — sign in and offer migration.
        await signInWithPopup(auth, provider);
        if (draft && draft.projects.length > 0) set({ pendingMigration: draft });
        return;
      }
    }
    await signInWithPopup(auth, provider);
    // First-ever Google sign-in without a prior guest session: send the welcome
    // + fire the signup ping. Deduped server-side, so returning users are no-ops.
    await requestWelcomeEmail();
  },

  async signInGuest() {
    await signInAnonymously(getFirebaseAuth());
  },

  async signOutUser() {
    set({ pendingMigration: null });
    await firebaseSignOut(getFirebaseAuth());
  },

  async resendVerification() {
    const user = getFirebaseAuth().currentUser;
    if (!user || user.emailVerified) return;
    // Re-send a FRESH branded verification email via the backend. Surface a
    // failure so the banner can toast it.
    const res = await backendFetch("/auth/welcome", { method: "POST" });
    if (!res.ok) throw new Error("Could not send the verification email. Please try again.");
  },

  async refreshUser() {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) return;
    await user.reload();
    const fresh = auth.currentUser;
    // Force a token refresh so the backend immediately sees email_verified=true.
    if (fresh?.emailVerified) {
      try {
        await fresh.getIdToken(true);
      } catch {
        // Best-effort; the cached token will refresh on its own shortly.
      }
    }
    set({ user: fresh, accessLevel: levelFor(fresh, true) });
  },

  openAuthDialog() {
    set({ dialogOpen: true });
  },

  closeAuthDialog() {
    set({ dialogOpen: false });
  },

  clearMigration() {
    set({ pendingMigration: null });
  },
}));

/** Map a Firebase auth error to a friendly message. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/missing-password": "Please enter a password.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/email-already-in-use": "An account with that email already exists. Please sign in instead.",
    "auth/account-exists-with-different-credential":
      "This email is already registered with a different sign-in method. Try that option instead.",
    "auth/credential-already-in-use": "That account is already linked to another user.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found for that email.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and try again.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/requires-recent-login": "Please sign in again to continue.",
    "auth/operation-not-allowed": "That sign-in method isn't enabled for this project.",
    "auth/internal-error": "Something went wrong. Please try again.",
  };
  return map[code] ?? (err as Error)?.message ?? "Authentication failed.";
}

/** A short display label for the current user. */
export function userLabel(user: User | null): string {
  if (!user) return "Signed out";
  if (user.isAnonymous) return "Guest";
  return user.displayName || user.email || "Account";
}
