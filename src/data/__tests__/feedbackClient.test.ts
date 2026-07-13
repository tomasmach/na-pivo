import { submitFeedback, type FeedbackEntry } from '../feedbackClient';
import { ensureAccount } from '../account';
import { getBackendEndpoint } from '../backendConfig';
import * as efs from 'expo-file-system';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'token',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => {
  const upload = jest.fn();
  class File {
    exists = true;
    constructor(public uri: string) {}
    upload = upload;
  }
  return { File, UploadType: { MULTIPART: 1 }, __upload: upload };
});

const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const mockUpload = (efs as unknown as { __upload: jest.Mock }).__upload;
const originalFetch = global.fetch;

const ENTRY: FeedbackEntry = {
  client_id: 'client-1',
  category: 'bug',
  message: 'Kompas se netočí.',
  contact_type: 'instagram',
  contact: 'pivar',
  app_version: 'v1.3.2 (50)',
  platform: 'ios',
  os_version: '18.5',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'token',
    authenticated: false,
  });
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('keeps legacy text-only feedback on the JSON endpoint', async () => {
  global.fetch = jest.fn(async () => ({ status: 201 })) as unknown as typeof fetch;

  await expect(submitFeedback(ENTRY)).resolves.toBe('ok');

  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.test/v1/feedback',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(ENTRY),
    }),
  );
  expect(mockUpload).not.toHaveBeenCalled();
});

it('uploads one queued JPEG as multipart without leaking its local URI', async () => {
  mockUpload.mockResolvedValue({ status: 201, body: '{}', headers: {} });

  await expect(
    submitFeedback({ ...ENTRY, attachment_uri: 'file:///private/feedback/client-1.jpg' }),
  ).resolves.toBe('ok');

  const [url, options] = mockUpload.mock.calls[0] as [string, Record<string, unknown>];
  expect(url).toBe('https://api.test/v1/feedback');
  expect(options.fieldName).toBe('attachment');
  expect(options.mimeType).toBe('image/jpeg');
  expect(options.parameters).toEqual(expect.objectContaining({ client_id: 'client-1' }));
  expect(JSON.stringify(options.parameters)).not.toContain('file:///');
});

it('drops a permanently invalid attachment but retries server outages', async () => {
  mockUpload
    .mockResolvedValueOnce({ status: 400, body: '{}', headers: {} })
    .mockResolvedValueOnce({ status: 503, body: '{}', headers: {} });
  const entry = { ...ENTRY, attachment_uri: 'file:///private/feedback/client-1.jpg' };

  await expect(submitFeedback(entry)).resolves.toBe('permanent-error');
  await expect(submitFeedback(entry)).resolves.toBe('retry');
});
