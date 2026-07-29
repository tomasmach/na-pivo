/**
 * Folding beer check-ins into the automatic Výčep feed.
 *
 * Two feeds used to run down the Parta screen side by side: the ratings people
 * wrote by hand, and nothing else — there was no automatic history at all. Now
 * that the sittings exist, a rating is not a separate event. It is a note
 * somebody left about a beer they drank *during* one of those evenings, and it
 * belongs on that evening's row.
 *
 * So: attach every check-in to the sitting it happened in, and give the ones
 * that match nothing a sitting of their own (a beer logged straight from the
 * diary, with no counter session behind it, still deserves to show up).
 *
 * Pure and unit-tested. Matching is deliberately forgiving about the pub —
 * a check-in typed at the bar carries the cache key, one typed the next morning
 * often does not — but strict about the person and the day, because those are
 * the two things a wrong guess would actually libel somebody over.
 */

import type { BeerCheckIn } from '@/data/beerCheckinsClient';
import type { PartaFeedSitting } from '@/data/partaFeedClient';

/** A sitting plus whatever anyone wrote about the beers in it. */
export interface MergedSitting {
  sitting: PartaFeedSitting;
  checkIns: BeerCheckIn[];
}

/** Grace either side of a sitting: last orders are rarely the last check-in. */
const ATTACH_SLACK_MS = 2 * 3_600_000;

function time(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function belongsTo(checkIn: BeerCheckIn, sitting: PartaFeedSitting): boolean {
  if (!checkIn.account.id || checkIn.account.id !== sitting.account.id) return false;

  const at = time(checkIn.checkedInAt);
  if (at === 0) return false;
  const from = time(sitting.startedAt) - ATTACH_SLACK_MS;
  const to = time(sitting.endedAt || sitting.startedAt) + ATTACH_SLACK_MS;
  if (at < from || at > to) return false;

  // Same pub wins outright. A check-in with no pub at all falls back to the
  // time window, which is what a beer typed up after the fact looks like.
  if (checkIn.pubCacheKey && sitting.cacheKey) return checkIn.pubCacheKey === sitting.cacheKey;
  return true;
}

/** Turn a check-in nothing matched into a one-drink sitting of its own. */
function sittingFromCheckIn(checkIn: BeerCheckIn, mine: boolean): PartaFeedSitting {
  const count = Math.max(1, Math.floor(checkIn.quantity || 1));
  return {
    id: `checkin:${checkIn.id}`,
    account: checkIn.account,
    mine,
    placeContext: checkIn.pubName || checkIn.pubCacheKey ? 'pub' : 'other',
    pubName: checkIn.pubName,
    pubCity: checkIn.pubCity,
    cacheKey: checkIn.pubCacheKey,
    lat: null,
    lng: null,
    startedAt: checkIn.checkedInAt,
    endedAt: checkIn.endedAt || checkIn.checkedInAt,
    total: count,
    items: [
      {
        drinkType: 'beer',
        // A check-in never records how it was poured, and guessing "draft"
        // would silently print "6 piv" over what was a crate of bottles.
        servingType: 'unknown',
        name: checkIn.beerName,
        count,
      },
    ],
  };
}

/**
 * Merge both feeds into one chronological stream, newest first.
 *
 * `myAccountId` only decides which rows say "Ty" — the caller already knows
 * which sittings are its own from the server.
 */
export function mergeCheckInsIntoFeed(
  sittings: PartaFeedSitting[],
  checkIns: BeerCheckIn[],
  myAccountId?: string | null,
): MergedSitting[] {
  const merged: MergedSitting[] = sittings.map((sitting) => ({ sitting, checkIns: [] }));
  const orphans: BeerCheckIn[] = [];

  for (const checkIn of checkIns) {
    // Newest sitting first, so a beer that lands in the overlap between two
    // evenings joins the later one — which is the one it was drunk in.
    const host = merged.find((row) => belongsTo(checkIn, row.sitting));
    if (host) host.checkIns.push(checkIn);
    else orphans.push(checkIn);
  }

  for (const row of merged) {
    row.checkIns.sort((a, b) => time(b.checkedInAt) - time(a.checkedInAt));
  }

  for (const checkIn of orphans) {
    const mine = !!myAccountId && checkIn.account.id === myAccountId;
    merged.push({ sitting: sittingFromCheckIn(checkIn, mine), checkIns: [checkIn] });
  }

  return merged.sort(
    (a, b) =>
      time(b.sitting.endedAt || b.sitting.startedAt) -
      time(a.sitting.endedAt || a.sitting.startedAt),
  );
}
