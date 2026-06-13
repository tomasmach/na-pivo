import {
  resetTelemetryForTests,
  setTelemetrySession,
  trackClientEvent,
} from '../telemetryClient';

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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/client-events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect((init.headers as Record<string, string>)['X-Na-Pivo-App-Version']).toBe('v1.1.2 (4)');

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      event: 'console_error',
      severity: 'error',
      app_version: 'v1.1.2 (4)',
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
});
