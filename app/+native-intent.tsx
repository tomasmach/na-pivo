import { isLegacyTableInviteUrl, parseTourRunFromUrl, parseTourTokenFromUrl } from '@/data/inviteLinkRoutes';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const tourToken = parseTourTokenFromUrl(path);
  if (tourToken) {
    const run = parseTourRunFromUrl(path);
    return run ? `/t/${tourToken}?r=${run}` : `/t/${tourToken}`;
  }
  return isLegacyTableInviteUrl(path) ? '/party-live' : path;
}
