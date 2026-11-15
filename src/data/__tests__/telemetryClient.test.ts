import {
  flushClientEvents,
  resetTelemetryForTests,
  setTelemetrySession,
  trackClientEvent,
} from '../telemetryClient';

function sentEvents(fetchSpy: jest.Mock): Record<string, unknown>[] {
  return fetchSpy.mock.calls.flatMap((call) => {
    const body = JSON.parse((call as unknown as [string, RequestInit])[1].body as string);
    return Array.isArray(body.events) ? body.events : [body];
  });
}

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function setBackend(url: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  } else {
    process.env.EXPO_PUBLIC_BACKEND_URL = url;
  }
}

beforeEach(() => {
  setBackend('https://api.example.com');
  resetTelemetryForTests();
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  setBackend(ORIGINAL_URL);
  jest.clearAllMocks();
});

describe('trackClientEvent', () => {
  it('accepts only fixed native diagnostic categories and app states', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    await trackClientEvent({ event: 'api_failure', context: {
      app_state: 'background', error_category: 'secure_store_access',
    } });
    await trackClientEvent({ event: 'api_failure', message: 'bad category', context: {
      app_state: 'private account state', error_category: 'private native error text',
    } });
    await flushClientEvents();
    const bodies = sentEvents(fetchSpy) as { context: unknown }[];
    expect(bodies[0].context).toEqual({ app_state: 'background', error_category: 'secure_store_access' });
    expect(bodies[1].context).toEqual({});
  });

  it('POSTs sanitized telemetry with app metadata and optional auth', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    setTelemetrySession({
      deviceId: 'device-id',
      accountId: 'account-id',
      token: 'secret-token',
    });

    await trackClientEvent({
      event: 'console_error',
      severity: 'error',
      message:
        'Bearer secret-token user@example.com 11111111-2222-4333-8444-555555555555',
      context: {
        endpoint: '/v1/pub-hours?lat=50.1&lng=14.4',
        error_message: 'Failed for user@example.com',
        distance_m: 12.6,
        // Not whitelisted; must not cross the wire.
        authorization: 'Bearer should-not-send',
      },
    });
    await flushClientEvents();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/client-events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect((init.headers as Record<string, string>)['X-Na-Pivo-App-Version']).toBe('v1.1.5 (4)');

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: 'console_error',
      severity: 'error',
      app_version: 'v1.1.5 (4)',
      platform: 'ios',
      os_version: '18.1',
    });
    expect(body.message).toBe('Bearer [redacted] [redacted-email] [redacted-uuid]');
    expect(body.context).toEqual({
      endpoint: '/v1/pub-hours',
      error_message: 'Failed for [redacted-email]',
      distance_m: 13,
    });
  });

  it('does nothing when the backend is dormant', async () => {
    setBackend(undefined);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await trackClientEvent({ event: 'app_open' });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows privacy-safe counter events and drops non-whitelisted context', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await trackClientEvent({
      event: 'drink_sync_failed',
      severity: 'warning',
      context: {
        operation: 'submit_drink',
        status: 429,
        sync_result: 'retry',
        retryable: true,
        queue: 'drinks',
        pending_count: 3.4,
        mode: 'add',
        delivery_state: 'queued',
        return_days: 2.2,
        // Not whitelisted; must not cross the wire.
        pub_name: 'U Zlatého tygra',
        beer_name: 'Plzeň',
        lat: 50.0876,
      },
    });
    await flushClientEvents();

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.event).toBe('drink_sync_failed');
    expect(body.context).toEqual({
      operation: 'submit_drink',
      status: 429,
      sync_result: 'retry',
      retryable: true,
      queue: 'drinks',
      pending_count: 3,
      mode: 'add',
      delivery_state: 'queued',
      return_days: 2,
    });
  });

  it('allows coarse screen names without accepting a raw route', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await trackClientEvent({
      event: 'screen_viewed',
      context: {
        screen: 'friend_profile',
        previous_screen: 'friends',
        pathname: '/parta/private-account-id',
      },
    });
    await flushClientEvents();

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).context).toEqual({
      screen: 'friend_profile',
      previous_screen: 'friends',
    });
  });

  it('keeps the aggregated tap count as a whole number', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await trackClientEvent({
      event: 'ui_interaction',
      context: { target: 'compass_skip', action: 'tap', count: 12.4 },
    });
    await flushClientEvents();

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).context).toEqual({
      target: 'compass_skip',
      action: 'tap',
      count: 12,
    });
  });

  it('keeps diagnostics alive when product events exhaust their own budget', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    for (let i = 0; i < 600; i += 1) {
      await trackClientEvent({
        event: 'ui_interaction',
        context: { target: 'tab_beer', action: 'select' },
      });
    }
    await flushClientEvents();
    const productSent = sentEvents(fetchSpy).length;
    expect(productSent).toBeLessThan(600);

    await trackClientEvent({ event: 'unhandled_error', severity: 'error' });
    await trackClientEvent({ event: 'walking_distance', context: { distance_m: 1200 } });
    await flushClientEvents();

    expect(sentEvents(fetchSpy)).toHaveLength(productSent + 2);
  });

  it('sends events together, each batch under the account that produced it', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;
    setTelemetrySession({ deviceId: 'device-id', accountId: 'first', token: 'first-token' });

    await trackClientEvent({ event: 'app_open' });
    await trackClientEvent({ event: 'screen_viewed', context: { screen: 'compass' } });
    expect(fetchSpy).not.toHaveBeenCalled();

    setTelemetrySession({ deviceId: 'device-id', accountId: 'second', token: 'second-token' });
    await trackClientEvent({ event: 'app_foreground' });
    await jest.advanceTimersByTimeAsync(15_000);
    jest.useRealTimers();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = fetchSpy.mock.calls as unknown as [string, RequestInit][];
    expect((firstCall[1].headers as Record<string, string>).Authorization).toBe('Bearer first-token');
    expect(JSON.parse(firstCall[1].body as string).events.map((e: { event: string }) => e.event)).toEqual([
      'app_open',
      'screen_viewed',
    ]);
    expect((secondCall[1].headers as Record<string, string>).Authorization).toBe('Bearer second-token');
    expect(JSON.parse(secondCall[1].body as string).event).toBe('app_foreground');
  });

  it('sends an error at once together with the events waiting before it', async () => {
    const fetchSpy = jest.fn(async () => ({ ok: true }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    await trackClientEvent({ event: 'screen_viewed', context: { screen: 'compass' } });
    await trackClientEvent({ event: 'unhandled_error', severity: 'error', message: 'boom' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(sentEvents(fetchSpy).map((event) => event.event)).toEqual(['screen_viewed', 'unhandled_error']);
  });
});
