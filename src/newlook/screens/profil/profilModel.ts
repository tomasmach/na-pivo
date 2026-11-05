import { useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { accountXpProgress } from '@/data/accountXp';
import type { BadgeProgress } from '@/data/auth';
import type { RemoteStats } from '@/data/statsClient';
import { t } from '@/i18n';
import {
  BADGE_GROUPS,
  PUBLIC_BADGE_KEYS,
  badgeStates,
  withMapperCounters,
  type BadgeGroup,
  type BadgeKey,
  type BadgeState,
} from '@/profile/badgeModel';
import { badgeAmount, badgeName, cellStatus, stillLine } from '@/profile/badgeText';
import { selectIsPublic, selectIsSignedIn, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { drinkingDayKey, type TallySession } from '@/stores/tallyStore';

import type { IconName } from '../../components/Icon';
import { computeStats } from '../stamgast/statsData';

/** "Večer s partou" lives only in the new look, so it is not a BadgeKey of the old app. */
export type NvBadgeKey = BadgeKey | 'partyEvenings';

export interface NvBadge {
  key: NvBadgeKey;
  group: BadgeGroup;
  state: BadgeState;
  name: string;
  icon: IconName;
  status: string;
}

const PARTY_TIERS = [5, 10, 25, 50] as const;

const ICONS: Record<NvBadgeKey, IconName> = {
  beers: 'beer',
  pubs: 'map',
  regular: 'landmark',
  cities: 'globe',
  ratings: 'star',
  weeks: 'calendar-check',
  weekdays: 'calendar-days',
  months: 'calendar',
  tasted: 'flask-conical',
  softDrinks: 'beer-off',
  bottles: 'beer',
  cans: 'beer',
  friends: 'users',
  photos: 'camera',
  contest: 'trophy',
  partyEvenings: 'party-popper',
  mapped: 'map-pinned',
  firstMaps: 'map-pin-plus',
  completed: 'circle-check',
  facts: 'lightbulb',
  outsidePub: 'house',
  outdoors: 'tent',
  beerDay: 'hop',
  nightOwl: 'moon',
  christmasEve: 'trees',
  newYearsEve: 'sparkles',
  lunch: 'clock-3',
};

export function badgeIcon(key: NvBadgeKey): IconName {
  return ICONS[key];
}

function partyState(progress: BadgeProgress): BadgeState {
  const value = progress.partyEvenings ?? 0;
  const tier = PARTY_TIERS.filter((threshold) => value >= threshold).length;
  return {
    // The old badge helpers only read `key` for names and units; this one has its own copy.
    key: 'friends',
    group: 'social',
    kind: 'tiered',
    tier,
    tiers: PARTY_TIERS,
    value,
    next: PARTY_TIERS[tier] ?? null,
    volume: false,
    secret: false,
  };
}

export function nvBadgeName(badge: Pick<NvBadge, 'key' | 'state'>, tier = badge.state.tier): string {
  if (badge.key !== 'partyEvenings') return badgeName(badge.state, tier);
  const roman = ['I', 'II', 'III', 'IV'][tier - 1];
  return roman ? `${t.nv.profil.badges.partyName} ${roman}` : t.nv.profil.badges.partyName;
}

export function nvStillLine(badge: NvBadge): string | null {
  if (badge.key !== 'partyEvenings') return stillLine(badge.state);
  const { next, value } = badge.state;
  if (next == null) return null;
  const left = next - value;
  return t.badges.still(`${left} ${t.nv.profil.badges.partyUnit(left)}`);
}

export function nvBadgeAbout(badge: NvBadge): string {
  return badge.key === 'partyEvenings' ? t.nv.profil.badges.partyAbout : t.badges.about[badge.key];
}

export function nvBadgeAmount(badge: NvBadge, n: number): string {
  return badge.key === 'partyEvenings'
    ? `${n} ${t.nv.profil.badges.partyUnit(n)}`
    : badgeAmount(badge.key, n);
}

export function isPublicBadge(key: NvBadgeKey): boolean {
  return key !== 'partyEvenings' && PUBLIC_BADGE_KEYS.has(key);
}

export function buildNvBadges(progress: BadgeProgress, now: Date): NvBadge[] {
  const states = badgeStates(progress);
  const party = partyState(progress);
  const list: NvBadge[] = [];
  for (const state of states) {
    list.push({ key: state.key, group: state.group, state, name: badgeName(state), icon: ICONS[state.key], status: cellStatus(state, now) });
    if (state.key === 'contest') {
      const badge: NvBadge = { key: 'partyEvenings', group: 'social', state: party, name: '', icon: ICONS.partyEvenings, status: '' };
      badge.name = nvBadgeName(badge);
      badge.status = party.next == null ? t.badges.done : `${party.value}/${party.next}`;
      list.push(badge);
    }
  }
  return list;
}

export function groupBadges(badges: NvBadge[]): { group: BadgeGroup; title: string; items: NvBadge[] }[] {
  return BADGE_GROUPS.map((group) => ({
    group,
    title: t.badges.groups[group],
    items: badges.filter((badge) => badge.group === group),
  })).filter((section) => section.items.length > 0);
}

/** The closest next level worth chasing, as the old collection picks it. */
export function nextGoal(badges: NvBadge[]): NvBadge | null {
  return (
    badges
      .filter((badge) => badge.state.kind === 'tiered' && !badge.state.volume && badge.state.next != null)
      .map((badge, index) => ({ badge, index, share: badge.state.value / (badge.state.next as number) }))
      .sort((a, b) => b.share - a.share || a.index - b.index)[0]?.badge ?? null
  );
}

/** The medal one night unlocked, or else the next level it brought closest. */
export function nightBadge(before: BadgeProgress, after: BadgeProgress, now = new Date()): { badge: NvBadge; earned: boolean } | null {
  const was = new Map(buildNvBadges(before, now).map((badge) => [badge.key, badge.state]));
  const badges = buildNvBadges(after, now);
  const earned = badges.find((badge) => badge.state.tier > (was.get(badge.key)?.tier ?? 0));
  if (earned) return { badge: earned, earned: true };
  const moved = nextGoal(badges.filter((badge) => badge.state.value > (was.get(badge.key)?.value ?? 0)));
  return moved ? { badge: moved, earned: false } : null;
}

/** Every badge of this account, or null before a backend sent values. */
export function useNvBadges(): NvBadge[] | null {
  const profile = useAccountStore((s) => s.profile);
  return useMemo(
    () => (profile?.badgeProgress ? buildNvBadges(withMapperCounters(profile.badgeProgress, profile.mapper), new Date()) : null),
    [profile],
  );
}

/** A medal went up since its sheet was last opened; drives the header dot. */
export function useUnopenedBadges(): readonly BadgeKey[] {
  const accountId = useAccountStore((s) => s.profile?.id ?? null);
  return useBadgeStore((s) => (accountId != null && s.accountId === accountId ? s.unopened : NONE));
}
const NONE: readonly BadgeKey[] = [];

export function markBadgeOpened(key: NvBadgeKey): void {
  if (key === 'partyEvenings') return;
  const store = useBadgeStore.getState();
  if (!store.unopened.includes(key)) return;
  store.open(key);
  store.close();
}

/** Nights and beers per night on the profile, counted the same way as Čísla so both screens agree. */
export function profileNights(sessions: readonly TallySession[], remote: RemoteStats | null, now = new Date()): { nights: number; average: number } {
  const stats = computeStats(sessions, remote, now, drinkingDayKey);
  return { nights: stats.nights, average: stats.average };
}

/** Who I am in the header and on the profile. */
export function useMe() {
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const profile = useAccountStore((s) => s.profile);
  const nickname = useAccountStore(selectNickname);
  const isPublic = useAccountStore(selectIsPublic);
  const xp = useMemo(() => accountXpProgress(profile?.mapper, profile?.pivar), [profile?.mapper, profile?.pivar]);
  const nick = nickname?.trim() || '';
  const displayName = profile?.displayName?.trim() || '';
  const label = nick || displayName;
  const progress =
    isSignedIn && xp ? (xp.xpForNextLevel ? xp.xpIntoLevel / xp.xpForNextLevel : 1) : 0;
  return {
    isSignedIn,
    profile,
    nick,
    displayName,
    isPublic,
    initial: (label[0] ?? '').toLocaleUpperCase(),
    avatarUrl: isSignedIn ? (profile?.avatarUrl ?? null) : null,
    xp: isSignedIn ? xp : null,
    progress,
  };
}

const LEVEL_SEEN_KEY = 'na-pivo-nv-level-seen';

interface LevelSeen {
  accountId: string;
  level: number;
  at: string;
}

/**
 * Remembers the last level the account was shown. Returns the time the
 * previous level was seen when the level went up since, so the level-up sheet
 * can list what earned it; null on the first observation or no change.
 */
export async function observeLevel(accountId: string, level: number): Promise<{ since: string } | null> {
  let seen: LevelSeen | null = null;
  try {
    const raw = await AsyncStorage.getItem(LEVEL_SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<LevelSeen>) : null;
    if (parsed && typeof parsed.accountId === 'string' && typeof parsed.level === 'number' && typeof parsed.at === 'string') {
      seen = parsed as LevelSeen;
    }
  } catch {
    seen = null;
  }
  if (seen && seen.accountId === accountId && seen.level >= level) return null;
  try {
    await AsyncStorage.setItem(LEVEL_SEEN_KEY, JSON.stringify({ accountId, level, at: new Date().toISOString() }));
  } catch {
    // Best effort: a failed write shows the level-up once more.
  }
  return seen && seen.accountId === accountId ? { since: seen.at } : null;
}
