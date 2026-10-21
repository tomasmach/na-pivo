import { intlLocale, t } from '@/i18n';
import { daysUntilHoliday, type BadgeKey, type BadgeState } from '@/profile/badgeModel';

type TieredKey = keyof typeof t.badges.unit;

const ROMAN = ['I', 'II', 'III', 'IV'];

export const roman = (tier: number) => ROMAN[tier - 1] ?? String(tier);

/** "Poutník II"; a locked family is just "Poutník", a hidden secret is "Tajné". */
export function badgeName(state: BadgeState, tier = state.tier): string {
  if (state.secret && state.tier === 0) return t.badges.secretName;
  const name = t.badges.names[state.key];
  return state.kind === 'tiered' && tier > 0 ? `${name} ${roman(tier)}` : name;
}

/** "47 hospod" for a family's own count. */
export function badgeAmount(key: BadgeKey, n: number): string {
  return `${n.toLocaleString(intlLocale)} ${t.badges.unit[key as TieredKey](n)}`;
}

/** "Ještě 3 hospody" toward the next level; volume badges never count down. */
export function stillLine(state: BadgeState): string | null {
  if (state.kind !== 'tiered' || state.volume || state.next == null) return null;
  return t.badges.still(badgeAmount(state.key, state.next - state.value));
}

/** The one short line under a medal in the grid. */
export function cellStatus(state: BadgeState, now: Date): string {
  if (state.kind === 'tiered') {
    if (state.volume) return badgeAmount(state.key, state.value);
    return state.next == null ? t.badges.done : `${state.value}/${state.next}`;
  }
  if (state.kind === 'slots') {
    return state.tier > 0 ? t.badges.done : `${state.value}/${state.tiers[0]}`;
  }
  if (state.tier > 0) return t.badges.earned;
  if (state.secret) return t.badges.secretStatus;
  if (state.holiday) return t.badges.inDays(daysUntilHoliday(state.holiday, now));
  return t.badges.locked;
}

export function badgeA11y(state: BadgeState, now: Date, isNew = false): string {
  return [
    badgeName(state),
    state.tier > 0 ? t.badges.a11yEarned : t.badges.a11yLocked,
    isNew ? t.badges.a11yNew : null,
    stillLine(state) ?? (state.kind === 'once' && state.tier > 0 ? null : cellStatus(state, now)),
  ]
    .filter(Boolean)
    .join(', ');
}
