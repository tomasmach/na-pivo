import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { ANDROID_APPLICATION_ID, PLAY_STORE_LISTING_URL, openPlayStoreListing } from '../storeLinks';

jest.mock('expo-linking', () => ({ canOpenURL: jest.fn(), openURL: jest.fn() }));

describe('Google Play listing', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    (Platform as { OS: string }).OS = 'android';
  });

  afterAll(() => {
    (Platform as { OS: string }).OS = originalPlatform;
  });

  it('uses the production application id', () => {
    expect(ANDROID_APPLICATION_ID).toBe('com.tomasmach.na_pivo');
    expect(PLAY_STORE_LISTING_URL).toBe(
      'https://play.google.com/store/apps/details?id=com.tomasmach.na_pivo',
    );
  });

  it('opens the native Play listing on Android', async () => {
    jest.mocked(Linking.canOpenURL).mockResolvedValue(true);
    await openPlayStoreListing();
    expect(Linking.openURL).toHaveBeenCalledWith('market://details?id=com.tomasmach.na_pivo');
  });

  it('falls back to the HTTPS listing when Google Play cannot handle the link', async () => {
    jest.mocked(Linking.canOpenURL).mockResolvedValue(false);
    await openPlayStoreListing();
    expect(Linking.openURL).toHaveBeenCalledWith(PLAY_STORE_LISTING_URL);
  });
});
