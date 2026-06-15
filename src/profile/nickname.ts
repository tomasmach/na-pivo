/**
 * Client-side nickname validation — a mirror of the backend's authoritative
 * rules (`validate_nickname` / `check_nickname` in pubs/accounts.py) so the
 * onboarding + edit screens can give instant inline feedback before the
 * debounced availability call and the authoritative PATCH ever run.
 *
 * The backend stays the source of truth: a value this helper calls "valid" may
 * still come back 409 `nickname_taken` (race) or 400 `nickname_reserved` (the
 * reserved list drifts) — the UI treats the server response as final. This is
 * purely a UX accelerator, kept deliberately in lock-step with the locked spec:
 *   charset/length → reserved → taken (taken is server-only here).
 */

import { cs } from '@/i18n/cs';

/** Allowed characters + length, mirroring `^[a-zA-Z0-9_.]{3,20}$`. */
const NICKNAME_RE = /^[a-zA-Z0-9_.]+$/;
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 20;

/**
 * Reserved handles (lowercase compare) — a verbatim mirror of the backend's
 * `RESERVED_NICKNAMES` frozenset. Kept in sync with the locked spec.
 */
const RESERVED_NICKNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'root', 'superuser', 'mod', 'moderator', 'support',
  'help', 'staff', 'team', 'official', 'napivo', 'na-pivo', 'na_pivo', 'system',
  'api', 'www', 'me', 'null', 'none', 'undefined', 'anonymous', 'user',
  'account', 'settings', 'auth', 'login', 'register', 'privacy', 'terms',
  'about', 'contact', 'pivo', 'beer',
]);

/** Why a candidate nickname is not acceptable. Mirrors backend `reason` codes. */
export type NicknameReason = 'too_short' | 'too_long' | 'invalid' | 'reserved';

export type NicknameCheck =
  | { valid: true }
  | { valid: false; reason: NicknameReason };

/**
 * Run the local checks in the same order as the backend: length → charset →
 * dot rules → reserved. (Uniqueness — "taken" — is server-only.)
 */
export function checkNicknameLocal(raw: string): NicknameCheck {
  const value = raw.trim();
  if (value.length < NICKNAME_MIN) return { valid: false, reason: 'too_short' };
  if (value.length > NICKNAME_MAX) return { valid: false, reason: 'too_long' };
  if (!NICKNAME_RE.test(value)) return { valid: false, reason: 'invalid' };
  // No consecutive dots, no leading/trailing dot.
  if (value.includes('..') || value.startsWith('.') || value.endsWith('.')) {
    return { valid: false, reason: 'invalid' };
  }
  if (RESERVED_NICKNAMES.has(value.toLowerCase())) {
    return { valid: false, reason: 'reserved' };
  }
  return { valid: true };
}

/** Czech inline message for a local reason code. */
export function nicknameReasonMessage(reason: NicknameReason): string {
  switch (reason) {
    case 'too_short':
      return cs.profile.setup.nicknameTooShort;
    case 'too_long':
      return cs.profile.setup.nicknameTooLong;
    case 'reserved':
      return cs.profile.setup.nicknameReserved;
    case 'invalid':
    default:
      return cs.profile.setup.nicknameCharset;
  }
}

/**
 * Czech inline message for a server `reason`/`code`. Accepts both the
 * availability endpoint's bare reasons (`taken`, `too_short`, …) and the PATCH
 * error codes (`nickname_taken`, `nickname_too_short`, …) — the leading
 * `nickname_` is stripped before matching.
 */
export function nicknameServerReasonMessage(reason: string | undefined): string {
  const key = (reason ?? '').replace(/^nickname_/, '');
  switch (key) {
    case 'too_short':
      return cs.profile.setup.nicknameTooShort;
    case 'too_long':
      return cs.profile.setup.nicknameTooLong;
    case 'reserved':
      return cs.profile.setup.nicknameReserved;
    case 'taken':
      return cs.profile.setup.nicknameTaken;
    case 'invalid':
    default:
      return cs.profile.setup.nicknameInvalid;
  }
}
