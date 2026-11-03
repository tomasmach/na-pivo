import {
  isLegacyTableInviteUrl,
  parseAppUrl,
  parseInviteCodeFromUrl,
  parseTourRunFromUrl,
  parseTourTokenFromUrl,
} from '@/data/inviteLinkRoutes';
import { parsePubShareUrl } from '@/data/pubShareLink';

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** The new look's screens for the links the released apps already answer. */
function newLookPath(path: string): string | null {
  const tourToken = parseTourTokenFromUrl(path);
  if (tourToken) {
    const run = parseTourRunFromUrl(path);
    return `/nv/tour-verejna?${query(run ? { token: tourToken, r: run } : { token: tourToken })}`;
  }
  const inviteCode = parseInviteCodeFromUrl(path);
  if (inviteCode) return `/nv/pozvanka-do-party?${query({ code: inviteCode })}`;
  const pub = parsePubShareUrl(path);
  if (pub) return `/nv/hospoda/${pub.key}?${query({ name: pub.name, lat: String(pub.lat), lng: String(pub.lng) })}`;
  const parsed = parseAppUrl(path);
  const token = parsed?.url.searchParams.get('token');
  if (parsed && token && /^\/auth\/verify\/?$/.test(parsed.path)) return `/nv/vysledek?${query({ token })}`;
  if (parsed && token && /^\/auth\/reset\/?$/.test(parsed.path)) return `/nv/obnova-hesla?${query({ token })}`;
  return null;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return newLookPath(path) ?? (isLegacyTableInviteUrl(path) ? '/nv' : path);
}
