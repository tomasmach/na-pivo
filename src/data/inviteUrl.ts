import { JOIN_CODE_LENGTH } from './joinCode';

export function parseFriendInviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const custom = /^napivo:\/\/parta\/pozvanka(?:[?#]|$)/i.test(url);
  const query = custom ? /[?&]code=([^&#\s]+)/.exec(url) : null;
  if (query?.[1]) {
    try {
      const decoded = decodeURIComponent(query[1]).trim();
      return decoded.length > 0 ? decoded : null;
    } catch {
      return null;
    }
  }
  const path = /^https:\/\/na-pivo\.cz\/p\/([A-Za-z0-9_-]+)\/?(?:[?#][^\s]*)?$/i.exec(url);
  return path?.[1]?.trim() || null;
}

function validJoinCode(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    if (!new RegExp(`^[A-Z2-9]{${JOIN_CODE_LENGTH}}$`, 'i').test(decoded)) return null;
    return decoded.toUpperCase();
  } catch {
    return null;
  }
}

export function parsePartyInviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (/^napivo:\/\/party-live(?:[?#]|$)/i.test(url)) {
    const query = /[?&]code=([^&#\s]+)/.exec(url);
    return query?.[1] ? validJoinCode(query[1]) : null;
  }
  const path = /^https:\/\/na-pivo\.cz\/party\/([^/?#\s]+)\/?(?:[?#][^\s]*)?$/i.exec(url);
  return path?.[1] ? validJoinCode(path[1]) : null;
}
