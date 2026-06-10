/**
 * Platform-aware interpretation of the heading `accuracy` field.
 *
 * expo-location reports it in different units per platform:
 *   • iOS — degrees of possible error (larger = worse).
 *   • Android — SensorManager accuracy constants 0–3 (smaller = worse):
 *     0 unreliable, 1 low, 2 medium, 3 high.
 */

const IOS_LOW_ACCURACY_DEGREES = 20;
const ANDROID_LOW_ACCURACY_MAX = 1;

export function isHeadingAccuracyLow(accuracy: number | null, os: string): boolean {
  if (accuracy === null) return false;
  return os === 'android'
    ? accuracy <= ANDROID_LOW_ACCURACY_MAX
    : accuracy > IOS_LOW_ACCURACY_DEGREES;
}
