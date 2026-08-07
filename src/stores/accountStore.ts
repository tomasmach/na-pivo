import { create } from 'zustand';

import {
  ensureAccount,
  fetchAccountPreferences,
  readDurableAccountSession,
  setAnonymousSessionEvictionListener,
  type AccountSession,
} from '@/data/account';
import * as auth from '@/data/auth';
import { setTelemetrySession, trackApiFailure } from '@/data/telemetryClient';
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
import { reconcileDiarySnapshot, type DiarySnapshot } from '@/data/diarySync';
import { useSettingsStore } from '@/stores/settingsStore';
import { readPrivateAccountMergeIntent } from '@/data/privateAccountBoundary';
import { rekeyAccountPreferencesQueueOwner } from '@/data/accountPreferencesQueue';
import { recoverPartyGameQueuesForAccount } from '@/data/partyGameQueueBoundary';
import { rehydratePrivateStoresAfterBoundary } from '@/data/privateAccountData';
import { setPivarSnapshotListener } from '@/data/pivarXp';

export type AccountStatus = 'idle' | 'loading' | 'ready' | 'reauth-required' | 'error';
export type SessionResumeResult = 'valid' | 'invalid' | 'unavailable' | 'anonymous';

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

interface AccountBoundaryScope {
  epoch: number;
  sessionKey: string | null;
}

let accountBoundaryEpoch = 0;

function sessionKey(session: AccountSession | null): string | null {
  if (!session) return null;
  return `${session.deviceId}\u0000${session.accountId}\u0000${session.token}\u0000${
    session.authenticated ? '1' : '0'
  }`;
}

function captureAccountBoundary(session: AccountSession | null): AccountBoundaryScope {
  return { epoch: accountBoundaryEpoch, sessionKey: sessionKey(session) };
}

function bumpAccountBoundary(): void {
  accountBoundaryEpoch += 1;
}

function isAccountBoundaryCurrent(
  scope: AccountBoundaryScope,
  session: AccountSession | null,
): boolean {
  return scope.epoch === accountBoundaryEpoch && scope.sessionKey === sessionKey(session);
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
  /** Startup deletion receipt was resolved before any cached owner is exposed. */
  startupBoundaryReady: boolean;
  /** Full account state once known (anonymous or signed in). */
  profile: AccountProfile | null;
  /** Owner-only drink + visit snapshot used to reconcile offline diary totals. */
  diarySnapshot: { accountId: string; data: DiarySnapshot } | null;

  /**
   * Ensure an account (anonymous or the signed-in one) exists. Never throws. A
   * call made while one is already in flight is ignored (concurrency guard).
   */
  initAccount: () => Promise<void>;
  /** Rehydrate a missing session or validate the signed-in one after resume. */
  resumeSession: () => Promise<SessionResumeResult>;
  /** Re-fetch GET /v1/account/me into `profile`. */
  refreshProfile: () => Promise<void>;
  /** Flush local diary queues, then refresh the authoritative drink/visit snapshot. */
  refreshDiarySnapshot: () => Promise<void>;
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
  logout: (options?: { all?: boolean }) => Promise<AuthActionResult>;
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
  let credentialTransitionChain: Promise<void> = Promise.resolve();
  let deleteAccountInFlight: Promise<AuthActionResult> | null = null;

  const serializeCredentialTransition = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = credentialTransitionChain.then(operation, operation);
    credentialTransitionChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const accountPreferencesRevision = (): number =>
    useSettingsStore.getState().accountPreferencesRevision;

  const applyAccountSettings = (
    settings?: AccountSettings | null,
    expectedRevision?: number,
  ) => {
    if (!settings) return;
    useSettingsStore.getState().applyAccountPreferencesFromServer(
      settings,
      get().session?.accountId ?? null,
      expectedRevision,
    );
  };

  const installSession = (session: AccountSession | null): AccountBoundaryScope => {
    const previous = get().session;
    if (sessionKey(previous) !== sessionKey(session)) bumpAccountBoundary();

    setTelemetrySession(session);
    set((state) => ({
      session,
      status: session ? 'ready' : 'idle',
      profile:
        previous && session && previous.accountId === session.accountId ? state.profile : null,
      diarySnapshot:
        state.diarySnapshot?.accountId === session?.accountId ? state.diarySnapshot : null,
    }));
    return captureAccountBoundary(session);
  };

  /** Re-read the (possibly rotated) session token into the store. */
  const syncSession = async (): Promise<{
    session: AccountSession | null;
    scope: AccountBoundaryScope;
  } | null> => {
    const requestScope = captureAccountBoundary(get().session);
    const session = await ensureAccount();
    if (!isAccountBoundaryCurrent(requestScope, get().session)) return null;
    return { session, scope: installSession(session) };
  };

  const refreshDiarySnapshot = async () => {
    const requestScope = captureAccountBoundary(get().session);
    const accountId = get().session?.accountId;
    if (!accountId) return;
    const data = await reconcileDiarySnapshot();
    if (data && isAccountBoundaryCurrent(requestScope, get().session)) {
      set({ diarySnapshot: { accountId, data } });
    }
  };

  /** After a session-changing auth call: persist the new token + profile. */
  const applyAuthResult = async (result: AuthResult): Promise<AuthResult> => {
    if (result.ok) {
      const outgoing = get().session;
      if (
        outgoing &&
        !outgoing.authenticated &&
        outgoing.accountId !== result.profile.id
      ) {
        const rekeyed = await rekeyAccountPreferencesQueueOwner(
          outgoing.accountId,
          result.profile.id,
        );
        if (!rekeyed) {
          trackApiFailure('account_preferences_queue', {
            reason: 'anonymous_merge_rekey_failed',
          });
        }
      }
      const synced = await syncSession();
      if (!synced?.session || synced.session.accountId !== result.profile.id) return result;
      if (!isAccountBoundaryCurrent(synced.scope, get().session)) return result;
      set({ profile: result.profile });
      applyAccountSettings(result.profile.settings);
      await refreshDiarySnapshot();
    }
    return result;
  };

  const runSessionAuthAction = (action: () => Promise<AuthResult>): Promise<AuthResult> =>
    serializeCredentialTransition(async () => {
      // Invalidate responses started under A before auth can durably install B.
      // A failed auth attempt keeps the same session; later A requests capture
      // the new epoch normally.
      bumpAccountBoundary();
      return applyAuthResult(await action());
    });

  /** After a profile-changing auth call that leaves the session token intact
   *  (link / unlink / profile / avatar / purchases): persist the updated profile
   *  + settings. Mirrors applyAuthResult without the session re-sync. */
  const runProfileAction = async (action: () => Promise<AuthResult>): Promise<AuthResult> => {
    const requestScope = captureAccountBoundary(get().session);
    const preferencesRevision = accountPreferencesRevision();
    const result = await action();
    if (result.ok && isAccountBoundaryCurrent(requestScope, get().session)) {
      set({ profile: result.profile });
      applyAccountSettings(result.profile.settings, preferencesRevision);
    }
    return result;
  };

  return {
    session: null,
    status: 'idle',
    startupBoundaryReady: false,
    profile: null,
    diarySnapshot: null,

    initAccount: async () => {
      if (get().status === 'loading') return;
      const requestScope = captureAccountBoundary(get().session);
      let activeScope = requestScope;
      set({ status: 'loading' });
      try {
        // Resolve a crash-lost anonymous merge before deletion recovery or any
        // private store can publish. Only exact durable B may auto-finalize;
        // durable A stays available for an explicit idempotent auth retry.
        const [durableSession, mergeIntent] = await Promise.all([
          readDurableAccountSession(),
          readPrivateAccountMergeIntent(),
        ]);
        if (!mergeIntent.ok || !durableSession.available) {
          set({ status: 'error', startupBoundaryReady: false });
          return;
        }
        if (mergeIntent.intent) {
          const durable = durableSession.session;
          if (
            durable &&
            mergeIntent.intent.toAccountId === durable.accountId &&
            await recoverPartyGameQueuesForAccount(durable.accountId)
          ) {
            if (!(await rehydratePrivateStoresAfterBoundary())) {
              set({ status: 'error', startupBoundaryReady: false });
              return;
            }
          } else if (
            durable &&
            durable.accountId === mergeIntent.intent.fromAccountId
          ) {
            activeScope = installSession(durable);
            set({ status: 'reauth-required', startupBoundaryReady: true });
            return;
          } else {
            set({ status: 'error', startupBoundaryReady: false });
            return;
          }
        }

        const deletionRecovery = await auth.recoverPendingAccountDeletionAtStartup();
        if (!isAccountBoundaryCurrent(requestScope, get().session)) return;
        if (deletionRecovery === 'blocked') {
          set({ status: 'error', startupBoundaryReady: false });
          return;
        }
        set({ startupBoundaryReady: true });

        const session = await ensureAccount();
        if (!isAccountBoundaryCurrent(requestScope, get().session)) return;
        activeScope = installSession(session);
        if (session) {
          const preferencesRevision = accountPreferencesRevision();
          const [preferences, profile] = await Promise.all([
            fetchAccountPreferences(),
            auth.fetchAccountProfile(),
            refreshDiarySnapshot(),
          ]);
          if (!isAccountBoundaryCurrent(activeScope, get().session)) return;
          if (preferences) {
            applyAccountSettings(preferences, preferencesRevision);
          }
          if (profile) {
            set({ profile });
            applyAccountSettings(profile.settings, preferencesRevision);
          }
        }
      } catch (error) {
        if (!isAccountBoundaryCurrent(activeScope, get().session)) return;
        trackApiFailure('account_init_exception', {
          reason: 'exception',
          errorName: error instanceof Error ? error.name : typeof error,
        });
        set({ status: 'error' });
      }
    },

    resumeSession: async () => {
      let session = get().session;
      if (!session) {
        await get().initAccount();
        session = get().session;
      }
      if (!session) return 'unavailable';
      if (!session.authenticated) return 'anonymous';

      const requestScope = captureAccountBoundary(session);
      const preferencesRevision = accountPreferencesRevision();
      const validation = await auth.validateAccountSession(session);
      // Ignore a response for a session that was replaced while validation was
      // in flight (for example by a manual login opened from another screen).
      if (!isAccountBoundaryCurrent(requestScope, get().session)) return 'unavailable';

      if (validation.status === 'invalid') {
        // Keep the credential and all account-local state intact. The auth
        // screen can replace the token after an explicit login, while queued
        // diary work remains available offline in the meantime.
        set({ status: 'reauth-required' });
        setTelemetrySession(null);
        return 'invalid';
      }
      if (validation.status === 'unavailable') return 'unavailable';

      set({ profile: validation.profile, status: 'ready' });
      setTelemetrySession(session);
      applyAccountSettings(validation.profile.settings, preferencesRevision);
      return 'valid';
    },

    refreshProfile: async () => {
      const requestScope = captureAccountBoundary(get().session);
      const preferencesRevision = accountPreferencesRevision();
      const profile = await auth.fetchAccountProfile();
      if (profile && isAccountBoundaryCurrent(requestScope, get().session)) {
        set({ profile });
        applyAccountSettings(profile.settings, preferencesRevision);
      }
    },

    refreshDiarySnapshot,

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

    register: (params) => runSessionAuthAction(() => auth.registerEmail(params)),
    login: (params) => runSessionAuthAction(() => auth.loginEmail(params)),
    signInGoogle: () => runSessionAuthAction(() => auth.signInWithGoogle()),
    signInApple: () => runSessionAuthAction(() => auth.signInWithApple()),
    resetPassword: (params) => runSessionAuthAction(() => auth.resetPassword(params)),

    linkGoogle: () => runProfileAction(() => auth.linkGoogle()),
    linkApple: () => runProfileAction(() => auth.linkApple()),
    unlink: (provider) => runProfileAction(() => auth.unlinkProvider(provider)),
    setPassword: (params) => runProfileAction(() => auth.setPassword(params)),

    updateProfile: (params) => runProfileAction(() => auth.updateProfile(params)),
    // Thin pass-through: advisory check, never writes store state.
    checkNicknameAvailable: (nickname) => auth.checkNicknameAvailable(nickname),
    uploadAvatar: (localUri) => runProfileAction(() => auth.uploadAvatar(localUri)),
    removeAvatar: () => runProfileAction(() => auth.removeAvatar()),

    logout: (options) =>
      serializeCredentialTransition(async () => {
        bumpAccountBoundary();
        const result = await auth.logout(options);
        if (!result.ok) return result;
        bumpAccountBoundary();
        setTelemetrySession(null);
        set({ session: null, status: 'idle', profile: null, diarySnapshot: null });
        await syncSession();
        await get().refreshProfile();
        return result;
      }),
    deleteAccount: () => {
      if (deleteAccountInFlight) return deleteAccountInFlight;
      const confirmedOwner = sessionKey(get().session);
      const operation = serializeCredentialTransition(async () => {
        if (sessionKey(get().session) !== confirmedOwner) {
          return {
            ok: false as const,
            code: 'account_changed',
            detail: 'Účet se mezitím změnil. Smazání potvrď znovu.',
          };
        }
        bumpAccountBoundary();
        const result = await auth.deleteAccount();
        if (result.ok) {
          bumpAccountBoundary();
          setTelemetrySession(null);
          set({ session: null, status: 'idle', profile: null, diarySnapshot: null });
          await syncSession();
          await get().refreshProfile();
        }
        return result;
      });
      const tracked = operation.finally(() => {
        if (deleteAccountInFlight === tracked) deleteAccountInFlight = null;
      });
      deleteAccountInFlight = tracked;
      return tracked;
    },
    exportAccountData: () => auth.exportAccountData(),
    restorePurchases: (params) => runProfileAction(() => auth.restorePurchases(params)),
    reportProfileContent: (params) => auth.reportProfileContent(params),
    requestPasswordReset: (email) => auth.requestPasswordReset(email),
    requestEmailVerification: () => auth.requestEmailVerification(),
    verifyEmail: async (token) => {
      const requestScope = captureAccountBoundary(get().session);
      const result = await auth.verifyEmail(token);
      if (result.ok && isAccountBoundaryCurrent(requestScope, get().session)) {
        await get().refreshProfile();
      }
      return result;
    },
  };
});

setPivarSnapshotListener((snapshot) => {
  useAccountStore.getState().applyPivarSnapshot(snapshot);
});

setAnonymousSessionEvictionListener(async () => {
  bumpAccountBoundary();
  setTelemetrySession(null);
  useAccountStore.setState({
    session: null,
    status: 'idle',
    profile: null,
    diarySnapshot: null,
  });
  await useAccountStore.getState().initAccount();
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
