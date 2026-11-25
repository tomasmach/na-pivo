
import { t, plural } from '@/i18n';
export function pubCount(n: number) {
  return `${n} ${plural(n, { cs: { one: 'hospoda', few: 'hospody', many: 'hospod' }, en: { one: 'pub', other: 'pubs' } })}`;
}
export function tourError(code: string | null | undefined) {
  if (!code) return null;
  const e = t.tours.errors;
  const publicErrors: Record<string, string> = {
    sign_in: e.publicSignIn, nickname: e.publicNickname, profile_private: e.publicPrivate, rules: e.publicRules,
    text_rejected: e.publicText, publication_hidden: e.publicHidden, unknown_pub: e.invalid, hidden_pub: e.invalid,
  };
  if (publicErrors[code]) return publicErrors[code];
  if (/storage|persist|corrupt/.test(code)) return e.storage;
  if (/date|time/.test(code)) return e.date;
  if (/duplicate/.test(code)) return e.duplicate;
  if (/stop.*limit|max_stops/.test(code)) return e.stopLimit;
  if (/limit/.test(code)) return e.limit;
  if (/session|owner|account_changed/.test(code)) return e.session;
  if (/auth|401/.test(code)) return e.auth;
  if (/invalid|validation|title|stops/.test(code)) return e.invalid;
  if (/not_found|unavailable/.test(code)) return e.unavailable;
  if (/conflict/.test(code)) return t.tours.conflict;
  return e.network;
}
