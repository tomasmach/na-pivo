import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import {
  ANDROID_APPLICATION_ID,
  APP_STORE_WRITE_REVIEW_URL,
  PLAY_STORE_LISTING_URL,
  openPlayStoreListing,
  openStoreReview,
} from '../storeLinks';

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

describe('store review link', () => {
  const originalPlatform = Platform.OS;

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => {
    (Platform as { OS: string }).OS = originalPlatform;
  });

  it('opens the App Store review form on iOS', async () => {
    (Platform as { OS: string }).OS = 'ios';
    jest.mocked(Linking.openURL).mockResolvedValue(true);
    await openStoreReview();
    expect(Linking.openURL).toHaveBeenCalledWith(
      'itms-apps://apps.apple.com/app/id6773790025?action=write-review',
    );
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to the https review link when the App Store scheme is refused', async () => {
    (Platform as { OS: string }).OS = 'ios';
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('no handler')).mockResolvedValue(true);
    await openStoreReview();
    expect(Linking.openURL).toHaveBeenLastCalledWith(APP_STORE_WRITE_REVIEW_URL);
  });

  it('opens the Play listing on Android', async () => {
    (Platform as { OS: string }).OS = 'android';
    jest.mocked(Linking.canOpenURL).mockResolvedValue(false);
    await openStoreReview();
    expect(Linking.openURL).toHaveBeenCalledWith(PLAY_STORE_LISTING_URL);
  });
});
