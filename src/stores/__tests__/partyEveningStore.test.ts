/**
 * Tests for the shared-evening store (src/stores/partyEveningStore.ts).
 *
 * The behaviour worth guarding is what happens when the network is bad, because
 * that is the normal case in a pub: a failed refresh must not look like "you
 * left the table", and a second tap on a slow button must not start a second
 * evening.
 */

const fetchCurrentPartyEvening: jest.Mock = jest.fn();
const createPartyEvening: jest.Mock = jest.fn();
const joinPartyEvening: jest.Mock = jest.fn();
const leavePartyEvening: jest.Mock = jest.fn();
const endPartyEvening: jest.Mock = jest.fn();

jest.mock('@/data/partyClient', () => ({
  fetchCurrentPartyEvening: (...args: unknown[]) => fetchCurrentPartyEvening(...(args as [])),
  createPartyEvening: (...args: unknown[]) => createPartyEvening(...(args as [])),
  joinPartyEvening: (...args: unknown[]) => joinPartyEvening(...(args as [])),
  leavePartyEvening: (...args: unknown[]) => leavePartyEvening(...(args as [])),
  endPartyEvening: (...args: unknown[]) => endPartyEvening(...(args as [])),
  generateJoinCode: () => 'PIVOXY',
}));
jest.mock('@/data/account', () => ({ generateUuidV4: () => 'uuid-1' }));

import { usePartyEveningStore } from '@/stores/partyEveningStore';
import type { PartyEvening } from '@/data/partyClient';

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
  usePartyEveningStore.setState({ evening: null, busy: false, loaded: false, error: null });
});

describe('partyEveningStore', () => {
  it('holds no evening when the server says there is none', async () => {
    fetchCurrentPartyEvening.mockResolvedValue({ ok: true, evening: null });
    await usePartyEveningStore.getState().refresh();

    expect(usePartyEveningStore.getState().evening).toBeNull();
    expect(usePartyEveningStore.getState().loaded).toBe(true);
  });

  it('does not close the table because the cellar has no signal', async () => {
    usePartyEveningStore.setState({ evening: EVENING });
    fetchCurrentPartyEvening.mockResolvedValue({ ok: false, code: 'network', detail: '' });
    await usePartyEveningStore.getState().refresh();

    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
  });

  it('starts an evening with a code you can read out loud', async () => {
    createPartyEvening.mockResolvedValue({ ok: true, evening: EVENING });
    await usePartyEveningStore.getState().start('U Fleků', 'Praha');

    expect(createPartyEvening).toHaveBeenCalledWith(
      expect.objectContaining({ joinCode: 'PIVOXY', pubName: 'U Fleků', pubCity: 'Praha' }),
    );
    expect(usePartyEveningStore.getState().evening?.joinCode).toBe('PIVOXY');
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
    leavePartyEvening.mockResolvedValue({ ok: true });
    const left = await usePartyEveningStore.getState().leave();

    expect(left).toBe(true);
    expect(usePartyEveningStore.getState().evening).toBeNull();
  });

  it('holds on to the table when leaving failed', async () => {
    usePartyEveningStore.setState({ evening: EVENING });
    leavePartyEvening.mockResolvedValue({ ok: false, code: 'network', detail: 'Síť.' });
    const left = await usePartyEveningStore.getState().leave();

    expect(left).toBe(false);
    expect(usePartyEveningStore.getState().evening).toEqual(EVENING);
  });
});
