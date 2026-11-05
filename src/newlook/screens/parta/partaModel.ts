import { intlLocale, t } from '@/i18n';
import type { FriendProfile, FriendPubActivity, FriendsDashboard } from '@/data/friendsClient';
import type { PartaPlan } from '@/data/partaPlansClient';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pub pings ("cinknutí") sent without a place kind, by released apps or by "Svolat partu",
 * reach Parta only through the friends dashboard. They become plan rows here so they can
 * be answered and ended like any other invitation. New-look invitations are already in `plans`.
 */
export function livePingPlans(
  dashboard: Pick<FriendsDashboard, 'activeFriends' | 'myActiveActivity'>,
  plans: readonly Pick<PartaPlan, 'id'>[],
  now = Date.now(),
): PartaPlan[] {
  const known = new Set(plans.map((plan) => plan.id));
  const rows = [
    ...(dashboard.myActiveActivity ? [{ activity: dashboard.myActiveActivity, isMine: true }] : []),
    ...dashboard.activeFriends.map((activity) => ({ activity, isMine: false })),
  ];
  return rows
    .filter(({ activity }) => activity.id && activity.active && !known.has(activity.id) && Date.parse(activity.expiresAt) > now)
    .filter(({ activity }, i, all) => all.findIndex((row) => row.activity.id === activity.id) === i)
    .map(({ activity, isMine }: { activity: FriendPubActivity; isMine: boolean }) => ({
      ...activity,
      placeKind: 'pub',
      address: '',
      lat: null,
      lng: null,
      isMine,
      inviteeCount: null,
      inviteUrl: null,
    }));
}

/** Soonest first, as the plans list comes from the server. */
export function byPlanTime(a: PartaPlan, b: PartaPlan): number {
  return Date.parse(a.scheduledFor || a.startedAt) - Date.parse(b.scheduledFor || b.startedAt);
}

/** How the new look names people: the name they chose, else their handle. */
export function personName(profile: Pick<FriendProfile, 'displayName' | 'nickname'> | null | undefined): string {
  if (!profile) return '?';
  if (profile.displayName.trim()) return profile.displayName.trim();
  return profile.nickname ? `@${profile.nickname}` : '?';
}

export function personInitial(profile: Pick<FriendProfile, 'displayName' | 'nickname'> | null | undefined): string {
  const source = profile?.displayName.trim() || profile?.nickname || '?';
  return source.slice(0, 1).toLocaleUpperCase(intlLocale);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase(intlLocale) + text.slice(1) : text;
}

export function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })
    : '';
}

/** Day number, day name ("Zítra, sobota") and time for a ticket. */
export function ticketDay(iso: string, now = new Date()): { dayNum: string; dayName: string; time: string } {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return { dayNum: '', dayName: '', time: '' };
  const weekday = date.toLocaleDateString(intlLocale, { weekday: 'long' });
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  const dayName = days === 0 ? t.nv.parta.dayToday(weekday) : days === 1 ? t.nv.parta.dayTomorrow(weekday) : capitalize(weekday);
  return { dayNum: String(date.getDate()), dayName, time: clock(iso) };
}

/** "Ne 1. 11." */
export function shortDay(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const weekday = capitalize(date.toLocaleDateString(intlLocale, { weekday: 'short' }).replace('.', ''));
  return `${weekday} ${date.getDate()}. ${date.getMonth() + 1}.`;
}

export function planTime(plan: Pick<PartaPlan, 'scheduledFor' | 'startedAt'>): string {
  return plan.scheduledFor || plan.startedAt;
}

/** What a plan is called on a ticket: the pub, or whose home it is. */
export function planTitle(plan: PartaPlan): string {
  if (plan.placeKind !== 'home') return plan.name;
  return plan.isMine ? t.nv.parta.homePlaceMine : t.nv.parta.homePlace(personName(plan.account));
}

/** "Naposledy včera · U Vystřelenýho oka" from the shared-evening stats. */
export function lastTogetherLabel(lastSharedAt: string | null, pubName: string, now = new Date()): string {
  if (!lastSharedAt) return t.nv.parta.neverTogether;
  const date = new Date(lastSharedAt);
  if (!Number.isFinite(date.getTime())) return t.nv.parta.neverTogether;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  const when =
    days <= 0
      ? t.nv.parta.today
      : days === 1
        ? t.nv.parta.yesterday
        : days < 7
          ? t.nv.parta.daysAgo(days)
          : days < 14
            ? t.nv.parta.lastWeek
            : `${date.getDate()}. ${date.getMonth() + 1}.`;
  return t.nv.parta.lastTogether(when, days < 7 ? pubName : '');
}

export function joinNames(profiles: FriendProfile[]): string {
  return profiles.map(personName).join(', ');
}
