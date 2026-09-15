import { isLegacyTableInviteUrl } from '@/data/inviteLinkRoutes';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return isLegacyTableInviteUrl(path) ? '/party-live' : path;
}
