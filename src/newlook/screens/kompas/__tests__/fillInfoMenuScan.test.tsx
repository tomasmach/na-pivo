import React from 'react';
import { t } from '@/i18n';
import type { CommunityBeer } from '@/data/communityHours';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
// The lean mock lacks the layout-animation builders the new look's motion presets chain at import.
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});

const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = { push: jest.fn(), back: jest.fn(), dismissTo: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));

jest.mock('@/data/menuPhotoPicker', () => ({ pickAndPrepareMenuPhoto: jest.fn() }));
jest.mock('@/data/menuScanClient', () => ({ scanMenuPhoto: jest.fn() }));
jest.mock('@/data/communityQueue', () => ({ enqueuePubCommunity: jest.fn(async () => null) }));
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  useCountPlace: () => null,
  useBackfillPick: () => null,
  useNvPlaceStore: Object.assign(() => null, { getState: () => ({}) }),
}));
jest.mock('@/newlook/screens/stamgast/pubMenu', () => ({
  usePubMenu: () => ({ beers: [], historicalBeers: [], fresh: false, loading: false }),
  addBeersToMenu: jest.fn(),
}));

const PUB = { id: 'osm:node:1', name: 'U Zlatého tygra', lat: 50.087, lng: 14.421, city: 'Praha' };
const TAPS: CommunityBeer[] = [{ name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 69 }];
jest.mock('@/newlook/screens/piva/model', () => ({ myRating: () => null }));
jest.mock('@/newlook/screens/piva/useMyRatings', () => ({ useMyRatings: () => new Map() }));
jest.mock('@/newlook/screens/kompas/usePubPage', () => ({
  useParamPub: () => ({ key: 'u2fkbnhu', pub: PUB }),
  usePubDetails: () => ({ pub: { ...PUB, beers: TAPS }, hoursLoaded: true, taps: TAPS, identityKey: 'pub:osm:node:1' }),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { pickAndPrepareMenuPhoto } = require('@/data/menuPhotoPicker');
const { scanMenuPhoto } = require('@/data/menuScanClient');
const { enqueuePubCommunity } = require('@/data/communityQueue');
const { nvBack } = require('@/newlook/navigation');
const { dialog } = require('@/newlook/ui/store');
const { useKompasState } = require('@/newlook/screens/kompas/state');
const { useCommunityStore } = require('@/stores/communityStore');
const { VyfotScreen } = require('@/newlook/screens/stamgast/ZapisSheets');
const { DoplnitInfoScreen } = require('@/newlook/screens/kompas/FillInfoScreens');

const copy = t.nv.stamgast;

function texts(renderer: any): string[] {
  return renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => [n.props.children].flat().join(''));
}

function pressText(renderer: any, label: string) {
  const node = renderer.root.find((n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === label).length > 0);
  return node.props.onPress();
}

async function renderVyfot(): Promise<any> {
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(VyfotScreen));
  });
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = { mode: 'listek', source: 'library' };
  (pickAndPrepareMenuPhoto as jest.Mock).mockResolvedValue({ status: 'picked', uri: 'file:///menu.jpg' });
});

describe('menu photo for "Doplnit info"', () => {
  it('offers only beers the pub does not list yet and hands the checked ones back', async () => {
    const add = jest.fn();
    useKompasState.getState().set({ menuScan: { known: TAPS, add } });
    (scanMenuPhoto as jest.Mock).mockResolvedValue({
      status: 'ok',
      beers: [],
      drinks: [
        { name: 'Pilsner Urquell', priceCzk: 69, volumeMl: 500, drinkType: 'beer' },
        { name: 'Kozel 11', priceCzk: 52, volumeMl: 500, drinkType: 'beer' },
        { name: 'Bernard 12', priceCzk: 58, volumeMl: 500, drinkType: 'beer' },
        { name: 'Kofola', priceCzk: 45, volumeMl: 500, drinkType: 'soft' },
      ],
    });

    const renderer = await renderVyfot();

    expect(pickAndPrepareMenuPhoto).toHaveBeenCalledWith('library');
    const shown = texts(renderer);
    expect(shown).toContain('Kozel 11');
    expect(shown).toContain('Bernard 12');
    expect(shown).not.toContain('Pilsner Urquell');
    expect(shown).not.toContain('Kofola');

    act(() => pressText(renderer, 'Bernard 12'));
    act(() => pressText(renderer, copy.addToBoard(1)));

    expect(add).toHaveBeenCalledWith([{ name: 'Kozel 11', priceCzk: 52, volumeMl: 500 }]);
    expect(useKompasState.getState().menuScan).toBeNull();
    expect(nvBack).toHaveBeenCalled();
  });

  it.each([
    ['error', copy.menuUnread],
    ['daily-cap', t.contribute.scanMenu.dailyCapToast],
    ['unavailable', t.contribute.scanMenu.unavailableToast],
  ])('explains a %s scan and keeps typing by hand', async (status, message) => {
    useKompasState.getState().set({ menuScan: { known: [], add: jest.fn() } });
    (scanMenuPhoto as jest.Mock).mockResolvedValue({ status });

    const renderer = await renderVyfot();

    expect(texts(renderer)).toContain(message);
    expect(texts(renderer)).toContain(copy.pickAnother);
    act(() => pressText(renderer, copy.writeByHand));
    expect(nvBack).toHaveBeenCalled();
  });

  it('saves confirmed beers through the community queue like a manual edit', async () => {
    mockParams.current = { tab: 'piva' };
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(DoplnitInfoScreen));
    });

    act(() => pressText(renderer, t.nv.kompas.snapMenu));
    const libraryAction = (dialog as jest.Mock).mock.calls[0][0].actions.find((a: { label: string }) => a.label === t.contribute.scanMenu.library);
    act(() => libraryAction.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/nv/vyfot', params: { mode: 'listek', source: 'library' } });

    const handoff = useKompasState.getState().menuScan;
    expect(handoff.known).toEqual(TAPS);
    act(() => handoff.add([{ name: 'Kozel 11', priceCzk: 52, volumeMl: 500 }]));

    const expected = [...TAPS, { name: 'Kozel 11', priceCzk: 52, volumeMl: 500 }];
    expect(enqueuePubCommunity).toHaveBeenCalledTimes(1);
    expect((enqueuePubCommunity as jest.Mock).mock.calls[0][0]).toMatchObject({ name: PUB.name, beers: expected.map((b) => expect.objectContaining({ name: b.name })) });
    expect(useCommunityStore.getState().overrides.u2fkbnhu.beers).toEqual(expected);
    expect(nvBack).not.toHaveBeenCalled();
  });
});

describe('beers on tap in "Doplnit info"', () => {
  const k = t.nv.kompas;

  async function renderBeers(): Promise<any> {
    mockParams.current = { tab: 'piva' };
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(DoplnitInfoScreen));
    });
    return renderer;
  }

  function inputs(renderer: any): any[] {
    return renderer.root.findAll((n: any) => n.type === 'TextInput');
  }

  function savedBeers(): CommunityBeer[] {
    return (enqueuePubCommunity as jest.Mock).mock.calls[0][0].beers.map((b: any) => ({ name: b.name, volumeMl: b.volume_ml, priceCzk: b.price_czk }));
  }

  beforeEach(() => {
    act(() => {
      useCommunityStore.setState({ overrides: {} });
    });
  });

  it('corrects the price and volume of a beer on tap and saves it through the community queue', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, 'Pilsner Urquell'));
    const [name, price] = inputs(renderer);
    expect(name.props.value).toBe('Pilsner Urquell');
    expect(price.props.value).toBe('69');

    act(() => price.props.onChangeText('59'));
    act(() => pressText(renderer, '0,4 l'));
    act(() => pressText(renderer, k.done));
    act(() => pressText(renderer, k.save));

    expect(enqueuePubCommunity).toHaveBeenCalledTimes(1);
    expect(savedBeers()).toEqual([{ name: 'Pilsner Urquell', volumeMl: 400, priceCzk: 59 }]);
  });

  it('keeps a beer still open in the form when the big Save is pressed', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, k.addBeer));
    act(() => inputs(renderer)[0].props.onChangeText('Kozel 11'));
    act(() => inputs(renderer)[1].props.onChangeText('45'));
    act(() => pressText(renderer, k.save));

    expect(savedBeers()).toEqual([
      { name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 69 },
      { name: 'Kozel 11', volumeMl: 500, priceCzk: 45 },
    ]);
  });

  it('saves the other changes when an add form was opened and left empty', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, 'Pilsner Urquell'));
    act(() => inputs(renderer)[1].props.onChangeText('59'));
    act(() => pressText(renderer, k.done));
    act(() => pressText(renderer, k.addBeer));
    const save = renderer.root.findAll((n: { props: { label?: string } }) => n.props.label === k.save)[0];
    expect(save.props.disabled).toBe(false);
    act(() => pressText(renderer, k.save));

    expect(savedBeers()).toEqual([{ name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 59 }]);
  });

  it('adds the same beer as a small one next to the big one', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, 'Pilsner Urquell'));
    act(() => pressText(renderer, k.addSmallBeer('0,3 l')));
    act(() => pressText(renderer, k.save));

    expect(savedBeers()).toEqual([
      { name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 69 },
      { name: 'Pilsner Urquell', volumeMl: 300, priceCzk: undefined },
    ]);
  });

  it('adds a new beer as 0,5 l unless another volume is picked', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, k.addBeer));
    act(() => inputs(renderer)[0].props.onChangeText('Kozel 11'));
    act(() => pressText(renderer, '0,3 l'));
    act(() => inputs(renderer)[1].props.onChangeText('45'));
    act(() => pressText(renderer, k.addBeer));
    act(() => pressText(renderer, k.save));

    expect(savedBeers()).toEqual([
      { name: 'Pilsner Urquell', volumeMl: 500, priceCzk: 69 },
      { name: 'Kozel 11', volumeMl: 300, priceCzk: 45 },
    ]);
  });

  it('does not let a nonsense price or volume through', async () => {
    const renderer = await renderBeers();
    act(() => pressText(renderer, 'Pilsner Urquell'));
    act(() => inputs(renderer)[1].props.onChangeText('5000'));
    expect(texts(renderer)).toContain(k.invalidPrice);
    act(() => pressText(renderer, k.done));
    expect(texts(renderer)).toContain(k.done);

    act(() => inputs(renderer)[1].props.onChangeText('69'));
    act(() => pressText(renderer, k.volumeOther));
    act(() => inputs(renderer)[2].props.onChangeText('750'));
    expect(texts(renderer)).toContain(k.invalidVolume('300, 330, 400, 500, 1000'));
    act(() => inputs(renderer)[2].props.onChangeText('330'));
    act(() => pressText(renderer, k.done));
    act(() => pressText(renderer, k.save));

    expect(savedBeers()).toEqual([{ name: 'Pilsner Urquell', volumeMl: 330, priceCzk: 69 }]);
  });
});
