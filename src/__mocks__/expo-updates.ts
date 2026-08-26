/** Test mock for expo-updates: development builds have no OTA runtime either. */
export async function reloadAsync(): Promise<void> {
  throw new Error('expo-updates is not enabled in tests');
}
