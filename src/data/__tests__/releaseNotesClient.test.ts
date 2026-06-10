import { fetchReleaseNote } from '../releaseNotesClient';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function setBackend(url: string | undefined): void {
  if (url === undefined) {
    delete process.env.EXPO_PUBLIC_BACKEND_URL;
  } else {
    process.env.EXPO_PUBLIC_BACKEND_URL = url;
  }
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  setBackend(ORIGINAL_URL);
  jest.clearAllMocks();
});

describe('fetchReleaseNote', () => {
  it('returns kind:error when dormant (no backend URL) and never calls fetch', async () => {
    setBackend('   ');
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(fetchReleaseNote('1.2.0')).resolves.toEqual({ kind: 'error' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns kind:error for an empty version and never calls fetch', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(fetchReleaseNote('')).resolves.toEqual({ kind: 'error' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('GETs the note and normalizes the response', async () => {
    setBackend('https://api.example.com/');
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: '1.2.0',
        title: 'Co je nového',
        items: [
          { icon: '🍺', text: 'První novinka' },
          { icon: '', text: 'Druhá novinka' },
          { icon: '🗺️', text: '' }, // dropped — empty text
          { text: 'Bez ikony' }, // icon defaults to ''
        ],
      }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchReleaseNote('1.2.0');

    expect(result).toEqual({
      kind: 'note',
      note: {
        version: '1.2.0',
        title: 'Co je nového',
        items: [
          { icon: '🍺', text: 'První novinka' },
          { icon: '', text: 'Druhá novinka' },
          { icon: '', text: 'Bez ikony' },
        ],
      },
    });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/release-notes?version=1.2.0');
    expect(init.method).toBe('GET');
  });

  it('defaults a missing title to "Co je nového"', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.2.0', items: [{ icon: '', text: 'x' }] }),
    })) as unknown as typeof fetch;

    const result = await fetchReleaseNote('1.2.0');
    expect(result).toEqual({
      kind: 'note',
      note: { version: '1.2.0', title: 'Co je nového', items: [{ icon: '', text: 'x' }] },
    });
  });

  it('returns kind:none on HTTP 404 (no note for this version)', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'No release note for this version.' }),
    })) as unknown as typeof fetch;

    await expect(fetchReleaseNote('1.2.0')).resolves.toEqual({ kind: 'none' });
  });

  it('returns kind:none for a published-but-empty note (no usable items)', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.2.0', title: 'Co je nového', items: [] }),
    })) as unknown as typeof fetch;

    await expect(fetchReleaseNote('1.2.0')).resolves.toEqual({ kind: 'none' });
  });

  it('returns kind:error on other non-OK responses', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(fetchReleaseNote('1.2.0')).resolves.toEqual({ kind: 'error' });
  });

  it('returns kind:error and never throws on network failures', async () => {
    setBackend('https://api.example.com');
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(fetchReleaseNote('1.2.0')).resolves.toEqual({ kind: 'error' });
  });
});
