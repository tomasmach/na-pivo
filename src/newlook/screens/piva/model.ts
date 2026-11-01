import * as Location from 'expo-location';

import { generateUuidV4 } from '@/data/account';
import type { BeerCheckIn, BeerCheckInInput, BeerCheckInVisibility, BeerTag } from '@/data/beerCheckinsClient';
import { enqueueBeerCheckInOp, getPendingBeerCheckIns } from '@/data/beerCheckinsQueue';
import type { BeerStyle, Position } from '@/data/beersClient';
import { intlLocale, t } from '@/i18n';
import { requestPushRegistration } from '@/notifications/friendPush';
import { syncBeerWatchLocation } from '@/beerWatch/beerWatchLocation';
import { useAccountStore } from '@/stores/accountStore';
import { findBeerWatch, useBeerWatchStore } from '@/stores/beerWatchStore';

import { toast } from '../../ui/store';

const oneDecimal = new Intl.NumberFormat(intlLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const grouped = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 });

export const fmtRating = (n: number) => oneDecimal.format(n);
export const fmtCount = (n: number) => grouped.format(n);

export function fmtDistance(meters: number): string {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${oneDecimal.format(meters / 1000)} km`;
}

/** Ranking filter chips, in the mock's order; null is "all". */
export const STYLE_FILTERS: (BeerStyle | null)[] = [null, 'lager', 'ten', 'craft', 'dark'];

export function styleFilterLabel(style: BeerStyle | null): string {
  return style ? t.nv.piva.filters[style] : t.nv.piva.filters.all;
}

/** "včera", "před 3 dny", a date further back. Reviews only carry the day. */
export function reviewDay(day: string, now = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return '';
  const then = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - then.getTime()) / 86_400_000);
  const r = t.nv.piva.review;
  if (days <= 0) return r.today;
  if (days === 1) return r.yesterday;
  if (days < 7) return r.daysAgo(days);
  if (days < 14) return r.lastWeek;
  return then.toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric', year: then.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

/** The last fix the phone already has; never asks for permission. */
export async function lastKnownPosition(): Promise<Position | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return null;
    const fix = await Location.getLastKnownPositionAsync();
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  }
}

function beerKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const sameBeer = (a: string, b: string) => beerKey(a) === beerKey(b);

// What this session saved per beer, so a second rating rewrites the same check-in
// and a screen shows it before the server history catches up.
const savedThisSession = new Map<string, BeerCheckInInput>();
const sessionKey = (beerName: string) => `${useAccountStore.getState().session?.accountId ?? ''}|${beerKey(beerName)}`;

export function savedRating(beerName: string): number | null {
  return savedThisSession.get(sessionKey(beerName))?.rating ?? null;
}

function sameDay(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function toInput(c: BeerCheckIn): BeerCheckInInput {
  return {
    clientId: c.clientId,
    beerName: c.beerName,
    breweryName: c.breweryName,
    beerStyle: c.beerStyle,
    abv: c.abv,
    quantity: c.quantity,
    priceCzk: c.priceCzk,
    rating: c.rating,
    note: c.note,
    tags: c.tags,
    pubCacheKey: c.pubCacheKey,
    pubName: c.pubName,
    pubCity: c.pubCity,
    visitClientId: c.visitClientId,
    visibility: c.visibility,
    checkedInAt: c.checkedInAt,
    endedAt: c.endedAt,
  };
}

/** My latest rated check-in of this beer, from the server history (newest first). */
export function myLatestRating(history: BeerCheckIn[]): BeerCheckIn | null {
  return history.find((c) => c.rating !== null) ?? null;
}

export interface RatingChange {
  rating: number;
  tags?: BeerTag[];
  note?: string;
  visibility?: BeerCheckInVisibility;
}

export interface RatingContext {
  beerName: string;
  breweryName?: string;
  /** My check-ins of this beer from the server, newest first. */
  history: BeerCheckIn[];
  /** Set when the rating belongs to a visit (receipt, nudge); a new check-in starts unless today's at that pub exists. */
  pub?: { cacheKey?: string; name: string; city?: string } | null;
}

/**
 * One rating per beer: rating again rewrites my latest check-in of it (the
 * same client id upserts, so the diary keeps one row). Without any check-in, or
 * for a new visit, it adds one. Queued, so it works offline.
 */
export async function saveBeerRating(ctx: RatingContext, change: RatingChange): Promise<BeerCheckInInput> {
  const now = new Date();
  const pending = (await getPendingBeerCheckIns()).filter((p) => sameBeer(p.beerName, ctx.beerName));
  const base: BeerCheckInInput | null =
    pending[pending.length - 1] ?? savedThisSession.get(sessionKey(ctx.beerName)) ?? (ctx.history[0] ? toInput(ctx.history[0]) : null);
  const reuse = base !== null && (!ctx.pub || (base.pubName === ctx.pub.name && sameDay(base.checkedInAt, now)));
  const payload: BeerCheckInInput = reuse
    ? {
        ...base,
        rating: change.rating,
        tags: change.tags ?? base.tags,
        note: change.note ?? base.note,
        visibility: change.visibility ?? base.visibility,
      }
    : {
        clientId: generateUuidV4(),
        beerName: ctx.beerName,
        breweryName: ctx.breweryName ?? '',
        rating: change.rating,
        tags: change.tags ?? [],
        note: change.note ?? '',
        pubCacheKey: ctx.pub?.cacheKey ?? '',
        pubName: ctx.pub?.name ?? '',
        pubCity: ctx.pub?.city ?? '',
        visibility: change.visibility ?? 'private',
        checkedInAt: now.toISOString(),
      };
  savedThisSession.set(sessionKey(ctx.beerName), payload);
  await enqueueBeerCheckInOp({ op: 'checkin', payload });
  return payload;
}

/** Watch or stop watching from the beer page, with the new look's toasts. */
export async function toggleWatch(beerName: string, breweryName?: string | null): Promise<void> {
  const store = useBeerWatchStore.getState();
  const existing = findBeerWatch(store.watches, beerName, breweryName);
  if (existing) {
    const ok = await store.unwatch(existing.productKey);
    toast(ok ? { kind: 'info', title: t.nv.piva.beer.unwatched, icon: 'bell-off' } : { kind: 'error', title: t.beerWatch.failedToast });
    return;
  }
  const result = await store.watch(beerName, breweryName);
  if (!result.ok) {
    const title =
      result.reason === 'unknown_beer' ? t.beerWatch.unknownBeerToast : result.reason === 'too_many' ? t.beerWatch.tooManyToast : t.beerWatch.failedToast;
    toast({ kind: 'error', title });
    return;
  }
  toast({ kind: 'saved', title: t.nv.piva.beer.watched, sub: t.nv.piva.beer.watchedSub, icon: 'bell-ring' });
  void syncBeerWatchLocation();
  await requestPushRegistration();
}
