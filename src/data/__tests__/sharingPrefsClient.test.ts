import { forgetSharingPrefsForAccountBoundary, syncSharingPrefs } from '../sharingPrefsClient';
import { DEFAULT_SHARING_PREFS, useVycepStore } from '@/stores/vycepStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let mockSessionToken = 'old-token';
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'old-token' })),
  getSessionToken: jest.fn(async () => mockSessionToken),
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
