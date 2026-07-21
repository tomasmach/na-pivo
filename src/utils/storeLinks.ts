import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export const ANDROID_APPLICATION_ID = 'com.tomasmach.na_pivo';
export const PLAY_STORE_LISTING_URL =
  `https://play.google.com/store/apps/details?id=${ANDROID_APPLICATION_ID}`;

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
