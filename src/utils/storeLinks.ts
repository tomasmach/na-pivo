import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export const ANDROID_APPLICATION_ID = 'com.tomasmach.na_pivo';
export const PLAY_STORE_LISTING_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_APPLICATION_ID}`;

/** App Store Connect app id (eas.json submit.ios.ascAppId). */
export const IOS_APP_STORE_ID = '6773790025';
export const APP_STORE_WRITE_REVIEW_URL =
  `https://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`;

/** Open the store page where the user can write or edit their rating. */
export async function openStoreReview(): Promise<void> {
  if (Platform.OS === 'ios') {
    // itms-apps lands straight in the App Store review form; the https form is
    // the fallback where the store app is missing (simulator, restricted devices).
    const nativeUrl = `itms-apps://apps.apple.com/app/id${IOS_APP_STORE_ID}?action=write-review`;
    // No canOpenURL: iOS gates it behind LSApplicationQueriesSchemes, and a
    // failed openURL rejects anyway, which is the signal to fall back.
    try {
      await Linking.openURL(nativeUrl);
      return;
    } catch {
      // Fall through to the universal link.
    }
    await Linking.openURL(APP_STORE_WRITE_REVIEW_URL);
    return;
  }
  await openPlayStoreListing();
}

export async function openPlayStoreListing(): Promise<void> {
  const nativeUrl = `market://details?id=${ANDROID_APPLICATION_ID}`;
  if (Platform.OS === 'android') {
    try {
      if (await Linking.canOpenURL(nativeUrl)) {
        await Linking.openURL(nativeUrl);
        return;
      }
    } catch {
      // The universal HTTPS listing remains a safe fallback.
    }
  }
  await Linking.openURL(PLAY_STORE_LISTING_URL);
}
