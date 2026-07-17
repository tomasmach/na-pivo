import { create } from 'zustand';

import {
  ensureAccount,
  fetchAccountPreferences,
  type AccountSession,
} from '@/data/account';
import * as auth from '@/data/auth';
import { setTelemetrySession } from '@/data/telemetryClient';
import {
  EMPTY_ACHIEVEMENTS,
  type AccountAchievements,
  type AccountMapper,
  type AccountPivar,
  type AccountProfile,
  type AccountSettings,
  type AuthActionResult,
  type AccountExportActionResult,
  type AuthProvider,
  type AuthResult,
  type ContentReportReason,
  type NicknameAvailability,
} from '@/data/auth';
import { FALLBACK_LEVELS, FALLBACK_XP_RULES } from '@/data/mapperXp';
import { useSettingsStore } from '@/stores/settingsStore';

export type AccountStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The Mapér snapshot fields the PUT /pub-amenities/votes envelope returns
 * (camelCased). XP/level are always present; counters are additive and optional
 * so newer backends can unlock badges immediately while older responses still
 * patch only the progress bar.
 */
export interface MapperSnapshotPatch {
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel?: number | null;
  distinctMappedPubs?: number;
  amenityVotesCount?: number;
  firstMapperCount?: number;
  completedPubsCount?: number;
}

export interface PivarSnapshotPatch {
  xp: number;
  level: number;
  title: string;
  xpIntoLevel: number;
  xpForNextLevel?: number | null;
}

function mapperFromSnapshot(
  current: AccountMapper | undefined,
  snapshot: MapperSnapshotPatch,
): AccountMapper {
  const xpForNextLevel =
    snapshot.xpForNextLevel === undefined
      ? current?.xpForNextLevel ?? null
      : snapshot.xpForNextLevel;
  return {
    xp: snapshot.xp,
    level: snapshot.level,
    title: snapshot.title,
    xpIntoLevel: snapshot.xpIntoLevel,
    xpForNextLevel,
    distinctMappedPubs: snapshot.distinctMappedPubs ?? current?.distinctMappedPubs ?? 0,
    amenityVotesCount: snapshot.amenityVotesCount ?? current?.amenityVotesCount ?? 0,
    firstMapperCount: snapshot.firstMapperCount ?? current?.firstMapperCount ?? 0,
    completedPubsCount: snapshot.completedPubsCount ?? current?.completedPubsCount ?? 0,
    levels: current?.levels ?? [...FALLBACK_LEVELS],
    xpRules: current?.xpRules ?? FALLBACK_XP_RULES,
  };
}

function pivarFromSnapshot(
  current: AccountPivar | undefined,
  snapshot: PivarSnapshotPatch,
): AccountPivar {
  return {
    xp: snapshot.xp,
    level: snapshot.level,
    title: snapshot.title,
    xpIntoLevel: snapshot.xpIntoLevel,
    xpForNextLevel:
      snapshot.xpForNextLevel === undefined
        ? current?.xpForNextLevel ?? null
        : snapshot.xpForNextLevel,
    levels: current?.levels ?? [],
  };
}

function achievementsFromMapper(
  current: AccountAchievements | undefined,
  mapper: AccountMapper,
): AccountAchievements {
  return {
    ...EMPTY_ACHIEVEMENTS,
    ...current,
    firstMap: (current?.firstMap ?? false) || mapper.firstMapperCount >= 1,
    explorer: (current?.explorer ?? false) || mapper.distinctMappedPubs >= 10,
    cartographer: (current?.cartographer ?? false) || mapper.distinctMappedPubs >= 25,
    completionist: (current?.completionist ?? false) || mapper.completedPubsCount >= 1,
    factMachine: (current?.factMachine ?? false) || mapper.amenityVotesCount >= 100,
    // Server-only badge (photo-contest win) — no local unlock rule; carry it
    // through so a mapper snapshot never clobbers it back to false.
    fotoPivar: current?.fotoPivar ?? false,
  };
}

interface AccountState {
  session: AccountSession | null;
  status: AccountStatus;
  /** Full account state once known (anonymous or signed in). */
  profile: AccountProfile | null;

  /**
   * Ensure an account (anonymous or the signed-in one) exists. Never throws. A
   * call made while one is already in flight is ignored (concurrency guard).
   */
  initAccount: () => Promise<void>;
  /** Re-fetch GET /v1/account/me into `profile`. */
  refreshProfile: () => Promise<void>;
  /**
   * Patch the live Mapér XP/level/title from a PUT /pub-amenities/votes envelope
   * snapshot so Profile climbs immediately after a vote, without a second GET.
   * Creates a fallback mapper block when a live profile has not fetched one yet;
   * the next GET /account/me reconciles server levels + xpRules.
   */
  applyMapperSnapshot: (snapshot: MapperSnapshotPatch) => void;
  /** Patch drink XP into the same live profile used by the combined account level. */
  applyPivarSnapshot: (snapshot: PivarSnapshotPatch) => void;

  // --- credential auth (these change the session token) ---
  register: (params: { email: string; password: string; displayName?: string }) => Promise<AuthResult>;
  login: (params: { email: string; password: string }) => Promise<AuthResult>;
  signInGoogle: () => Promise<AuthResult>;
  signInApple: () => Promise<AuthResult>;
  resetPassword: (params: { token: string; password: string }) => Promise<AuthResult>;

  // --- linking / profile (session token unchanged) ---
  linkGoogle: () => Promise<AuthResult>;
  linkApple: () => Promise<AuthResult>;
  unlink: (provider: AuthProvider) => Promise<AuthResult>;
  setPassword: (params: { password: string; email?: string }) => Promise<AuthResult>;

  // --- profile (nickname / display name / visibility / avatar) ---
  updateProfile: (params: {
    nickname?: string;
    displayName?: string;
    isPublic?: boolean;
  }) => Promise<AuthResult>;
  checkNicknameAvailable: (nickname: string) => Promise<NicknameAvailability>;
  uploadAvatar: (localUri: string) => Promise<AuthResult>;
  removeAvatar: () => Promise<AuthResult>;

  // --- lifecycle ---
  logout: (options?: { all?: boolean }) => Promise<void>;
  deleteAccount: () => Promise<AuthActionResult>;
  exportAccountData: () => Promise<AccountExportActionResult>;
  restorePurchases: (params: {
    platform: 'apple' | 'google';
    productId?: string;
    originalTransactionId?: string;
    transactionId?: string;
    expiresAt?: string | null;
  }) => Promise<AuthResult>;
  reportProfileContent: (params: {
    targetAccountId: string;
    reason: ContentReportReason;
    comment?: string;
  }) => Promise<AuthActionResult>;
  requestPasswordReset: (email: string) => Promise<AuthActionResult>;
  requestEmailVerification: () => Promise<AuthActionResult>;
  verifyEmail: (token: string) => Promise<AuthActionResult>;
}

export const useAccountStore = create<AccountState>((set, get) => {
  const applyAccountSettings = (settings?: AccountSettings | null) => {
    if (!settings) return;
    const store = useSettingsStore.getState();
    if (settings.mode) store.setMode(settings.mode);
    if (settings.maxDistanceKm !== undefined) store.setMaxDistanceKm(settings.maxDistanceKm);
    if (settings.priceCurrency) store.setPriceCurrency(settings.priceCurrency);
    if (typeof settings.hapticEnabled === 'boolean') store.setHapticEnabled(settings.hapticEnabled);
    if (typeof settings.soundEnabled === 'boolean') store.setSoundEnabled(settings.soundEnabled);
    if (typeof settings.hideClosedPubs === 'boolean') store.setHideClosedPubs(settings.hideClosedPubs);
    if (typeof settings.hidePubNames === 'boolean') store.setHidePubNames(settings.hidePubNames);
    if (typeof settings.marketingEmailsEnabled === 'boolean') {
      store.setMarketingEmailsEnabled(settings.marketingEmailsEnabled);
    }
  };

  /** Re-read the (possibly rotated) session token into the store. */
  const syncSession = async () => {
    const session = await ensureAccount();
    setTelemetrySession(session);
    set({ session, status: session ? 'ready' : 'idle' });
  };

  /** After a session-changing auth call: persist the new token + profile. */
  const applyAuthResult = async (result: AuthResult): Promise<AuthResult> => {
    if (result.ok) {
      set({ profile: result.profile });
      applyAccountSettings(result.profile.settings);
      await syncSession();
    }
    return result;
  };

  /** After a profile-changing auth call that leaves the session token intact
   *  (link / unlink / profile / avatar / purchases): persist the updated profile
   *  + settings. Mirrors applyAuthResult without the session re-sync. */
  const applyProfileResult = (result: AuthResult): AuthResult => {
    if (result.ok) {
      set({ profile: result.profile });
      applyAccountSettings(result.profile.settings);
    }
    return result;
  };

  return {
    session: null,
    status: 'idle',
    profile: null,

    initAccount: async () => {
      if (get().status === 'loading') return;
      set({ status: 'loading' });
      try {
        const session = await ensureAccount();
        setTelemetrySession(session);
        set({ session, status: session ? 'ready' : 'idle' });
        if (session) {
          const [preferences, profile] = await Promise.all([
            fetchAccountPreferences(),
            auth.fetchAccountProfile(),
          ]);
          if (preferences) {
            applyAccountSettings(preferences);
          }
          if (profile) {
            set({ profile });
            applyAccountSettings(profile.settings);
          }
        }
      } catch {
        set({ status: 'error' });
      }
    },

    refreshProfile: async () => {
      const profile = await auth.fetchAccountProfile();
      if (profile) {
        set({ profile });
        applyAccountSettings(profile.settings);
      }
    },

    applyMapperSnapshot: (snapshot) => {
      const current = get().profile;
      if (!current) return;
      const mapper = mapperFromSnapshot(current.mapper, snapshot);
      set({
        profile: {
          ...current,
          mapper,
          achievements: achievementsFromMapper(current.achievements, mapper),
        },
      });
    },

    applyPivarSnapshot: (snapshot) => {
      set((state) => {
        if (!state.profile) return state;
        return {
          profile: {
            ...state.profile,
            pivar: pivarFromSnapshot(state.profile.pivar, snapshot),
          },
        };
      });
    },

    register: (params) => auth.registerEmail(params).then(applyAuthResult),
    login: (params) => auth.loginEmail(params).then(applyAuthResult),
    signInGoogle: () => auth.signInWithGoogle().then(applyAuthResult),
    signInApple: () => auth.signInWithApple().then(applyAuthResult),
    resetPassword: (params) => auth.resetPassword(params).then(applyAuthResult),

    linkGoogle: () => auth.linkGoogle().then(applyProfileResult),
    linkApple: () => auth.linkApple().then(applyProfileResult),
    unlink: (provider) => auth.unlinkProvider(provider).then(applyProfileResult),
    setPassword: (params) => auth.setPassword(params).then(applyProfileResult),

    updateProfile: (params) => auth.updateProfile(params).then(applyProfileResult),
    // Thin pass-through: advisory check, never writes store state.
    checkNicknameAvailable: (nickname) => auth.checkNicknameAvailable(nickname),
    uploadAvatar: (localUri) => auth.uploadAvatar(localUri).then(applyProfileResult),
    removeAvatar: () => auth.removeAvatar().then(applyProfileResult),

    logout: async (options) => {
      await auth.logout(options);
      set({ profile: null });
      await syncSession();
      await get().refreshProfile();
    },
    deleteAccount: async () => {
      const result = await auth.deleteAccount();
      if (result.ok) {
        set({ profile: null });
        await syncSession();
        await get().refreshProfile();
      }
      return result;
    },
    exportAccountData: () => auth.exportAccountData(),
    restorePurchases: (params) => auth.restorePurchases(params).then(applyProfileResult),
    reportProfileContent: (params) => auth.reportProfileContent(params),
    requestPasswordReset: (email) => auth.requestPasswordReset(email),
    requestEmailVerification: () => auth.requestEmailVerification(),
    verifyEmail: async (token) => {
      const result = await auth.verifyEmail(token);
      if (result.ok) await get().refreshProfile();
      return result;
    },
  };
});

/**
 * Convenience selector: is the durable session credential-backed? Profile is
 * remote enrichment and may be temporarily unavailable while offline; a failed
 * GET /account/me must never make a valid local session look signed out.
 */
export function selectIsSignedIn(state: AccountState): boolean {
  return state.session?.authenticated === true;
}

/**
 * Signed-in but hasn't picked a nickname yet. Used by contextual Parta and
 * leaderboard nudges; it must never hard-gate entry into the app.
 */
export function selectNeedsNickname(state: AccountState): boolean {
  return selectIsSignedIn(state) && state.profile != null && state.profile.nickname == null;
}

/** Current nickname handle (without leading @), or null. */
export function selectNickname(state: AccountState): string | null {
  return state.profile?.nickname ?? null;
}

/** Absolute avatar URL, or null when none is set. */
export function selectAvatarUrl(state: AccountState): string | null {
  return state.profile?.avatarUrl ?? null;
}

/** Public-by-default visibility (true when no profile yet). */
export function selectIsPublic(state: AccountState): boolean {
  return state.profile?.isPublic !== false;
}
