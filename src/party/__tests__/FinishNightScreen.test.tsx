

import React from 'react';
import type { NightRecord } from '@/party/nightRecord';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStartedAt = new Date(2026, 7, 5, 18, 0).toISOString();
const mockNight: NightRecord = {
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
const mockRouter = {
  back: jest.fn(),
  dismiss: jest.fn(),
  navigate: jest.fn(),
};
const mockPublishNight = jest.fn();
const mockRememberNightRecord = jest.fn();
const mockBackHandlerAdd = jest.fn((_event: string, _handler: () => boolean) => ({
  remove: jest.fn(),
}));

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
    BackHandler: { addEventListener: mockBackHandlerAdd },
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
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
  publishNight: (...args: unknown[]) => mockPublishNight(...args),
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
  rememberNightRecord: (...args: unknown[]) => mockRememberNightRecord(...args),
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

jest.mock('@/mocks/StatGrid', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    StatGrid: (props: Record<string, unknown>) => ReactModule.createElement('StatGrid', props),
  };
});

// Mocks must be registered before the screen module is evaluated.
// eslint-disable-next-line import/first
import FinishNightScreen from '@/party/FinishNightScreen';

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

describe('FinishNightScreen offline photo context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNight.people = [{ id: 'account-a', name: 'Ty', avatarUrl: null, tint: '#E8A317' }];
    mockNight.drinks = [
      {
        id: 'drink-a',
        at: mockStartedAt,
        by: 'account-a',
        beerName: 'Pilsner Urquell',
        drinkType: 'beer',
        stopId: null,
      },
    ];
    mockPublishNight.mockResolvedValue({ ok: false, detail: 'Zkus to znovu.' });
    mockRememberNightRecord.mockResolvedValue(undefined);
  });

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

  it('cancels back to the still-running live evening', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    const close = renderer!.root.findByProps({ accessibilityLabel: 'Zpátky do večera' });
    act(() => close.props.onPress());

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(mockRouter.dismiss).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('locks close and Android Back while publishing is in flight', async () => {
    let resolvePublish!: (value: { ok: false; detail: string }) => void;
    mockPublishNight.mockReturnValue(
      new Promise((resolve) => {
        resolvePublish = resolve;
      }),
    );
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    const publish = renderer!.root.findByProps({ accessibilityLabel: 'Ukončit a zveřejnit večer' });
    act(() => {
      publish.props.onPress();
      publish.props.onPress();
    });

    expect(mockPublishNight).toHaveBeenCalledTimes(1);
    const close = renderer!.root.findByProps({ accessibilityLabel: 'Zpátky do večera' });
    expect(close.props.disabled).toBe(true);
    expect(close.props.accessibilityState).toEqual({ disabled: true });
    expect(mockBackHandlerAdd).toHaveBeenCalledTimes(1);
    expect(mockBackHandlerAdd.mock.calls[0][1]()).toBe(true);

    await act(async () => {
      resolvePublish({ ok: false, detail: 'Zkus to znovu.' });
      await Promise.resolve();
    });
    expect(mockBackHandlerAdd.mock.results[0].value.remove).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByProps({ accessibilityLabel: 'Zpátky do večera' }).props.disabled)
      .toBe(false);
  });

  it('unlocks publishing after the network client rejects', async () => {
    mockPublishNight.mockRejectedValueOnce(new Error('network exploded'));
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    const publish = renderer!.root.findByProps({ accessibilityLabel: 'Ukončit a zveřejnit večer' });
    await act(async () => {
      publish.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderer!.root.findByProps({ accessibilityLabel: 'Zpátky do večera' }).props.disabled)
      .toBe(false);

    mockPublishNight.mockResolvedValueOnce({ ok: false, detail: 'Zkus to znovu.' });
    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Ukončit a zveřejnit večer' }).props.onPress();
      await Promise.resolve();
    });
    expect(mockPublishNight).toHaveBeenCalledTimes(2);
  });

  it('offers only the private finish when nothing of mine is written down', () => {
    // A shared table where only the other person drank: the server rejects a
    // night with no drinks of its own, so publishing must not be on offer.
    mockNight.drinks = [
      {
        id: 'drink-b',
        at: mockStartedAt,
        by: 'friend-a',
        beerName: 'Kozel',
        drinkType: 'beer',
        stopId: null,
      },
    ];
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    expect(
      renderer!.root.findAllByProps({ accessibilityLabel: 'Ukončit a zveřejnit večer' }),
    ).toHaveLength(0);
    expect(
      renderer!.root.findAllByProps({ accessibilityLabel: 'Ukončit večer bez zveřejnění' }).length,
    ).toBeGreaterThan(0);
    expect(
      JSON.stringify(renderer!.toJSON()),
    ).toContain('Bez vlastního piva není co zveřejnit.');
  });

  it('counts only people who are still at the table', () => {
    mockNight.people = [
      { id: 'account-a', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
      { id: 'friend-a', name: 'Jana', avatarUrl: null, tint: '#8A5A18' },
      { id: 'friend-b', name: 'Petr', avatarUrl: null, tint: '#5E421C', active: false },
    ];
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<FinishNightScreen />);
    });

    expect(renderer!.root.findByType('StatGrid').props.stats).toContainEqual({
      label: 'U stolu',
      value: '2',
    });
  });
});
