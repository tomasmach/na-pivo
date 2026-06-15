import { create } from 'zustand';

import {
  ensureAccount,
  fetchAccountPreferences,
  type AccountSession,
} from '@/data/account';
import * as auth from '@/data/auth';
import { setTelemetrySession } from '@/data/telemetryClient';
import type {
  AccountProfile,
  AccountSettings,
  AuthActionResult,
  AccountExportActionResult,
  AuthProvider,
  AuthResult,
  ContentReportReason,
  NicknameAvailability,
} from '@/data/auth';
import { useSettingsStore } from '@/stores/settingsStore';

export type AccountStatus = 'idle' | 'loading' | 'ready' | 'error';

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

    register: (params) => auth.registerEmail(params).then(applyAuthResult),
    login: (params) => auth.loginEmail(params).then(applyAuthResult),
    signInGoogle: () => auth.signInWithGoogle().then(applyAuthResult),
    signInApple: () => auth.signInWithApple().then(applyAuthResult),
    resetPassword: (params) => auth.resetPassword(params).then(applyAuthResult),

    linkGoogle: async () => {
      const result = await auth.linkGoogle();
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
    linkApple: async () => {
      const result = await auth.linkApple();
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
    unlink: async (provider) => {
      const result = await auth.unlinkProvider(provider);
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
    setPassword: async (params) => {
      const result = await auth.setPassword(params);
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },

    updateProfile: async (params) => {
      const result = await auth.updateProfile(params);
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
    // Thin pass-through: advisory check, never writes store state.
    checkNicknameAvailable: (nickname) => auth.checkNicknameAvailable(nickname),
    uploadAvatar: async (localUri) => {
      const result = await auth.uploadAvatar(localUri);
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
    removeAvatar: async () => {
      const result = await auth.removeAvatar();
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },

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
    restorePurchases: async (params) => {
      const result = await auth.restorePurchases(params);
      if (result.ok) {
        set({ profile: result.profile });
        applyAccountSettings(result.profile.settings);
      }
      return result;
    },
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

/** Convenience selector: is the user signed in (claimed, not anonymous)? */
export function selectIsSignedIn(state: AccountState): boolean {
  return !!state.profile && !state.profile.isAnonymous;
}

/**
 * Signed-in but hasn't picked a nickname yet — the onboarding gate condition.
 * Anonymous users are excluded (they create an account first).
 */
export function selectNeedsProfileSetup(state: AccountState): boolean {
  return selectIsSignedIn(state) && state.profile?.nickname == null;
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
