/* eslint-disable import/first -- Jest mocks must be installed before imports. */

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'tok', accountId: 'me' })),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://example.test${path}`,
}));
jest.mock('../apiFetch', () => ({
  ...jest.requireActual('../apiFetch'),
  classifyQueueHttpFailure: jest.fn(async () => 'retry'),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

import {
  parsePartyGame,
  parsePartyGameEvent,
  partyGameSeedForTable,
  partyGameSeedFromId,
  startPartyGame,
} from '../partyGamesClient';
import { ensureAccount } from '../account';

const WIRE_GAME = {
  id: 'game-1',
  catalog_key: 'quiz',
  name: 'Pub kvíz',
  scoring: 'points',
  started_by: { id: 'me', nickname: 'ja', display_name: 'Já', avatar_url: null },
  roster: [
    { id: 'guest', nickname: 'host', display_name: 'Host', avatar_url: null },
    { id: 'me', nickname: 'ja', display_name: 'Já', avatar_url: null },
  ],
  started_at: '2026-08-07T00:00:00.000Z',
  ended_at: null,
  seed: 731,
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('sends the selected roster and parses the server-owned order', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 201,
    text: async () => JSON.stringify(WIRE_GAME),
  });

  const result = await startPartyGame('PIVOXY', {
    clientId: 'start-1',
    catalogKey: 'quiz',
    name: 'Pub kvíz',
    scoring: 'points',
    rosterIds: ['guest', 'me'],
  });

  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
    client_id: 'start-1',
    roster_ids: ['guest', 'me'],
  });
  expect(result.ok && result.game.roster.map((person) => person.id)).toEqual(['guest', 'me']);
});

it('keeps working against a released backend that has no roster field', () => {
  const { roster: _roster, ...legacy } = WIRE_GAME;

  expect(parsePartyGame(legacy).roster).toEqual([]);
});

it('parses additive action correlation and keeps an offline game seed stable', () => {
  const clientId = '00112233-4455-6677-8899-aabbccddeeff';
  const parsed = parsePartyGameEvent({
    cursor: 7,
    client_id: clientId,
    game_id: 'game-1',
    kind: 'action',
    account: WIRE_GAME.started_by,
    payload: { type: 'prompt_next' },
    at: WIRE_GAME.started_at,
  });

  expect(parsed).toMatchObject({ clientId, kind: 'action', payload: { type: 'prompt_next' } });
  expect(partyGameSeedFromId(`local:${clientId}`)).toBe(1_877_995_502);
  expect(parsePartyGame({ ...WIRE_GAME, seed: undefined, id: clientId }).seed).toBe(
    partyGameSeedFromId(clientId),
  );
  expect(partyGameSeedForTable('pivoxy', 'never')).toBe(
    partyGameSeedForTable('PIVOXY', 'never'),
  );
});

it('does not send an owner-scoped write with a replacement account bearer', async () => {
  jest.mocked(ensureAccount).mockResolvedValueOnce({
    deviceId: 'device-b',
    accountId: 'account-b',
    token: 'token-b',
  });

  const result = await startPartyGame(
    'PIVOXY',
    {
      clientId: 'start-a',
      catalogKey: 'quiz',
      name: 'Pub kvíz',
    },
    undefined,
    'account-a',
  );

  expect(result).toMatchObject({ ok: false, code: 'account' });
  expect(mockFetch).not.toHaveBeenCalled();
});
