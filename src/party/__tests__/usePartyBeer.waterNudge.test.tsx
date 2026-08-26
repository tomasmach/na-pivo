/**
 * "Připomenout vodu" on the party write path (src/party/usePartyBeer.ts).
 *
 * The counter's rule, unchanged: every fourth BEER of the running evening, only
 * when the setting is on, only for a beer you just had. No sobriety claim, no
 * notification — one local toast.
 */

import React from 'react';

import { usePartyBeer } from '@/party/usePartyBeer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSettings = { waterNudgeEnabled: true };
const mockSession = { clientId: 'session-1', drinks: [] as { drinkType: string }[] };
const mockShow = jest.fn();

jest.mock('@/party/logBeer', () => ({
  logPartyBeer: jest.fn(() => 'drink-id'),
  unlogPartyBeer: jest.fn(),
  renamePartyBeer: jest.fn(),
  updatePartyDrink: jest.fn(),
}));
jest.mock('@/mocks/livePartyStore', () => ({
  useLivePartyStore: (selector: (state: unknown) => unknown) =>
    selector({ pubName: 'U Tygra', pubKey: 'u2fkbfvn', pubVisits: [] }),
}));
jest.mock('@/stores/partyEveningStore', () => ({
  selectPartyJoinCode: () => null,
  usePartyEveningStore: (selector: (state: unknown) => unknown) =>
    selector({ evening: null, pendingJoinCode: null }),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
jest.mock('@/stores/tallyStore', () => ({
  useTallyStore: Object.assign(
    (selector: (state: unknown) => unknown) => selector({ current: mockSession }),
    { getState: () => ({ current: mockSession }) },
  ),
  sessionCount: (session: { drinks: { drinkType: string }[] } | null) =>
    session?.drinks.filter((drink) => drink.drinkType === 'beer').length ?? 0,
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ show: mockShow }) },
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

function mountAdd(): (name: string, options?: Record<string, unknown>) => void {
  let add!: (name: string, options?: Record<string, unknown>) => void;
  function Probe() {
    add = usePartyBeer().add;
    return null;
  }
  act(() => {
    TestRenderer.create(<Probe />);
  });
  return (name, options) => {
    // The store is the counter's, so the test moves it the way the real write
    // does: the drink lands first, the nudge reads the session after.
    mockSession.drinks.push({
      drinkType: (options?.drinkType as string | undefined) ?? 'beer',
    });
    add(name, options);
  };
}

beforeEach(() => {
  mockShow.mockClear();
  mockSettings.waterNudgeEnabled = true;
  mockSession.clientId = `session-${Math.random()}`;
  mockSession.drinks = [];
});

describe('usePartyBeer water nudge', () => {
  it('speaks up on the fourth beer and stays quiet on the others', () => {
    const add = mountAdd();
    add('Plzeň');
    add('Plzeň');
    add('Plzeň');
    expect(mockShow).not.toHaveBeenCalled();

    add('Plzeň');
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0][0]).toContain('vod');

    add('Plzeň');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('says nothing while the setting is off', () => {
    mockSettings.waterNudgeEnabled = false;
    const add = mountAdd();
    for (let i = 0; i < 8; i += 1) add('Plzeň');
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('counts beers only, and never a backdated one', () => {
    const add = mountAdd();
    add('Plzeň');
    add('Kofola', { drinkType: 'soft_drink' });
    add('Slivovice', { drinkType: 'shot' });
    add('Plzeň');
    add('Plzeň');
    expect(mockShow).not.toHaveBeenCalled();

    add('Plzeň', { backdated: true });
    expect(mockShow).not.toHaveBeenCalled();
  });
});
