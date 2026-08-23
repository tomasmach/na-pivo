/**
 * Tests for the shared-evening store (src/stores/partyEveningStore.ts).
 *
 * The behaviour worth guarding is what happens when the network is bad, because
 * that is the normal case in a pub: a failed refresh must not look like "you
 * left the table", and a second tap on a slow button must not start a second
 * evening.
 */

import {
  clearPartyEveningState,
  selectConfirmedPartyJoinCode,
  selectPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import type { PartyEvening } from '@/data/partyClient';

const fetchCurrentPartyEvening: jest.Mock = jest.fn();
const createPartyEvening: jest.Mock = jest.fn();
const joinPartyEvening: jest.Mock = jest.fn();
const leavePartyEvening: jest.Mock = jest.fn();
const endPartyEvening: jest.Mock = jest.fn();
const hasQueuedPartyEveningAction: jest.Mock = jest.fn();
const ensureAccount: jest.Mock = jest.fn();
const loadPartyEveningIdentity: jest.Mock = jest.fn();
const savePartyEveningIdentity: jest.Mock = jest.fn();
const clearPartyEveningIdentityForAccount: jest.Mock = jest.fn();
const clearPartyEveningIdentityForCode: jest.Mock = jest.fn();
const resolveBeerPhotoPartyAssociation: jest.Mock = jest.fn(async () => true);
const releaseOrphanedBeerPhotoPartyAssociations: jest.Mock = jest.fn(async () => true);
const resolveQueuedDrinkPartyAssociation: jest.Mock = jest.fn(async () => undefined);
const resolveQueuedVisitPartyAssociation: jest.Mock = jest.fn(async () => undefined);

jest.mock('@/data/partyClient', () => ({
  fetchCurrentPartyEvening: (...args: unknown[]) => fetchCurrentPartyEvening(...(args as [])),
  createPartyEvening: (...args: unknown[]) => createPartyEvening(...(args as [])),
  joinPartyEvening: (...args: unknown[]) => joinPartyEvening(...(args as [])),
  generateJoinCode: () => 'PIVOXY',
  isRetriablePartyError: (error: { code: string }) =>
    error.code === 'offline' ||
    error.code === 'network' ||
    error.code === 'account' ||
    /^http_(408|425|429|5\d\d)$/.test(error.code),
}));
jest.mock('@/data/partyEveningActionsQueue', () => ({
  enqueuePartyEveningAction: (action: string, code: string) =>
    action === 'leave' ? leavePartyEvening(code) : endPartyEvening(code),
  hasQueuedPartyEveningAction: (...args: unknown[]) =>
    hasQueuedPartyEveningAction(...(args as [])),
}));
let mockUuidTicket = 0;
jest.mock('@/data/account', () => ({
  ensureAccount: (...args: unknown[]) => ensureAccount(...(args as [])),
  generateUuidV4: () => `ticket-${(mockUuidTicket += 1)}`,
}));
jest.mock('@/data/partyEveningIdentityCache', () => ({
  partyEveningIdentityGeneration: () => 0,
  loadPartyEveningIdentity: (...args: unknown[]) =>
    loadPartyEveningIdentity(...(args as [])),
  savePartyEveningIdentity: (...args: unknown[]) =>
    savePartyEveningIdentity(...(args as [])),
  clearPartyEveningIdentityForAccount: (...args: unknown[]) =>
    clearPartyEveningIdentityForAccount(...(args as [])),
  clearPartyEveningIdentityForCode: (...args: unknown[]) =>
    clearPartyEveningIdentityForCode(...(args as [])),
}));
jest.mock('@/data/beerPhotosQueue', () => ({
  resolveBeerPhotoPartyAssociation: (...args: unknown[]) =>
    resolveBeerPhotoPartyAssociation(...args),
  releaseOrphanedBeerPhotoPartyAssociations: (...args: unknown[]) =>
    releaseOrphanedBeerPhotoPartyAssociations(...args),
}));
jest.mock('@/data/drinksQueue', () => ({
  resolveQueuedDrinkPartyAssociation: (...args: unknown[]) =>
    resolveQueuedDrinkPartyAssociation(...args),
}));
jest.mock('@/data/visitsQueue', () => ({
  resolveQueuedVisitPartyAssociation: (...args: unknown[]) =>
    resolveQueuedVisitPartyAssociation(...args),
}));

const EVENING = {
  id: 'e1',
  joinCode: 'PIVOXY',
  joinUrl: 'https://na-pivo.cz/party/PIVOXY',
  host: { id: 'h', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
  pubName: 'U Fleků',
  pubCity: 'Praha',
  active: true,
  startedAt: '2026-08-05T18:00:00Z',
  endedAt: null,
  isHost: true,
  members: [],
  events: [],
} as PartyEvening;

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidTicket = 0;
  ensureAccount.mockResolvedValue({ accountId: 'account-a' });
  loadPartyEveningIdentity.mockResolvedValue(null);
  savePartyEveningIdentity.mockImplementation(
    async (_accountId: string, evening: PartyEvening) => ({
      id: evening.id,
      joinCode: evening.joinCode,
      isHost: evening.isHost,
      confirmedAt: Date.now(),
    }),
  );
  clearPartyEveningIdentityForAccount.mockResolvedValue(true);
  clearPartyEveningIdentityForCode.mockResolvedValue(true);
  leavePartyEvening.mockResolvedValue({ accepted: true, completed: true });
  endPartyEvening.mockResolvedValue({ accepted: true, completed: true, evening: EVENING });
  hasQueuedPartyEveningAction.mockResolvedValue(false);
  usePartyEveningStore.setState({
    evening: null,
    confirmedIdentity: null,
    lastEvening: null,
    busy: false,
    loaded: false,
    error: null,
    pendingJoinCode: null,
  });
});

describe('partyEveningStore', () => {
  it('can restore the cold-launch identity without waiting for a Party API request', async () => {
    const restored = {
      id: EVENING.id,
      joinCode: EVENING.joinCode,
      isHost: EVENING.isHost,
      confirmedAt: Date.now(),
    };
    loadPartyEveningIdentity.mockResolvedValue(restored);

    await usePartyEveningStore.getState().restore();

    expect(usePartyEveningStore.getState().confirmedIdentity).toEqual(restored);
    expect(fetchCurrentPartyEvening).not.toHaveBeenCalled();
  });

  it('restores the last confirmed identity before an offline cold-launch refresh', async () => {
    const restored = {
      id: EVENING.id,
      joinCode: EVENING.joinCode,
      isHost: EVENING.isHost,
      confirmedAt: Date.now(),
    };
    loadPartyEveningIdentity.mockResolvedValue(restored);
    fetchCurrentPartyEvening.mockResolvedValue({
      ok: false,
      code: 'network',
      detail: 'Bez signálu.',
    });

    await usePartyEveningStore.getState().refresh();

    expect(usePartyEveningStore.getState().confirmedIdentity).toEqual(restored);
    expect(usePartyEveningStore.getState().loaded).toBe(true);
    expect(loadPartyEveningIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      fetchCurrentPartyEvening.mock.invocationCallOrder[0],
    );
  });

  it('holds no evening when the server says there is none', async () => {
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: null });
    await usePartyEveningStore.getState().refresh();

    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
    expect(usePartyEveningStore.getState().loaded).toBe(true);
    expect(clearPartyEveningIdentityForAccount).toHaveBeenCalledWith('account-a');
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledTimes(1);
    const canRelease = releaseOrphanedBeerPhotoPartyAssociations.mock.calls[0][0];
    expect(canRelease()).toBe(true);
  });

  it('waits for durable identity clear across restart before releasing confirmed-none photos', async () => {
    const staleIdentity = {
      id: EVENING.id,
      joinCode: EVENING.joinCode,
      isHost: EVENING.isHost,
      confirmedAt: Date.now(),
    };
    loadPartyEveningIdentity.mockResolvedValue(staleIdentity);
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: null });
    clearPartyEveningIdentityForAccount
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await usePartyEveningStore.getState().refresh();

    expect(resolveBeerPhotoPartyAssociation).toHaveBeenCalledWith(
      'PIVOXY',
      'PIVOXY',
      { authoritative: false },
    );
    expect(releaseOrphanedBeerPhotoPartyAssociations).not.toHaveBeenCalled();

    // Process restart: memory is empty but the failed removal left the same
    // cache identity on disk. The next successful server refresh clears it and
    // is the only attempt allowed to release the durable photo candidate.
    clearPartyEveningState();
    resolveBeerPhotoPartyAssociation.mockClear();

    await usePartyEveningStore.getState().refresh();

    expect(loadPartyEveningIdentity).toHaveBeenCalledTimes(2);
    expect(fetchCurrentPartyEvening).toHaveBeenCalledTimes(2);
    expect(clearPartyEveningIdentityForAccount).toHaveBeenCalledTimes(2);
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledTimes(1);
    expect(clearPartyEveningIdentityForAccount.mock.invocationCallOrder[1]).toBeLessThan(
      releaseOrphanedBeerPhotoPartyAssociations.mock.invocationCallOrder[0],
    );
  });

  it('protects reservations for the table confirmed by the server', async () => {
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: EVENING });

    await usePartyEveningStore.getState().refresh();

    expect(resolveBeerPhotoPartyAssociation).toHaveBeenCalledWith('PIVOXY', 'PIVOXY');
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledWith(
      expect.any(Function),
      'PIVOXY',
    );
  });

  it('releases only reservations from a different failed table after an active refresh', async () => {
    const otherEvening = { ...EVENING, id: 'e2', joinCode: 'STULIK' };
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: otherEvening });

    await usePartyEveningStore.getState().refresh();

    expect(resolveBeerPhotoPartyAssociation).toHaveBeenCalledWith('STULIK', 'STULIK');
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledTimes(1);
    const [canRelease, protectedCode] =
      releaseOrphanedBeerPhotoPartyAssociations.mock.calls[0];
    expect(protectedCode).toBe('STULIK');
    expect(canRelease()).toBe(true);
  });

  it('does not close the table because the cellar has no signal', async () => {
    usePartyEveningStore.setState({ evening: EVENING });
    fetchCurrentPartyEvening.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await usePartyEveningStore.getState().refresh();

    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
  });

  it('does not let an older confirmed-none refresh erase a table started meanwhile', async () => {
    let resolveRefresh!: (value: { ok: true; evening: null }) => void;
    fetchCurrentPartyEvening.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    createPartyEvening.mockResolvedValue({ ok: true, evening: EVENING });

    const refreshing = usePartyEveningStore.getState().refresh();
    for (let index = 0; index < 20 && fetchCurrentPartyEvening.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(fetchCurrentPartyEvening).toHaveBeenCalledTimes(1);
    await usePartyEveningStore.getState().start('U Fleků');
    resolveRefresh({ ok: true, evening: null });
    await refreshing;

    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
    expect(usePartyEveningStore.getState().confirmedIdentity?.joinCode).toBe('PIVOXY');
  });

  it('does not let an older confirmed-none refresh erase a newer active refresh', async () => {
    let resolveOlder!: (value: { ok: true; evening: null }) => void;
    let resolveNewer!: (value: { ok: true; evening: PartyEvening }) => void;
    fetchCurrentPartyEvening
      .mockReturnValueOnce(new Promise((resolve) => { resolveOlder = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNewer = resolve; }));

    const older = usePartyEveningStore.getState().refresh();
    for (let index = 0; index < 20 && fetchCurrentPartyEvening.mock.calls.length < 1; index += 1) {
      await Promise.resolve();
    }
    const newer = usePartyEveningStore.getState().refresh();
    for (let index = 0; index < 20 && fetchCurrentPartyEvening.mock.calls.length < 2; index += 1) {
      await Promise.resolve();
    }

    resolveNewer({ ok: true, evening: EVENING });
    await newer;
    resolveOlder({ ok: true, evening: null });
    await older;

    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
    expect(usePartyEveningStore.getState().confirmedIdentity?.joinCode).toBe('PIVOXY');
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledTimes(1);
    expect(releaseOrphanedBeerPhotoPartyAssociations).toHaveBeenCalledWith(
      expect.any(Function),
      'PIVOXY',
    );
  });

  it('does not resurrect a table whose offline finish is still queued', async () => {
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: EVENING });
    hasQueuedPartyEveningAction.mockResolvedValue(true);

    await usePartyEveningStore.getState().refresh();

    expect(hasQueuedPartyEveningAction).toHaveBeenCalledWith(EVENING.joinCode);
    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
    expect(usePartyEveningStore.getState().loaded).toBe(true);
  });

  it('does not let an older refresh resurrect a table after confirmed leave', async () => {
    let resolveRefresh!: (value: { ok: true; evening: PartyEvening }) => void;
    fetchCurrentPartyEvening.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    usePartyEveningStore.setState({ evening: EVENING });

    const refreshing = usePartyEveningStore.getState().refresh();
    for (let index = 0; index < 20 && fetchCurrentPartyEvening.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    expect(fetchCurrentPartyEvening).toHaveBeenCalledTimes(1);
    await usePartyEveningStore.getState().leave();
    resolveRefresh({ ok: true, evening: EVENING });
    await refreshing;

    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
  });

  it('starts an evening with a code you can read out loud', async () => {
    createPartyEvening.mockResolvedValue({ ok: true, evening: EVENING });
    await usePartyEveningStore.getState().start('U Fleků', 'Praha');

    expect(createPartyEvening).toHaveBeenCalledWith(
      expect.objectContaining({ joinCode: 'PIVOXY', pubName: 'U Fleků', pubCity: 'Praha' }),
    );
    expect(usePartyEveningStore.getState().evening?.joinCode).toBe('PIVOXY');
    expect(savePartyEveningIdentity).toHaveBeenCalledWith(
      'account-a',
      EVENING,
      0,
    );
    expect(resolveQueuedDrinkPartyAssociation).toHaveBeenCalledWith('PIVOXY', 'PIVOXY');
  });

  it('clears an older recap as soon as a new start begins', async () => {
    let resolve!: (value: { ok: true; evening: PartyEvening }) => void;
    createPartyEvening.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    usePartyEveningStore.setState({ lastEvening: { ...EVENING, active: false } });

    const pending = usePartyEveningStore.getState().start('U Fleků');

    expect(usePartyEveningStore.getState().lastEvening).toBeNull();
    expect(usePartyEveningStore.getState().pendingJoinCode).toBe('PIVOXY');
    resolve({ ok: true, evening: EVENING });
    await pending;
  });

  it('keeps an in-flight create code private until the table is confirmed', async () => {
    let resolve!: (value: { ok: true; evening: PartyEvening }) => void;
    createPartyEvening.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const pending = usePartyEveningStore.getState().start('U Fleků');

    expect(selectPartyJoinCode(usePartyEveningStore.getState())).toBe('PIVOXY');
    expect(selectConfirmedPartyJoinCode(usePartyEveningStore.getState())).toBeNull();

    resolve({ ok: true, evening: EVENING });
    await pending;

    expect(selectConfirmedPartyJoinCode(usePartyEveningStore.getState())).toBe('PIVOXY');
  });

  it('ignores a second tap while the first is still going', async () => {
    usePartyEveningStore.setState({ busy: true });
    await usePartyEveningStore.getState().start('U Fleků');

    expect(createPartyEvening).not.toHaveBeenCalled();
  });

  it('keeps the failure in Czech, ready to show', async () => {
    joinPartyEvening.mockResolvedValue({
      ok: false,
      code: 'party_not_found',
      detail: 'Takový večer tu není.',
    });
    await usePartyEveningStore.getState().join('ZZZZZZ');

    expect(usePartyEveningStore.getState().error).toBe('Takový večer tu není.');
    expect(usePartyEveningStore.getState().busy).toBe(false);
  });

  it('lets go of the table when you leave it', async () => {
    usePartyEveningStore.setState({ evening: EVENING });
    leavePartyEvening.mockResolvedValue({ accepted: true, completed: true });
    const left = await usePartyEveningStore.getState().leave();

    expect(left).toBe(true);
    expect(usePartyEveningStore.getState().evening).toBeNull();
  });

  it('holds on to the table when a permanent leave failure cannot be queued', async () => {
    usePartyEveningStore.setState({ evening: EVENING });
    leavePartyEvening.mockResolvedValue({
      accepted: false,
      error: { ok: false, code: 'http_403', detail: 'Teď ne.' },
    });
    const left = await usePartyEveningStore.getState().leave();

    expect(left).toBe(false);
    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
  });

  it('finishes locally when an offline leave is safely queued', async () => {
    usePartyEveningStore.setState({
      evening: EVENING,
      confirmedIdentity: {
        id: EVENING.id,
        joinCode: EVENING.joinCode,
        isHost: false,
        confirmedAt: Date.now(),
      },
    });
    leavePartyEvening.mockResolvedValue({ accepted: true, completed: false });

    const left = await usePartyEveningStore.getState().leave();

    expect(left).toBe(true);
    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
    expect(usePartyEveningStore.getState().lastEvening).toMatchObject({ active: false });
    expect(clearPartyEveningIdentityForCode).toHaveBeenCalledWith('PIVOXY');
  });

  it('can leave a restored table after a kill without the full evening payload', async () => {
    usePartyEveningStore.setState({
      confirmedIdentity: {
        id: EVENING.id,
        joinCode: EVENING.joinCode,
        isHost: false,
        confirmedAt: Date.now(),
      },
    });
    leavePartyEvening.mockResolvedValue({ accepted: true, completed: false });

    await expect(usePartyEveningStore.getState().leave()).resolves.toBe(true);

    expect(leavePartyEvening).toHaveBeenCalledWith('PIVOXY');
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
  });

  it('keeps the closed evening available to the recap', async () => {
    const ended = { ...EVENING, active: false, endedAt: '2026-08-05T22:00:00Z' };
    usePartyEveningStore.setState({ evening: EVENING });
    endPartyEvening.mockResolvedValue({ accepted: true, completed: true, evening: ended });

    const closed = await usePartyEveningStore.getState().end();

    expect(closed).toBe(true);
    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().lastEvening).toEqual(ended);
  });

  it('recovers the created table when the first start lost its response', async () => {
    const attempts: { clientId: string; joinCode: string }[] = [];
    createPartyEvening.mockImplementation(async (input: { clientId: string; joinCode: string }) => {
      attempts.push(input);
      if (attempts.length === 1) {
        // The server committed this create, but the response was lost.
        return { ok: false, code: 'network', detail: 'Síť se netváří.' };
      }
      return input.clientId === attempts[0].clientId && input.joinCode === attempts[0].joinCode
        ? { ok: true, evening: EVENING }
        : { ok: false, code: 'active_party_membership_exists', detail: 'Už máš otevřený stůl.' };
    });

    const inFlight = usePartyEveningStore.getState().start('U Fleků');
    expect(usePartyEveningStore.getState().start('U Fleků')).toBe(inFlight);

    expect(await inFlight).toBeNull();
    expect(usePartyEveningStore.getState().error).toBeTruthy();
    expect(resolveBeerPhotoPartyAssociation).not.toHaveBeenCalled();
    expect(resolveQueuedDrinkPartyAssociation).not.toHaveBeenCalled();

    const second = await usePartyEveningStore.getState().start('U Fleků');

    expect(createPartyEvening).toHaveBeenCalledTimes(2);
    expect(second).toEqual(EVENING);
    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
    expect(usePartyEveningStore.getState().error).toBeNull();
  });

  it('keeps reserved photos when a create response is missing its table', async () => {
    const attempts: { clientId: string; joinCode: string }[] = [];
    createPartyEvening.mockImplementation(
      async (input: { clientId: string; joinCode: string }) => {
        attempts.push(input);
        return attempts.length === 1
          ? { ok: true, evening: null }
          : { ok: true, evening: EVENING };
      },
    );

    await usePartyEveningStore.getState().start('U Fleků');

    expect(resolveBeerPhotoPartyAssociation).not.toHaveBeenCalled();
    expect(resolveQueuedDrinkPartyAssociation).not.toHaveBeenCalled();

    await expect(usePartyEveningStore.getState().start('U Fleků')).resolves.toEqual(EVENING);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  it('releases reserved photos after a definitive create rejection', async () => {
    createPartyEvening.mockResolvedValue({
      ok: false,
      code: 'join_code_taken',
      detail: 'Tenhle kód už někdo používá.',
    });

    await usePartyEveningStore.getState().start('U Fleků');

    expect(resolveBeerPhotoPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
    expect(resolveQueuedDrinkPartyAssociation).toHaveBeenCalledWith('PIVOXY', null);
  });

  it('does not let a stale create land after an account switch', async () => {
    let resolve!: (value: { ok: true; evening: PartyEvening }) => void;
    createPartyEvening.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const pending = usePartyEveningStore.getState().start('U Fleků');
    clearPartyEveningState();
    resolve({ ok: true, evening: EVENING });
    await pending;

    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().confirmedIdentity).toBeNull();
  });
});
