import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

declare const __DEV__: boolean;

function shouldSkipHaptics(): boolean {
  return Platform.OS === 'ios' && typeof __DEV__ !== 'undefined' && __DEV__;
}

function fireHaptic(run: () => Promise<void>): void {
  if (shouldSkipHaptics()) return;
  run().catch(() => undefined);
}

export function fireSuccessHaptic(): void {
  fireHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function fireLightImpactHaptic(): void {
  fireHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
