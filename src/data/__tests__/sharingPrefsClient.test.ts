import {
  adoptServerSharing,
  flushSharingPrefs,
  forgetSharingPrefsForAccountBoundary,
  sharingReadTicket,
  syncSharingPrefs,
  updateSharingPrefs,
} from '../sharingPrefsClient';
import { useToastStore } from '@/stores/toastStore';
import { DEFAULT_SHARING_PREFS, useVycepStore } from '@/stores/vycepStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
let mockSessionToken = 'old-token';
let mockEarlierAccountWrite: Promise<void> = Promise.resolve();
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 'old-token' })),
  getSessionToken: jest.fn(async () => mockSessionToken),
  runAccountMeWrite: <T,>(task: () => Promise<T>) => mockEarlierAccountWrite.then(task),
}));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://127.0.0.1:8000${path}` }));

const settle = () => new Promise((resolve) => setImmediate(resolve));

it('takes the sharing of a profile read and keeps an unanswered auto-publish unanswered', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });

  adoptServerSharing({ shareDefault: 'public', nightAutopublish: 'off' }, sharingReadTicket());
  await settle();

  expect(useVycepStore.getState()).toMatchObject({ shareDefault: 'public', nightAutopublish: null, sharingDirty: false });
});

it('ignores a profile read that began before the account changed', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  const ticket = sharingReadTicket();

  forgetSharingPrefsForAccountBoundary();
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  adoptServerSharing({ shareDefault: 'public', nightAutopublish: 'public' }, ticket);
  await settle();

  expect(useVycepStore.getState()).toMatchObject({ ...DEFAULT_SHARING_PREFS });
});

it('keeps a sharing change made while the profile was loading', async () => {
  mockSessionToken = 'old-token';
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  const ticket = sharingReadTicket();
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ share_default: 'friends', night_autopublish: 'friends' }) })) as unknown as typeof fetch;

  await updateSharingPrefs({ nightAutopublish: 'friends' });
  adoptServerSharing({ shareDefault: 'public', nightAutopublish: 'off' }, ticket);
  await settle();

  expect(useVycepStore.getState()).toMatchObject({ shareDefault: 'friends', nightAutopublish: 'friends', sharingDirty: false });
});

it('keeps a sharing change delivered while a sign-in to the same account was running', async () => {
  mockSessionToken = 'old-token';
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  const changes = sharingReadTicket()!.changes;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ share_default: 'public', night_autopublish: 'public' }) })) as unknown as typeof fetch;

  await updateSharingPrefs({ shareDefault: 'public', nightAutopublish: 'public' });
  adoptServerSharing({ shareDefault: 'friends', nightAutopublish: 'off' }, sharingReadTicket(changes));
  await settle();

  expect(useVycepStore.getState()).toMatchObject({ shareDefault: 'public', nightAutopublish: 'public', sharingDirty: false });
});

it('takes the sharing of the account a sign-in switched to', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  const changes = sharingReadTicket()!.changes;

  forgetSharingPrefsForAccountBoundary();
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  adoptServerSharing({ shareDefault: 'public', nightAutopublish: 'friends' }, sharingReadTicket(changes));
  await settle();

  expect(useVycepStore.getState()).toMatchObject({ shareDefault: 'public', nightAutopublish: 'friends' });
});

it('does not read the profile when no sharing change waits', async () => {
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS });
  global.fetch = jest.fn() as typeof fetch;

  await syncSharingPrefs();

  expect(global.fetch).not.toHaveBeenCalled();
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

it('does not send a sharing change that was still waiting when the account changed', async () => {
  mockSessionToken = 'old-token';
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS, shareDefault: 'public', nightAutopublish: 'public', sharingDirty: true });
  let finishEarlierWrite!: () => void;
  mockEarlierAccountWrite = new Promise<void>((resolve) => (finishEarlierWrite = resolve));
  global.fetch = jest.fn() as typeof fetch;

  const sync = syncSharingPrefs();
  await new Promise((resolve) => setImmediate(resolve));
  forgetSharingPrefsForAccountBoundary();
  mockSessionToken = 'signed-in-token';
  finishEarlierWrite();
  await sync;
  mockEarlierAccountWrite = Promise.resolve();

  expect(global.fetch).not.toHaveBeenCalled();
});

it('does not send a sharing change under a session other than the one that made it', async () => {
  mockSessionToken = 'signed-in-token';
  useVycepStore.setState({ ...DEFAULT_SHARING_PREFS, shareDefault: 'public', nightAutopublish: 'public', sharingDirty: true });
  global.fetch = jest.fn() as typeof fetch;

  await syncSharingPrefs();
  mockSessionToken = 'old-token';

  expect(global.fetch).not.toHaveBeenCalled();
  expect(useVycepStore.getState().sharingDirty).toBe(true);
});
