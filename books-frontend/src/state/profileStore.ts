/**
 * Live profile + saved address book for the signed-in user.
 *
 * Mirrors the `users/{uid}` profile doc and `users/{uid}/addresses` subcollection
 * into the UI (like {@link useOrdersStore} does for orders) and exposes the
 * mutations the checkout flow needs: save/remove an address and pick a default.
 * Watch when a full account is present; stop on sign-out so one identity's data
 * never leaks into another's session.
 */
import { create } from "zustand";
import type { Unsubscribe } from "firebase/firestore";
import {
  addressSummary,
  sameAddress,
  type SavedAddress,
  type UserProfile,
} from "../core/profile/types";
import {
  deleteAddress,
  recordSession,
  saveAddress,
  saveProfile,
  subscribeAddresses,
  subscribeProfile,
  type SessionStamp,
} from "../platform/profile";

/** Fields the checkout form collects for an address (no id/timestamps yet). */
export type AddressInput = Omit<SavedAddress, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<SavedAddress, "id">>;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `addr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface ProfileState {
  profile: UserProfile | null;
  addresses: SavedAddress[];
  /** True until the first address snapshot arrives. */
  loading: boolean;
  profileUnsub: Unsubscribe | null;
  addressesUnsub: Unsubscribe | null;

  /** Begin mirroring the current user's profile + addresses (idempotent). */
  watch: () => void;
  /** Stop and clear. */
  stop: () => void;

  /** Merge a partial profile update (best-effort). */
  updateProfile: (patch: Partial<UserProfile>) => Promise<void>;
  /** Record a login/session (write-once create fields + refreshed activity). */
  recordSession: (stamp: SessionStamp) => Promise<void>;

  /**
   * Create or update a saved address. If an equivalent address already exists
   * it's reused (returns that one) rather than duplicated. The first address
   * saved — or any save with `makeDefault` — becomes the default.
   * Returns the persisted address, or null when the write fails.
   */
  upsertAddress: (input: AddressInput, makeDefault?: boolean) => Promise<SavedAddress | null>;
  removeAddress: (id: string) => Promise<void>;
  setDefaultAddress: (id: string) => Promise<void>;

  /** The default address, or the most recently updated one, if any. */
  preferredAddress: () => SavedAddress | null;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  addresses: [],
  loading: false,
  profileUnsub: null,
  addressesUnsub: null,

  watch() {
    if (get().addressesUnsub) return;
    set({ loading: true });
    const profileUnsub = subscribeProfile((profile) => set({ profile }));
    const addressesUnsub = subscribeAddresses((addresses) => set({ addresses, loading: false }));
    set({ profileUnsub, addressesUnsub });
  },

  stop() {
    get().profileUnsub?.();
    get().addressesUnsub?.();
    set({
      profile: null,
      addresses: [],
      loading: false,
      profileUnsub: null,
      addressesUnsub: null,
    });
  },

  async updateProfile(patch) {
    try {
      await saveProfile(patch);
    } catch {
      // Persistence is best-effort; the live subscription is the source of truth.
    }
  },

  async recordSession(stamp) {
    try {
      await recordSession(stamp);
    } catch {
      // Best-effort metadata.
    }
  },

  async upsertAddress(input, makeDefault) {
    const now = Date.now();
    const existing = get().addresses;

    // Reuse an equivalent saved address (dedupe) when creating a new one.
    const candidate: SavedAddress = {
      id: input.id ?? newId(),
      label: input.label,
      recipientName: input.recipientName,
      phone: input.phone,
      email: input.email,
      line1: input.line1,
      line2: input.line2,
      city: input.city,
      region: input.region,
      postal: input.postal,
      country: input.country,
      createdAt: now,
      updatedAt: now,
    };
    const duplicate = input.id ? null : existing.find((a) => sameAddress(a, candidate));
    const address = duplicate
      ? { ...duplicate, label: candidate.label || duplicate.label, updatedAt: now }
      : candidate;

    try {
      await saveAddress(address);
      // Default if explicitly requested, or implicitly for the very first address.
      if (makeDefault || existing.length === 0) {
        await saveProfile({ defaultAddressId: address.id });
      }
      return address;
    } catch {
      return null;
    }
  },

  async removeAddress(id) {
    try {
      await deleteAddress(id);
      if (get().profile?.defaultAddressId === id) {
        await saveProfile({ defaultAddressId: null });
      }
    } catch {
      /* best-effort */
    }
  },

  async setDefaultAddress(id) {
    await get().updateProfile({ defaultAddressId: id });
  },

  preferredAddress() {
    const { profile, addresses } = get();
    if (addresses.length === 0) return null;
    const byId = profile?.defaultAddressId
      ? addresses.find((a) => a.id === profile.defaultAddressId)
      : null;
    return byId ?? addresses[0];
  },
}));

/** Re-export for convenience at call sites that render address labels. */
export { addressSummary };
