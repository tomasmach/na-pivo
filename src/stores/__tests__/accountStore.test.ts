/**
 * Tests for the account store (src/stores/accountStore.ts) — the zustand
 * actions and the selectIsSignedIn selector.
 *
 * The store is a thin wrapper around @/data/auth + @/data/account, so both are
 * fully mocked: we drive the auth.* return values and assert how the store
 * mutates `profile`/`session` and which account-layer helpers it calls. The
 * settingsStore is mocked because initAccount touches it.
 */

import {
  useAccountStore,
  selectIsSignedIn,
  selectNeedsNickname,
} from '@/stores/accountStore';
import * as auth from '@/data/auth';
import { EMPTY_ACHIEVEMENTS, type AccountMapper, type AccountProfile, type AuthResult } from '@/data/auth';
import { ensureAccount, setAnonymousSessionEvictionListener } from '@/data/account';
import { setTelemetrySession, trackApiFailure } from '@/data/telemetryClient';
import { reconcileDiarySnapshot } from '@/data/diarySync';

jest.mock('@/data/auth');
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'tok',
    authenticated: true,
  })),
  fetchAccountPreferences: jest.fn(async () => null),
  setAnonymousSessionEvictionListener: jest.fn(),
}));
jest.mock('@/data/telemetryClient', () => ({
  setTelemetrySession: jest.fn(),
  trackApiFailure: jest.fn(),
}));
jest.mock('@/data/diarySync', () => ({
  reconcileDiarySnapshot: jest.fn(async () => null),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ setHidePubNames: jest.fn() }),
  },
}));

const mockedAuth = auth as jest.Mocked<typeof auth>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const registeredAnonymousSessionEvictionListener = jest.mocked(setAnonymousSessionEvictionListener)
  .mock.calls[0]?.[0] as (() => Promise<void>) | undefined;
const mockSetTelemetrySession = setTelemetrySession as jest.MockedFunction<typeof setTelemetrySession>;
const mockTrackApiFailure = trackApiFailure as jest.MockedFunction<typeof trackApiFailure>;
const mockReconcileDiarySnapshot = reconcileDiarySnapshot as jest.MockedFunction<
  typeof reconcileDiarySnapshot
>;

function signedInProfile(overrides: Partial<AccountProfile> = {}): AccountProfile {
  return {
    id: 'acc-1',
    deviceId: 'dev-1',
    nickname: 'jan',
    displayName: 'Jan',
    avatarUrl: null,
    isPublic: true,
    email: 'jan@example.com',
    emailVerified: true,
    providers: ['email'],
    isAnonymous: false,
    status: 'active',
    ...overrides,
  };
}

/** A full Mapér block with distinctive durable counters/levels/xpRules so tests
 *  can prove applyMapperSnapshot preserves absent fields and patches present ones. */
function fullMapper(overrides: Partial<AccountMapper> = {}): AccountMapper {
  return {
    xp: 285,
    level: 3,
    title: 'Štamgast',
    xpIntoLevel: 135,
    xpForNextLevel: 250,
    amenityVotesCount: 42,
    distinctMappedPubs: 7,
    firstMapperCount: 2,
    completedPubsCount: 1,
    levels: [
      { level: 1, title: 'Nováček', xp: 0 },
      { level: 2, title: 'Všímálek', xp: 300 },
      { level: 3, title: 'Štamgast', xp: 900 },
    ],
    xpRules: { firstFact: 10, firstMapperBonus: 25, confirm: 2, pubCompleteBonus: 50 },
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
  useAccountStore.setState({ session: null, status: 'idle', profile: null, diarySnapshot: null });
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'tok',
    authenticated: true,
  });
  // fetchAccountProfile is used by refreshProfile (e.g. inside logout); default
  // it to null so it doesn't accidentally re-populate the profile.
  mockedAuth.fetchAccountProfile.mockResolvedValue(null);
  mockedAuth.validateAccountSession.mockResolvedValue({
    status: 'valid',
    profile: signedInProfile(),
  });
  mockReconcileDiarySnapshot.mockResolvedValue(null);
});

describe('initAccount', () => {
  it('keeps a durable signed-in session signed in when the profile fetch is unavailable', async () => {
    await useAccountStore.getState().initAccount();

    const state = useAccountStore.getState();
    expect(state.status).toBe('ready');
    expect(state.profile).toBeNull();
    expect(selectIsSignedIn(state)).toBe(true);
  });

  it('refreshes in-memory state when the account layer evicts an anonymous session', async () => {
    useAccountStore.setState({
      session: { deviceId: 'old-d', accountId: 'old-a', token: 'dead', authenticated: false },
      status: 'ready',
    });
    mockEnsureAccount.mockResolvedValueOnce({
      deviceId: 'new-d',
      accountId: 'new-a',
      token: 'fresh',
      authenticated: false,
    });

    expect(registeredAnonymousSessionEvictionListener).toBeDefined();
    await registeredAnonymousSessionEvictionListener?.();

    expect(useAccountStore.getState()).toMatchObject({
      session: {
        deviceId: 'new-d',
        accountId: 'new-a',
        token: 'fresh',
        authenticated: false,
      },
      status: 'ready',
    });
  });

  it('reports init exceptions with only the error class', async () => {
    mockEnsureAccount.mockRejectedValueOnce(new TypeError('sensitive detail'));

    await useAccountStore.getState().initAccount();

    expect(mockTrackApiFailure).toHaveBeenCalledWith('account_init_exception', {
      reason: 'exception',
      errorName: 'TypeError',
    });
    expect(useAccountStore.getState().status).toBe('error');
  });
});

describe('resumeSession', () => {
  it('validates an existing credential and refreshes its profile', async () => {
    const previous = signedInProfile({ displayName: 'Starý profil' });
    const refreshed = signedInProfile({ displayName: 'Čerstvý profil' });
    useAccountStore.setState({
      session: { deviceId: 'd', accountId: 'a', token: 'tok', authenticated: true },
      status: 'ready',
      profile: previous,
    });
    mockedAuth.validateAccountSession.mockResolvedValue({ status: 'valid', profile: refreshed });

    await expect(useAccountStore.getState().resumeSession()).resolves.toBe('valid');

    expect(mockedAuth.validateAccountSession).toHaveBeenCalledWith({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
    expect(useAccountStore.getState()).toMatchObject({ status: 'ready', profile: refreshed });
  });

  it('rehydrates credentials that became available again before validating them', async () => {
    useAccountStore.setState({ session: null, status: 'idle', profile: null });
    const refreshed = signedInProfile();
    mockedAuth.fetchAccountProfile.mockResolvedValue(refreshed);
    mockedAuth.validateAccountSession.mockResolvedValue({ status: 'valid', profile: refreshed });

    await expect(useAccountStore.getState().resumeSession()).resolves.toBe('valid');

    expect(mockEnsureAccount).toHaveBeenCalled();
    expect(mockedAuth.validateAccountSession).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok', authenticated: true }),
    );
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(true);
  });

  it('preserves the session, profile and local diary work when the token is invalid', async () => {
    const session = { deviceId: 'd', accountId: 'a', token: 'expired', authenticated: true };
    const profile = signedInProfile();
    const diarySnapshot = { accountId: 'a', data: { drinks: [], visits: [] } };
    useAccountStore.setState({ session, status: 'ready', profile, diarySnapshot });
    mockedAuth.validateAccountSession.mockResolvedValue({ status: 'invalid' });

    await expect(useAccountStore.getState().resumeSession()).resolves.toBe('invalid');

    expect(useAccountStore.getState()).toMatchObject({
      session,
      profile,
      diarySnapshot,
      status: 'reauth-required',
    });
    expect(mockSetTelemetrySession).toHaveBeenCalledWith(null);
  });

  it('treats an outage as unavailable and leaves a working session untouched', async () => {
    const session = { deviceId: 'd', accountId: 'a', token: 'tok', authenticated: true };
    const profile = signedInProfile();
    useAccountStore.setState({ session, status: 'ready', profile });
    mockedAuth.validateAccountSession.mockResolvedValue({ status: 'unavailable' });

    await expect(useAccountStore.getState().resumeSession()).resolves.toBe('unavailable');

    expect(useAccountStore.getState()).toMatchObject({ session, profile, status: 'ready' });
  });
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
    expect(mockSetTelemetrySession).toHaveBeenCalledWith({
      deviceId: 'd',
      accountId: 'a',
      token: 'tok',
      authenticated: true,
    });
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
  it('sets the profile and loads the authoritative diary snapshot on success', async () => {
    const profile = signedInProfile();
    mockedAuth.loginEmail.mockResolvedValue(okResult(profile));
    const snapshot = { drinks: [], visits: [] };
    mockReconcileDiarySnapshot.mockResolvedValue(snapshot);

    await useAccountStore.getState().login({ email: 'jan@example.com', password: 'pw' });

    expect(useAccountStore.getState().profile).toEqual(profile);
    expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
    expect(mockReconcileDiarySnapshot).toHaveBeenCalledTimes(1);
    expect(useAccountStore.getState().diarySnapshot).toEqual({ accountId: 'a', data: snapshot });
  });

  it('leaves the profile null on failure', async () => {
    mockedAuth.loginEmail.mockResolvedValue(errResult());

    await useAccountStore.getState().login({ email: 'jan@example.com', password: 'bad' });

    expect(useAccountStore.getState().profile).toBeNull();
    expect(mockEnsureAccount).not.toHaveBeenCalled();
  });

  it('returns a session waiting for recovery to ready after successful login', async () => {
    const profile = signedInProfile();
    const diarySnapshot = { accountId: 'a', data: { drinks: [], visits: [] } };
    useAccountStore.setState({ status: 'reauth-required', diarySnapshot });
    mockedAuth.loginEmail.mockResolvedValue(okResult(profile));
    mockReconcileDiarySnapshot.mockResolvedValue(diarySnapshot.data);

    await useAccountStore.getState().login({ email: 'jan@example.com', password: 'pw' });

    expect(useAccountStore.getState()).toMatchObject({
      status: 'ready',
      profile,
      diarySnapshot,
    });
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
    expect(mockSetTelemetrySession).toHaveBeenCalledWith({
      deviceId: 'd2',
      accountId: 'a2',
      token: 'anon2',
      authenticated: false,
    });
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
// applyMapperSnapshot — live XP/level patch from the PUT votes envelope
// ---------------------------------------------------------------------------
describe('applyMapperSnapshot', () => {
  it('patches the live XP/level/title + into-level while preserving absent counters', () => {
    const mapper = fullMapper();
    useAccountStore.setState({ profile: signedInProfile({ mapper }) });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 320,
      level: 4,
      title: 'Znalec',
      xpIntoLevel: 20,
      xpForNextLevel: 300,
    });

    const patched = useAccountStore.getState().profile?.mapper;
    // Live fields climb to the snapshot.
    expect(patched?.xp).toBe(320);
    expect(patched?.level).toBe(4);
    expect(patched?.title).toBe('Znalec');
    expect(patched?.xpIntoLevel).toBe(20);
    expect(patched?.xpForNextLevel).toBe(300);
    // Older compact snapshots omit counters, so the previous values are preserved.
    expect(patched?.distinctMappedPubs).toBe(mapper.distinctMappedPubs);
    expect(patched?.amenityVotesCount).toBe(mapper.amenityVotesCount);
    expect(patched?.firstMapperCount).toBe(mapper.firstMapperCount);
    expect(patched?.completedPubsCount).toBe(mapper.completedPubsCount);
    expect(patched?.levels).toEqual(mapper.levels);
    expect(patched?.xpRules).toEqual(mapper.xpRules);
  });

  it('patches optional mapper counters when the PUT snapshot includes them', () => {
    const mapper = fullMapper({ completedPubsCount: 0 });
    useAccountStore.setState({ profile: signedInProfile({ mapper }) });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 350,
      level: 4,
      title: 'Znalec',
      xpIntoLevel: 50,
      xpForNextLevel: 250,
      distinctMappedPubs: 8,
      amenityVotesCount: 43,
      firstMapperCount: 3,
      completedPubsCount: 1,
    });

    const patched = useAccountStore.getState().profile?.mapper;
    expect(patched?.distinctMappedPubs).toBe(8);
    expect(patched?.amenityVotesCount).toBe(43);
    expect(patched?.firstMapperCount).toBe(3);
    expect(patched?.completedPubsCount).toBe(1);
    expect(patched?.levels).toEqual(mapper.levels);
    expect(patched?.xpRules).toEqual(mapper.xpRules);
  });

  it('creates a fallback mapper block when no full mapper block exists yet', () => {
    const profile = signedInProfile();
    expect(profile.mapper).toBeUndefined();
    useAccountStore.setState({ profile });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 40,
      level: 1,
      title: 'Nováček',
      xpIntoLevel: 40,
      xpForNextLevel: 50,
      distinctMappedPubs: 1,
      amenityVotesCount: 1,
      firstMapperCount: 1,
      completedPubsCount: 0,
    });

    const patched = useAccountStore.getState().profile;
    expect(patched?.mapper).toEqual({
      xp: 40,
      level: 1,
      title: 'Nováček',
      xpIntoLevel: 40,
      xpForNextLevel: 50,
      distinctMappedPubs: 1,
      amenityVotesCount: 1,
      firstMapperCount: 1,
      completedPubsCount: 0,
      levels: [
        { level: 1, title: 'Nováček', xp: 0 },
        { level: 2, title: 'Všímálek', xp: 300 },
        { level: 3, title: 'Štamgast', xp: 900 },
        { level: 4, title: 'Znalec', xp: 2500 },
        { level: 5, title: 'Hospodský mudrc', xp: 6000 },
        { level: 6, title: 'Pivní kartograf', xp: 12000 },
        { level: 7, title: 'Legenda lokálu', xp: 24000 },
      ],
      xpRules: { firstFact: 15, firstMapperBonus: 25, confirm: 5, pubCompleteBonus: 30 },
    });
    expect(patched?.achievements?.firstMap).toBe(true);
    expect(patched?.achievements?.explorer).toBe(false);
  });

  it('treats a null xpForNextLevel snapshot as max level', () => {
    const mapper = fullMapper({ xpForNextLevel: 50 });
    useAccountStore.setState({ profile: signedInProfile({ mapper }) });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 2820,
      level: 5,
      title: 'Hospodský mudrc',
      xpIntoLevel: 1920,
      xpForNextLevel: null,
    });

    const patched = useAccountStore.getState().profile?.mapper;
    expect(patched?.xp).toBe(2820);
    expect(patched?.xpForNextLevel).toBeNull();
  });

  it('keeps the previous xpForNextLevel only when the snapshot omits it', () => {
    const mapper = fullMapper({ xpForNextLevel: 250 });
    useAccountStore.setState({ profile: signedInProfile({ mapper }) });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 350,
      level: 4,
      title: 'Znalec',
      xpIntoLevel: 50,
    });

    expect(useAccountStore.getState().profile?.mapper?.xpForNextLevel).toBe(250);
  });

  it('updates Mapér achievements from snapshot counters without clearing old badges', () => {
    useAccountStore.setState({
      profile: signedInProfile({
        achievements: {
          ...EMPTY_ACHIEVEMENTS,
          firstTen: true,
          regular: false,
          reviewer: true,
        },
        mapper: fullMapper({ distinctMappedPubs: 9, amenityVotesCount: 99, completedPubsCount: 0 }),
      }),
    });

    useAccountStore.getState().applyMapperSnapshot({
      xp: 500,
      level: 4,
      title: 'Znalec',
      xpIntoLevel: 100,
      xpForNextLevel: 500,
      distinctMappedPubs: 25,
      amenityVotesCount: 100,
      firstMapperCount: 1,
      completedPubsCount: 1,
    });

    expect(useAccountStore.getState().profile?.achievements).toEqual({
      ...EMPTY_ACHIEVEMENTS,
      firstTen: true,
      regular: false,
      reviewer: true,
      firstMap: true,
      explorer: true,
      cartographer: true,
      completionist: true,
      factMachine: true,
      // Server-only badge: a mapper snapshot must carry it through unchanged.
      fotoPivar: false,
    });
  });
});

// ---------------------------------------------------------------------------
// selectIsSignedIn
// ---------------------------------------------------------------------------
describe('selectIsSignedIn', () => {
  it('stays true when a signed-in session exists but the profile request failed', () => {
    useAccountStore.setState({
      session: { deviceId: 'd', accountId: 'a', token: 'tok', authenticated: true },
      profile: null,
    });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(true);
    expect(selectNeedsNickname(useAccountStore.getState())).toBe(false);
  });

  it('is false for an anonymous session even if a stale claimed profile exists', () => {
    useAccountStore.setState({
      session: { deviceId: 'd', accountId: 'a', token: 'tok', authenticated: false },
      profile: signedInProfile(),
    });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(false);
  });

  it('is true for a credential-backed session', () => {
    useAccountStore.setState({
      session: { deviceId: 'd', accountId: 'a', token: 'tok', authenticated: true },
      profile: signedInProfile(),
    });
    expect(selectIsSignedIn(useAccountStore.getState())).toBe(true);
  });
});
