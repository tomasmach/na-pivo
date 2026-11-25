import { t } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));
jest.mock('react-native-reanimated', () => {
  const lean = jest.requireActual('react-native-reanimated');
  const chain: unknown = new Proxy(() => chain, { get: () => chain, apply: () => chain });
  const extra = { Easing: { ...lean.Easing, bezier: () => (x: number) => x }, ReduceMotion: { System: 'system', Always: 'always', Never: 'never' } };
  return new Proxy({ ...lean, ...extra }, { get: (target, key) => (key in target ? target[key as keyof typeof target] : chain) });
});
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, PROVIDER_GOOGLE: 'google' }));
jest.mock('expo-location', () => ({ getCurrentPositionAsync: jest.fn(), Accuracy: { High: 4 } }));

const mockParams: { current: Record<string, string> } = { current: {} };
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams.current,
  useFocusEffect: () => undefined,
}));
jest.mock('@/newlook/navigation', () => ({ nvBack: jest.fn() }));
jest.mock('@/newlook/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/newlook/ui/store', () => ({ dialog: jest.fn(), toast: jest.fn() }));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/newlook/screens/kompas/usePubPage', () => ({ useRecentPosition: () => ({ lat: 50.087, lng: 14.421 }) }));
jest.mock('@/data/addedPubLocationClient', () => ({
  lookupAddedPubLocation: jest.fn(async () => ({ lat: 50.0801, lng: 14.4302, address: 'Husova 17', city: 'Praha' })),
}));
jest.mock('@/data/addedPubsQueue', () => ({
  enqueueAddedPub: jest.fn(async () => 'synced'),
  enqueueAddedPubEdit: jest.fn(),
  loadAddedPubSubmissions: jest.fn(async () => []),
  onAddedPubSubmissionsChanged: jest.fn(() => () => undefined),
  retryAddedPub: jest.fn(),
  syncOwnAddedPubs: jest.fn(),
}));
jest.mock('@/data/pubs', () => ({
  ...jest.requireActual('@/data/pubs'),
  upsertLocalPub: jest.fn(),
  clearPubsSnapshot: jest.fn(async () => undefined),
}));
const KNOWN = { id: 'local:5', name: 'U Zlatého tygra', lat: 50.0853, lng: 14.4189, city: 'Praha' };
const NEW = { id: 'google:abc', name: 'U Zlatého tygříka', providerPlaceId: 'abc' };
jest.mock('@/data/pubSearchClient', () => ({
  ...jest.requireActual('@/data/pubSearchClient'),
  suggestPubsToAdd: jest.fn(async () => [KNOWN, NEW]),
  resolvePubSearchResult: jest.fn(async (r: { id: string; name: string }) =>
    r.id === 'local:5' ? { ...KNOWN } : { id: r.id, name: r.name, lat: 50.08, lng: 14.43, city: 'Praha', address: 'Husova 17' },
  ),
}));
const mockPickPub = jest.fn();
jest.mock('@/newlook/screens/stamgast/placeStore', () => ({
  useNvPlaceStore: Object.assign(() => null, { getState: () => ({ pickPub: mockPickPub }) }),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const { nvBack } = require('@/newlook/navigation');
const { enqueueAddedPub } = require('@/data/addedPubsQueue');
const { PridatHospoduScreen } = require('@/newlook/screens/kompas/AddPubScreens');
const React = require('react');

const L = t.nv.kompas;

function pressText(renderer: any, label: string) {
  const nodes = renderer.root.findAll(
    (n: any) => typeof n.props.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [c.props.children].flat().join('') === label).length > 0,
  );
  return nodes[nodes.length - 1].props.onPress();
}

function inputs(renderer: any) {
  return renderer.root.findAll((n: any) => n.type === 'TextInput');
}

async function flush() {
  await act(async () => {
    jest.runOnlyPendingTimers();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

async function render() {
  let renderer: any;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(PridatHospoduScreen));
  });
  return renderer;
}

async function search(renderer: any, text: string) {
  await act(async () => inputs(renderer)[0].props.onChangeText(text));
  await flush();
}

async function fillAndAdd(renderer: any) {
  await act(async () => pressText(renderer, L.addCantFind));
  const [name, city, address] = inputs(renderer);
  await act(async () => name.props.onChangeText('Na Rohu'));
  await act(async () => city.props.onChangeText('Praha'));
  await act(async () => address.props.onChangeText('Husova 17'));
  await flush();
  await flush();
  await act(async () => renderer.root.findByProps({ testID: 'add-pub-save' }).props.onPress());
  await flush();
}

describe('adding a pub from the counter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockParams.current = { target: 'stamgast' };
  });
  afterEach(() => jest.useRealTimers());

  it('seats the user in a pub the app already knows instead of adding it again', async () => {
    const renderer = await render();
    await search(renderer, 'Tygr');
    await act(async () => pressText(renderer, KNOWN.name));
    await flush();

    expect(mockPickPub).toHaveBeenCalledWith(expect.objectContaining({ name: KNOWN.name, lat: KNOWN.lat, lng: KNOWN.lng }));
    expect(nvBack).toHaveBeenCalled();
    expect(enqueueAddedPub).not.toHaveBeenCalled();
  });

  it('opens the form for a place the app does not know yet', async () => {
    const renderer = await render();
    await search(renderer, 'Tygr');
    await act(async () => pressText(renderer, NEW.name));
    await flush();

    expect(mockPickPub).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'add-pub-name' }).props.value).toBe(NEW.name);
  });

  it('returns to the counter seated in the pub just added', async () => {
    const renderer = await render();
    await fillAndAdd(renderer);

    expect(enqueueAddedPub).toHaveBeenCalledTimes(1);
    expect(mockPickPub).toHaveBeenCalledWith(expect.objectContaining({ name: 'Na Rohu', lat: 50.0801, lng: 14.4302 }));
    expect(nvBack).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('still opens my added pubs when adding from the map', async () => {
    mockParams.current = {};
    const renderer = await render();
    await fillAndAdd(renderer);

    expect(mockPickPub).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/nv/moje-hospody');
  });
});
