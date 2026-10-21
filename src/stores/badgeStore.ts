/**
 * What this phone has already shown of the account's badges. The server only
 * sends values, so a new medal is a level higher than the last one seen here.
 * The first look at an account (fresh install, another login) records the
 * current levels silently: nobody gets a toast for medals they already had.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { BadgeKey } from '@/profile/badgeModel';

export const BADGE_STORAGE_KEY = 'na-pivo-badges';
const RECENT_LIMIT = 8;

export interface BadgeLedger {
  accountId: string | null;
  /** Highest level seen per badge, so a deleted beer never celebrates twice. */
  seen: Partial<Record<BadgeKey, number>>;
  /** Medals raised but not opened yet, newest first: they carry a dot and mint once. */
  unopened: BadgeKey[];
  /** Medals raised on this phone, newest first. */
  recent: BadgeKey[];
}

export const EMPTY_LEDGER: BadgeLedger = { accountId: null, seen: {}, unopened: [], recent: [] };

const raise = (list: BadgeKey[], raised: BadgeKey[]) => [
  ...raised,
  ...list.filter((key) => !raised.includes(key)),
];

/** The ledger after seeing `tiers`, and the badges that just went up a level. */
export function observeTiers(
  ledger: BadgeLedger,
  accountId: string,
  tiers: Partial<Record<BadgeKey, number>>,
): { ledger: BadgeLedger; raised: BadgeKey[] } {
  if (ledger.accountId !== accountId) {
    return { ledger: { ...EMPTY_LEDGER, accountId, seen: { ...tiers } }, raised: [] };
  }
  const seen = { ...ledger.seen };
  const raised: BadgeKey[] = [];
  for (const [key, tier] of Object.entries(tiers) as [BadgeKey, number][]) {
    const before = seen[key];
    // A badge this ledger has never heard of (added in an app update) starts silently.
    if (before !== undefined && tier > before) raised.push(key);
    seen[key] = Math.max(before ?? 0, tier);
  }
  if (raised.length === 0) return { ledger: { ...ledger, seen }, raised };
  return {
    ledger: {
      accountId,
      seen,
      unopened: raise(ledger.unopened, raised),
      recent: raise(ledger.recent, raised).slice(0, RECENT_LIMIT),
    },
    raised,
  };
}

function ledgerFrom(raw: unknown): BadgeLedger {
  if (!raw || typeof raw !== 'object') return EMPTY_LEDGER;
  const stored = raw as Record<string, unknown>;
  const keys = (value: unknown) =>
    Array.isArray(value) ? value.filter((key): key is BadgeKey => typeof key === 'string') : [];
  const seen =
    stored.seen && typeof stored.seen === 'object'
      ? Object.fromEntries(
          Object.entries(stored.seen).filter(([, tier]) => typeof tier === 'number' && Number.isFinite(tier)),
        )
      : {};
  return {
    accountId: typeof stored.accountId === 'string' ? stored.accountId : null,
    seen,
    unopened: keys(stored.unopened),
    recent: keys(stored.recent),
  };
}

export interface BadgeSheet {
  key: BadgeKey;
  /** The medal went up since it was last opened, so it mints itself once. */
  minting: boolean;
  /** New per opening, so the next opening starts fresh. */
  session: number;
}

interface BadgeStore extends BadgeLedger {
  /** The last medal opened anywhere in the app; it stays while the sheet fades out. */
  sheet: BadgeSheet | null;
  sheetOpen: boolean;
  observe: (accountId: string, tiers: Partial<Record<BadgeKey, number>>) => BadgeKey[];
  open: (key: BadgeKey) => void;
  close: () => void;
  reset: () => void;
}

export const useBadgeStore = create<BadgeStore>()(
  persist(
    (set, get) => ({
      ...EMPTY_LEDGER,
      sheet: null,
      sheetOpen: false,

      observe: (accountId, tiers) => {
        const { ledger, raised } = observeTiers(get(), accountId, tiers);
        set(ledger);
        return raised;
      },
      open: (key) =>
        set((state) => ({
          sheet: { key, minting: state.unopened.includes(key), session: (state.sheet?.session ?? 0) + 1 },
          sheetOpen: true,
          unopened: state.unopened.filter((unopened) => unopened !== key),
        })),
      close: () => set({ sheetOpen: false }),
      reset: () => set({ ...EMPTY_LEDGER, sheet: null, sheetOpen: false }),
    }),
    {
      name: BADGE_STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ accountId, seen, unopened, recent }) => ({ accountId, seen, unopened, recent }),
      merge: (persisted, current) => ({ ...current, ...ledgerFrom(persisted) }),
    },
  ),
);
