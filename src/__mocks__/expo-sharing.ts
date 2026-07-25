/**
 * Test mock for expo-sharing (native module, untranspiled ESM source).
 * ShareNightModal hands the story-sticker PNG to the system share sheet;
 * under test sharing is reported unavailable so code takes the RN fallback.
 */

export async function isAvailableAsync(): Promise<boolean> {
  return false;
}

export async function shareAsync(_url: string, _options?: unknown): Promise<void> {
  // no-op
}
