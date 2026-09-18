import { isLegacyTableInviteUrl, parseTourTokenFromUrl } from '@/data/inviteLinkRoutes';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const tourToken = parseTourTokenFromUrl(path);
  if (tourToken) return `/t/${tourToken}`;
  return isLegacyTableInviteUrl(path) ? '/party-live' : path;
}
