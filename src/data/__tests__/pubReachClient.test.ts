import { AppState } from 'react-native';

import { flushPubReach, resetPubReachForTests, trackPinsSeen, trackPubReach } from '../pubReachClient';
import { resetTelemetryForTests, setTelemetrySession } from '../telemetryClient';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const TIGER = 'u2fkbhd0';
const FLEK = 'u2fkbeu5';

function session(token: string) {
  return { deviceId: 'device', accountId: token, token } as Parameters<typeof setTelemetrySession>[0];
}

function sent(fetchSpy: jest.Mock): { type: string; pub: string }[][] {
  return fetchSpy.mock.calls.map((call) =>
    JSON.parse((call as [string, RequestInit])[1].body as string).events.map(({ type, pub }: { type: string; pub: string }) => ({ type, pub })),
  );
}

let fetchSpy: jest.Mock;

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  resetTelemetryForTests();
  setTelemetrySession(session('first'));
  resetPubReachForTests();
  fetchSpy = jest.fn(async () => ({ ok: true, status: 202 }));
  global.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.useRealTimers();
});

it('counts a pin once per session however often the map moves over it', async () => {
  trackPinsSeen([TIGER, FLEK]);
  trackPinsSeen([TIGER]);
  trackPinsSeen([TIGER, FLEK]);
  trackPubReach('detail_view', TIGER);
  trackPubReach('detail_view', TIGER);

  await flushPubReach();

  expect(sent(fetchSpy)).toEqual([
    [
      { type: 'map_impression', pub: TIGER },
      { type: 'map_impression', pub: FLEK },
      { type: 'detail_view', pub: TIGER },
      { type: 'detail_view', pub: TIGER },
    ],
  ]);
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe('https://api.example.com/v1/pub-reach');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer first');
});

it('counts pins again after a long break in the background', async () => {
  jest.useFakeTimers({ now: new Date('2026-11-06T18:00:00Z') });
  trackPinsSeen([TIGER]);
  await flushPubReach();
  const onChange = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)[1] as (state: string) => void;
  onChange('background');
  jest.setSystemTime(new Date('2026-11-06T18:10:00Z'));
  onChange('active');
  trackPinsSeen([TIGER]);
  onChange('background');
  jest.setSystemTime(new Date('2026-11-06T19:00:00Z'));
  onChange('active');
  trackPinsSeen([TIGER]);
  await flushPubReach();

  expect(sent(fetchSpy).flat()).toEqual([
    { type: 'map_impression', pub: TIGER },
    { type: 'map_impression', pub: TIGER },
  ]);
});

it('keeps a batch the network lost and drops one the server rejected', async () => {
  fetchSpy.mockRejectedValueOnce(new Error('offline'));
  trackPubReach('navigation', TIGER);
  await flushPubReach();
  fetchSpy.mockResolvedValueOnce({ ok: false, status: 400 });
  await flushPubReach();
  await flushPubReach();

  expect(sent(fetchSpy)).toEqual([[{ type: 'navigation', pub: TIGER }], [{ type: 'navigation', pub: TIGER }]]);
});

it('never sends one account\'s events under the next account', async () => {
  trackPubReach('detail_view', TIGER);
  setTelemetrySession(session('second'));
  await flushPubReach();
  trackPinsSeen([TIGER]);
  await flushPubReach();

  expect(sent(fetchSpy)).toEqual([[{ type: 'map_impression', pub: TIGER }]]);
  expect(((fetchSpy.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe('Bearer second');
});

it('ignores anything that is not a pub cell', async () => {
  trackPubReach('detail_view', 'Praha 1');
  await flushPubReach();

  expect(fetchSpy).not.toHaveBeenCalled();
});

it('does not resend a batch whose request timed out, the server may have saved it', async () => {
  jest.useFakeTimers();
  fetchSpy.mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
  );
  trackPubReach('navigation', TIGER);
  const first = flushPubReach();
  jest.advanceTimersByTime(8000);
  await first;
  jest.runOnlyPendingTimers();
  await flushPubReach();

  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
