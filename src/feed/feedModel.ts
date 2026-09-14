import type { PublishedNight } from '@/data/nightsClient';
import { intlLocale, shotCountLabel, softDrinkCountLabel, t, wineCountLabel } from '@/i18n';

const ROUTE_VISIBLE_NAME_BUDGET = 34;

export interface FeedFact {
  label: string;
  value: string;
}

export interface FeedNightRoute {
  accessibilityLabel: string;
  city: string | null;
  next: string | null;
  skipped: number;
  last: string | null;
}

/** Prefer a handle in social UI, then the display name, then a neutral fallback. */
export function feedAuthorLabel(night: PublishedNight): string {
  if (night.author.nickname) return `@${night.author.nickname}`;
  return night.author.displayName || t.vycep.anonymousAuthor;
}

/** The published-night API has no user-authored title. Lead with a real pub when present. */
export function feedNightTitle(night: PublishedNight): string {
  return night.pubNames[0]?.trim() || t.feed.nightTitleFallback;
}

export function feedNightRoute(night: PublishedNight): FeedNightRoute | null {
  const pubs = night.pubNames.map((name) => name.trim()).filter(Boolean);
  if (pubs.length === 0) {
    const city = night.city.trim();
    return city
      ? { accessibilityLabel: city, city, next: null, skipped: 0, last: null }
      : null;
  }
  if (pubs.length === 1) return null;

  const next = pubs[1];
  if (pubs.length === 2) {
    return {
      accessibilityLabel: pubs.join(', '),
      city: null,
      next,
      skipped: 0,
      last: null,
    };
  }

  const last = pubs[pubs.length - 1];
  const nextFits = next.length + last.length <= ROUTE_VISIBLE_NAME_BUDGET;
  return {
    accessibilityLabel: pubs.join(', '),
    city: null,
    next: nextFits ? next : null,
    skipped: nextFits ? pubs.length - 3 : pubs.length - 2,
    last,
  };
}

export function feedDuration(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Only facts carried by PublishedNight are eligible for the card. */
export function feedFacts(night: PublishedNight): FeedFact[] {
  const facts: FeedFact[] = [{ label: t.feed.factBeers, value: String(night.beerCount) }];
  const duration = feedDuration(night.durationMinutes);
  if (duration) facts.push({ label: t.feed.factNight, value: duration });
  return facts;
}

/** Mixed drinks are factual metadata, never silently folded into the beer number. */
export function feedOtherDrinks(night: PublishedNight): string | null {
  const parts = [
    night.wineCount > 0 ? wineCountLabel(night.wineCount) : null,
    night.shotCount > 0 ? shotCountLabel(night.shotCount) : null,
    night.softDrinkCount > 0 ? softDrinkCountLabel(night.softDrinkCount) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** A day without a year ("12. 7." / "12 Jul"), or with one when it is not this year. */
function shortDate(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat(intlLocale, {
    day: 'numeric',
    month: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(date);
}

/** Humanised from server timestamps/day only; no guessed live state. */
export function feedWhen(night: PublishedNight, now: Date = new Date()): string {
  const instantRaw = night.endedAt || night.startedAt || night.createdAt;
  const instant = instantRaw ? new Date(instantRaw) : null;
  const drinkingDate = dateFromKey(night.drinkingDay);
  const today = dateFromKey(dateKey(now));

  let dayLabel = '';
  // Only "today" and "yesterday" get a clock time hung off them, so the branch
  // is tracked as a flag instead of comparing the rendered word.
  let relativeDay = false;
  if (drinkingDate && today) {
    const days = Math.round((today.getTime() - drinkingDate.getTime()) / 86_400_000);
    if (days <= 0) {
      dayLabel = t.relativeTime.todayShort;
      relativeDay = true;
    } else if (days === 1) {
      dayLabel = t.relativeTime.yesterday;
      relativeDay = true;
    } else {
      dayLabel = shortDate(drinkingDate, drinkingDate.getFullYear() !== today.getFullYear());
    }
  }

  if (!instant || Number.isNaN(instant.getTime())) return dayLabel || t.feed.published;
  if (relativeDay) {
    const time = `${String(instant.getHours()).padStart(2, '0')}:${String(instant.getMinutes()).padStart(2, '0')}`;
    return `${dayLabel} ${time}`;
  }
  return dayLabel || shortDate(instant, false);
}

/** Append a page without duplicating a night already present. */
export function mergeNightPages(
  current: readonly PublishedNight[],
  incoming: readonly PublishedNight[],
): PublishedNight[] {
  const seen = new Set(current.map((night) => night.id));
  return [...current, ...incoming.filter((night) => night.id && !seen.has(night.id))];
}

export function replaceNightReaction(
  nights: readonly PublishedNight[],
  nightId: string,
  rounds: number,
  myRound: boolean,
): PublishedNight[] {
  return nights.map((night) =>
    night.id === nightId
      ? { ...night, rounds: Math.max(0, rounds), myRound }
      : night,
  );
}
