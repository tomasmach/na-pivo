import { installBackendLocaleHeader } from '../localeHeader';

jest.mock('@/i18n', () => ({ locale: 'en' }));
jest.mock('../backendConfig', () => ({
  getBackendUrl: () => 'https://api.example.test/',
  trimTrailingSlash: (u: string) => u.replace(/\/+$/, ''),
}));

describe('installBackendLocaleHeader', () => {
  const original = globalThis.fetch;
  let calls: { url: string; headers: Headers | undefined }[];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === 'string' ? input : input.toString(),
        headers: init?.headers ? new Headers(init.headers) : undefined,
      });
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;
    installBackendLocaleHeader();
  });

  afterAll(() => {
    globalThis.fetch = original;
  });

  it('adds Accept-Language to backend requests only', async () => {
    await fetch('https://api.example.test/v1/pubs', { headers: { 'Content-Type': 'application/json' } });
    await fetch('https://maps.example.com/tiles');
    expect(calls[0].headers?.get('Accept-Language')).toBe('en');
    expect(calls[0].headers?.get('Content-Type')).toBe('application/json');
    expect(calls[1].headers).toBeUndefined();
  });

  it('keeps an explicit Accept-Language untouched', async () => {
    await fetch('https://api.example.test/v1/pubs', { headers: { 'Accept-Language': 'cs' } });
    expect(calls[0].headers?.get('Accept-Language')).toBe('cs');
  });
});
