import { Platform } from 'react-native';

const mockConfigure = jest.fn();
const mockHasPlayServices = jest.fn(async (_options?: unknown) => true);
const mockSignIn = jest.fn();

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (options: unknown) => mockConfigure(options),
    hasPlayServices: (options: unknown) => mockHasPlayServices(options),
    signIn: () => mockSignIn(),
  },
}));

describe('getGoogleIdToken', () => {
  const originalPlatform = Platform.OS;
  const originalWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

  beforeAll(() => {
    (Platform as { OS: string }).OS = 'android';
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client.apps.googleusercontent.com';
  });

  afterAll(() => {
    (Platform as { OS: string }).OS = originalPlatform;
    if (originalWebClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalWebClientId;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies Android status 10 as a release OAuth configuration error', async () => {
    mockSignIn.mockRejectedValueOnce({ code: '10', message: 'DEVELOPER_ERROR' });
    const { getGoogleIdToken } = await import('@/data/socialAuth');

    await expect(getGoogleIdToken()).rejects.toMatchObject({
      name: 'SocialAuthError',
      code: 'misconfigured',
    });
  });
});
