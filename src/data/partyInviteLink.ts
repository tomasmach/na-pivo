/** Route-specific parsing for a six-character shared-table invite. */

import { JOIN_CODE_LENGTH } from './joinCode';

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

  const path = /^https:\/\/na-pivo\.cz\/party\/([^/?#\s]+)(?:[/?#]|$)/i.exec(url);
  return path?.[1] ? validJoinCode(path[1]) : null;
}
