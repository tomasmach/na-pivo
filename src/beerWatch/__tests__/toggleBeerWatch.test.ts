import { t } from '@/i18n';
import { useBeerWatchStore } from '@/stores/beerWatchStore';
import { useToastStore } from '@/stores/toastStore';

import { toggleBeerWatch } from '../toggleBeerWatch';

const mockAdd = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/data/beerWatchClient', () => ({
  fetchBeerWatches: jest.fn(),
  addBeerWatch: (...args: unknown[]) => mockAdd(...args),
  removeBeerWatch: (key: string) => mockRemove(key),
  updateBeerWatchSettings: jest.fn(),
}));
const mockRequestPush = jest.fn();
jest.mock('@/notifications/friendPush', () => ({
  requestPushRegistration: () => mockRequestPush(),
}));
const mockSyncLocation = jest.fn(async () => undefined);
jest.mock('../beerWatchLocation', () => ({ syncBeerWatchLocation: () => mockSyncLocation() }));

const watch = { productKey: 'unetice-12', name: 'Únětická 12°', aliases: ['Únětická 12'] };

beforeEach(() => {
  jest.clearAllMocks();
  useBeerWatchStore.getState().reset();
  useToastStore.setState({ message: null });
  mockRequestPush.mockResolvedValue('registered');
});

it('watches, asks for notifications and sends the rounded location', async () => {
  mockAdd.mockResolvedValue({ ok: true, watch });

  await toggleBeerWatch('Únětická 12', 'Únětický pivovar');

  expect(useBeerWatchStore.getState().watches).toEqual([watch]);
  expect(mockRequestPush).toHaveBeenCalledTimes(1);
  expect(mockSyncLocation).toHaveBeenCalledTimes(1);
  expect(useToastStore.getState().message).toBe(t.beerWatch.watchedToast);
});

it('keeps the watch when notifications are denied', async () => {
  mockAdd.mockResolvedValue({ ok: true, watch });
  mockRequestPush.mockResolvedValue('denied');

  await toggleBeerWatch('Únětická 12');

  expect(useBeerWatchStore.getState().watches).toEqual([watch]);
});

it('stops watching a beer matched by alias', async () => {
  useBeerWatchStore.setState({ watches: [watch] });
  mockRemove.mockResolvedValue(true);

  await toggleBeerWatch('únětická 12');

  expect(mockRemove).toHaveBeenCalledWith('unetice-12');
  expect(mockAdd).not.toHaveBeenCalled();
  expect(useToastStore.getState().message).toBe(t.beerWatch.unwatchedToast);
});

it('stops watching a beer the server matched through its brewery', async () => {
  const kozel = { productKey: 'velkopopovicky-kozel-11', name: 'Velkopopovický Kozel 11°', aliases: ['Kozel 11'] };
  useBeerWatchStore.setState({ watches: [kozel] });
  mockRemove.mockResolvedValue(true);

  await toggleBeerWatch('11', 'Kozel');

  expect(mockRemove).toHaveBeenCalledWith('velkopopovicky-kozel-11');
  expect(mockAdd).not.toHaveBeenCalled();
});

it.each([
  ['unknown_beer', t.beerWatch.unknownBeerToast],
  ['too_many', t.beerWatch.tooManyToast],
  ['failed', t.beerWatch.failedToast],
] as const)('explains a %s failure and asks for nothing', async (reason, message) => {
  mockAdd.mockResolvedValue({ ok: false, reason });

  await toggleBeerWatch('Domácí ležák');

  expect(useToastStore.getState().message).toBe(message);
  expect(mockRequestPush).not.toHaveBeenCalled();
  expect(mockSyncLocation).not.toHaveBeenCalled();
});

it('ignores a second tap while the first is still on the way', async () => {
  let finish!: (value: unknown) => void;
  mockAdd.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const first = toggleBeerWatch('Únětická 12');
  await toggleBeerWatch('Únětická 12');
  finish({ ok: true, watch });
  await first;
  expect(mockAdd).toHaveBeenCalledTimes(1);
});
