/** Route-specific parsing for a six-character shared-table invite. */

import { cleanJoinCode, JOIN_CODE_LENGTH } from './joinCode';

function validJoinCode(raw: string): string | null {
  try {
    const code = cleanJoinCode(decodeURIComponent(raw));
    return code.length === JOIN_CODE_LENGTH ? code : null;
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
