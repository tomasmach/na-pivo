import AsyncStorage from '@react-native-async-storage/async-storage';

export const NICKNAME_NUDGE_SEEN_VERSION_KEY = 'na-pivo-nickname-nudge-seen-version';

interface ShouldShowNicknameNudgeInput {
  currentVersion: string | null;
  seenVersion: string | null;
}

export function shouldShowNicknameNudge({
  currentVersion,
  seenVersion,
}: ShouldShowNicknameNudgeInput): boolean {
  if (!currentVersion) return false;
  return seenVersion !== currentVersion;
}

export async function getSeenNicknameNudgeVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(NICKNAME_NUDGE_SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

export async function markNicknameNudgeSeen(version: string | null): Promise<void> {
  if (!version) return;
  try {
    await AsyncStorage.setItem(NICKNAME_NUDGE_SEEN_VERSION_KEY, version);
  } catch {
    // Best effort only. A failed write may show the nudge again next launch.
  }
}
