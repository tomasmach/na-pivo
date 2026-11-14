import { flushSharingPrefs, forgetSharingPrefsForAccountBoundary, syncSharingPrefs } from '../sharingPrefsClient';
import { useToastStore } from '@/stores/toastStore';
import { DEFAULT_SHARING_PREFS, useVycepStore } from '@/stores/vycepStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let mockSessionToken = 'old-token';
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'old-token' })),
  getSessionToken: jest.fn(async () => mockSessionToken),
  runAccountMeWrite: <T,>(task: () => Promise<T>) => task(),
}));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://127.0.0.1:8000${path}` }));

it('ignores a sharing reply of the previous account', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  let reply!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>((resolve) => (reply = resolve))) as typeof fetch;

  const sync = syncSharingPrefs();
  await new Promise((resolve) => setImmediate(resolve));
  forgetSharingPrefsForAccountBoundary();
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  reply({ ok: true, status: 200, json: async () => ({ share_default: 'public', night_autopublish: 'public' }) } as Response);
  await sync;

  expect(useVycepStore.getState().nightAutopublish).toBe(DEFAULT_SHARING_PREFS.nightAutopublish);
  expect(useVycepStore.getState().shareDefault).toBe(DEFAULT_SHARING_PREFS.shareDefault);
});

it('ignores a sharing reply when the account changed by signing in', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  mockSessionToken = 'old-token';
  let reply!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>((resolve) => (reply = resolve))) as typeof fetch;

  const sync = syncSharingPrefs();
  await new Promise((resolve) => setImmediate(resolve));
  mockSessionToken = 'signed-in-token';
  reply({ ok: true, status: 200, json: async () => ({ share_default: 'public', night_autopublish: 'public' }) } as Response);
  await sync;

  expect(useVycepStore.getState().nightAutopublish).toBe(DEFAULT_SHARING_PREFS.nightAutopublish);
});

it('sends a sharing change made offline on the next launch or foreground', async () => {
  mockSessionToken = 'old-token';
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS, nightAutopublish: 'friends', sharingDirty: true });
  const fetchSpy = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ share_default: 'friends', night_autopublish: 'friends' }) }));
  global.fetch = fetchSpy as unknown as typeof fetch;

  await flushSharingPrefs();

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ share_default: 'friends', night_autopublish: 'friends' });
  expect(useVycepStore.getState().sharingDirty).toBe(false);

  await flushSharingPrefs();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

it('returns to the server sharing and says so when the server refuses the change', async () => {
  mockSessionToken = 'old-token';
  useToastStore.getState().hide();
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS, nightAutopublish: 'public', sharingDirty: true });
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? { ok: false, status: 400, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ share_default: 'friends', night_autopublish: 'off' }) },
  ) as unknown as typeof fetch;

  await flushSharingPrefs();

  expect(useVycepStore.getState()).toMatchObject({ nightAutopublish: 'off', sharingDirty: false });
  expect(useToastStore.getState().message).toBe('Nastavení se mi nepovedlo uložit, tak jsem ho vrátil zpátky.');
});
