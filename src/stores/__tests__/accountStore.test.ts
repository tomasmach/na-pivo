/**
 * Tests for the account store (src/stores/accountStore.ts) — the zustand
 * actions and the selectIsSignedIn selector.
 *
 * The store is a thin wrapper around @/data/auth + @/data/account, so both are
 * fully mocked: we drive the auth.* return values and assert how the store
 * mutates `profile`/`session` and which account-layer helpers it calls. The
 * settingsStore is mocked because initAccount touches it.
 */

import { useAccountStore, selectIsSignedIn } from '@/stores/accountStore';
import * as auth from '@/data/auth';
import type { AccountProfile, AuthResult } from '@/data/auth';
import { ensureAccount } from '@/data/account';

jest.mock('@/data/auth');
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'tok',
    authenticated: true,
  })),
  fetchAccountPreferences: jest.fn(async () => null),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ setHidePubNames: jest.fn() }),
  },
}));

const mockedAuth = auth as jest.Mocked<typeof auth>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;

function signedInProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    id: 'acc-1',
    deviceId: 'dev-1',
    displayName: 'Jan',
    email: 'jan@example.com',
    emailVerified: true,
    providers: ['email'],
    isAnonymous: false,
    status: 'active',
    ...overrides,
  };
}

function okResult(profile = signedInProfile()): AuthResult {
  return { ok: true, profile };
}

function errResult(code = 'invalid_credentials', detail = 'nope'): AuthResult {
  return { ok: false, code, detail };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the singleton store back to a clean slate between tests.
  useAccountStore.setState({ session: null, status: 'idle', profile: null });
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'tok',
    authenticated: true,
  });
  // fetchAccountProfile is used by refreshProfile (e.g. inside logout); default
  // it to null so it doesn't accidentally re-populate the profile.
  mockedAuth.fetchAccountProfile.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// register / login / signInGoogle — session-changing auth
// ---------------------------------------------------------------------------
describe('register', () => {
  it('sets the profile and re-syncs the session on success', async () => {
    const profile = signedInProfile();
    mockedAuth.registerEmail.mockResolvedValue(okResult(profile));

    const result = await useAccountStore.getState().register({
      email: 'jan@example.com',
      password: 'pw',
      displayName: 'Jan',
    });

    expect(result).toEqual(okResult(profile));
    expect(mockedAuth.registerEmail).toHaveBeenCalledWith({
      email: 'jan@example.com',
      password: 'pw',
      displayName: 'Jan',
    });
    expect(useAccountStore.getState().profile).toEqual(profile);
    // applyAuthResult re-reads the (rotated) session via ensureAccount.
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().status).toBe('ready');
  });

  it('leaves the profile null and does not sync on failure', async () => {
    mockedAuth.registerEmail.mockResolvedValue(errResult('email_taken', 'taken'));

    const result = await useAccountStore.getState().register({ email: 'a@b.cz', password: 'pw' });

    expect(result.ok).toBe(false);
    expect(useAccountStore.getState().profile).toBeNull();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('sets the profile on success', async () => {
    const profile = signedInProfile();
    mockedAuth.loginEmail.mockResolvedValue(okResult(profile));

    await useAccountStore.getState().login({ email: 'jan@example.com', password: 'pw' });

    expect(useAccountStore.getState().profile).toEqual(profile);
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
  });

  it('leaves the profile null on failure', async () => {
    mockedAuth.loginEmail.mockResolvedValue(errResult());

    await useAccountStore.getState().login({ email: 'jan@example.com', password: 'bad' });

    expect(useAccountStore.getState().profile).toBeNull();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
  });
});

describe('signInGoogle', () => {
  it('sets the profile and syncs the session on success', async () => {
    const profile = signedInProfile({ providers: ['google'] });
    mockedAuth.signInWithGoogle.mockResolvedValue(okResult(profile));

    await useAccountStore.getState().signInGoogle();

    expect(useAccountStore.getState().profile).toEqual(profile);
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
  });

  it('leaves the profile null when sign-in is cancelled', async () => {
    mockedAuth.signInWithGoogle.mockResolvedValue(errResult('cancelled', ''));

    const result = await useAccountStore.getState().signInGoogle();

    expect(result.ok).toBe(false);
    expect(useAccountStore.getState().profile).toBeNull();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// unlink — session-unchanged profile mutation
// ---------------------------------------------------------------------------
describe('unlink', () => {
  it('sets the profile from the unlink result on success', async () => {
    const profile = signedInProfile({ providers: ['email'] });
    mockedAuth.unlinkProvider.mockResolvedValue(okResult(profile));

    const result = await useAccountStore.getState().unlink('google');

    expect(result).toEqual(okResult(profile));
    expect(mockedAuth.unlinkProvider).toHaveBeenCalledWith('google');
    expect(useAccountStore.getState().profile).toEqual(profile);
    // Linking/unlinking never rotates the session.
    expect(mockEnsureAccount).not.toHaveBeenCalled();
  });

  it('does not touch the profile on failure', async () => {
    const existing = signedInProfile();
    useAccountStore.setState({ profile: existing });
    mockedAuth.unlinkProvider.mockResolvedValue(errResult('last_credential', 'blocked'));

    const result = await useAccountStore.getState().unlink('email');

    expect(result.ok).toBe(false);
    expect(useAccountStore.getState().profile).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
// logout — clears profile + reverts (via auth.logout)
// ---------------------------------------------------------------------------
describe('logout', () => {
  it('clears the profile and re-syncs the anonymous session', async () => {
    useAccountStore.setState({ profile: signedInProfile() });
    mockedAuth.logout.mockResolvedValue({ ok: true });
    // After logout, ensureAccount returns a fresh anonymous session.
    mockEnsureAccount.mockResolvedValue({
      deviceId: 'd2',
      accountId: 'a2',
      token: 'anon2',
      authenticated: false,
    });

    await useAccountStore.getState().logout();

    expect(mockedAuth.logout).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().profile).toBeNull();
    // syncSession re-reads the new anonymous session.
    expect(useAccountStore.getState().session).toEqual({
      deviceId: 'd2',
      accountId: 'a2',
      token: 'anon2',
      authenticated: false,
    });
    expect(mockEnsureAccount).toHaveBeenCalled();
  });

  it('forwards the {all} option to auth.logout', async () => {
    mockedAuth.logout.mockResolvedValue({ ok: true });
    await useAccountStore.getState().logout({ all: true });
    expect(mockedAuth.logout).toHaveBeenCalledWith({ all: true });
  });
});

// ---------------------------------------------------------------------------
// deleteAccount
// ---------------------------------------------------------------------------
describe('deleteAccount', () => {
  it('clears the profile on success', async () => {
    useAccountStore.setState({ profile: signedInProfile() });
    mockedAuth.deleteAccount.mockResolvedValue({ ok: true });

    const result = await useAccountStore.getState().deleteAccount();

    expect(result).toEqual({ ok: true });
    expect(useAccountStore.getState().profile).toBeNull();
  });

  it('keeps the profile when deletion fails', async () => {
    const existing = signedInProfile();
    useAccountStore.setState({ profile: existing });
    mockedAuth.deleteAccount.mockResolvedValue({ ok: false, code: 'network', detail: 'x' });

    const result = await useAccountStore.getState().deleteAccount();

    expect(result.ok).toBe(false);
    expect(useAccountStore.getState().profile).toEqual(existing);
  });
});

// ---------------------------------------------------------------------------
// verifyEmail — refreshes profile on success
// ---------------------------------------------------------------------------
describe('verifyEmail', () => {
  it('refreshes the profile from the backend on success', async () => {
    const verified = signedInProfile({ emailVerified: true });
    mockedAuth.verifyEmail.mockResolvedValue({ ok: true });
    mockedAuth.fetchAccountProfile.mockResolvedValue(verified);

    const result = await useAccountStore.getState().verifyEmail('token');

    expect(result).toEqual({ ok: true });
    expect(mockedAuth.fetchAccountProfile).toHaveBeenCalled();
    expect(useAccountStore.getState().profile).toEqual(verified);
  });

  it('does not refresh the profile on failure', async () => {
    mockedAuth.verifyEmail.mockResolvedValue({ ok: false, code: 'invalid_token', detail: 'x' });

    await useAccountStore.getState().verifyEmail('bad');

    expect(mockedAuth.fetchAccountProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectIsSignedIn
// ---------------------------------------------------------------------------
describe('selectIsSignedIn', () => {
  it('is false when there is no profile', () => {
    useAccountStore.setState({ profile: null });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(false);
  });

  it('is false for an anonymous profile', () => {
    useAccountStore.setState({ profile: signedInProfile({ isAnonymous: true }) });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(false);
  });

  it('is true only for a claimed (non-anonymous) profile', () => {
    useAccountStore.setState({ profile: signedInProfile({ isAnonymous: false }) });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(true);
  });
});
