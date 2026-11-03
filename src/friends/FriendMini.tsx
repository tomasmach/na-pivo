import type { FriendProfile } from '@/data/friendsClient';
import { t } from '@/i18n';

/** `@nickname` (preferred) → display name → a friendly fallback. */
export function friendDisplayName(profile: FriendProfile | null | undefined): string {
  if (!profile) return t.friends.fallbackName;
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || t.friends.fallbackName;
}
