/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStartedAt = new Date(2026, 7, 5, 18, 0).toISOString();
const mockNight = {
  id: 'offline-night',
  code: null,
  startedAt: mockStartedAt,
  endedAt: null,
  people: [{ id: 'account-a', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
  stops: [],
  drinks: [],
  games: [],
  photos: [],
};

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Switch: 'Switch',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  CameraIcon: () => null,
  XIcon: () => null,
}));

jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    KeyboardAwareScrollView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('KeyboardAwareScrollView', null, children),
  };
});

jest.mock('@/data/nightsClient', () => ({
  isRetriableNightError: () => false,
  publishNight: jest.fn(),
}));
jest.mock('@/data/nightsQueue', () => ({ enqueueNightOp: jest.fn() }));

jest.mock('@/photos/BeerPhotoCaptureFlow', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    BeerPhotoCaptureFlow: (props: Record<string, unknown>) =>
      ReactModule.createElement('BeerPhotoCaptureFlow', props),
  };
});

jest.mock('@/party/useNightRecord', () => ({
  rememberNightRecord: jest.fn(),
  useNightRecord: () => mockNight,
}));

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: unknown) => unknown) =>
    selector({ session: { accountId: 'account-a' } }),
}));

jest.mock('@/stores/beerPhotosStore', () => ({
  useBeerPhotosStore: (selector: (state: unknown) => unknown) => selector({ photos: [] }),
}));

jest.mock('@/stores/partyEveningStore', () => ({
  usePartyEveningStore: (selector: (state: unknown) => unknown) =>
    selector({
      evening: null,
      confirmedIdentity: null,
      end: jest.fn(),
      leave: jest.fn(),
    }),
}));

jest.mock('@/stores/partyGamesStore', () => ({
  usePartyGamesStore: (selector: (state: unknown) => unknown) => selector({ games: [] }),
}));

jest.mock('@/stores/tallyStore', () => {
  const actual = jest.requireActual('@/stores/tallyStore');
  return {
    ...actual,
    useTallyStore: (selector: (state: unknown) => unknown) =>
      selector({ archiveCurrent: jest.fn(), history: [] }),
  };
});

jest.mock('@/mocks/livePartyStore', () => ({
  formatElapsed: (minutes: number) => `${minutes} min`,
  useLivePartyStore: (selector: (state: unknown) => unknown) =>
    selector({ startedAt: Date.parse(mockNight.startedAt), end: jest.fn() }),
  useNightClock: () => 0,
}));

jest.mock('@/mocks/StatGrid', () => ({ StatGrid: () => null }));

// Mocks must be registered before the screen module is evaluated.
// eslint-disable-next-line import/first
import FinishNightScreen from '@/party/FinishNightScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

describe('FinishNightScreen offline photo context', () => {
  it('passes the drinking day even when the Party has no server code', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    const capture = renderer!.root.findByType('BeerPhotoCaptureFlow');
    expect(capture.props).toMatchObject({
      partyCode: undefined,
      partyDrinkingDay: '2026-08-05',
    });
  });
});
