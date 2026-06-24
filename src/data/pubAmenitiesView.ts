/**
 * "Zmapuj hospodu" render overlay — the PURE function that merges the cached
 * server aggregate, the user's own synced vote, and any local pending vote into
 * the rows the sheet renders. Never persisted, never sent over the wire (spec
 * §4.6): the only place the two stores-of-truth (the user's own votes vs the
 * public aggregate) come together is at render time, here.
 *
 * The merge rules are the locked contract from spec §3.3:
 *   - The user's OWN answer wins for them and overlays the aggregate EXACTLY.
 *     The aggregate carries `my_value`, so there is NO ±1 heuristic — the crowd
 *     counts render verbatim and the user's contribution is shown via the pill
 *     state (myValue), not by mutating the tally (which would drift offline).
 *   - A LOCAL pending vote (from pubAmenitiesStore) shows optimistically and
 *     overrides the server's `my_value` (the local tap is always the freshest
 *     truth for the tapping user).
 *   - We NEVER fabricate a "0× ano" for an unmapped amenity: when no aggregate
 *     snapshot has resolved yet the signal is `loading`; only a confirmed
 *     zero-vote aggregate renders as `unmapped`.
 *
 * Pure + unit-testable: it takes plain inputs (the catalogue is module-bundled)
 * and returns plain rows + a completeness summary. No store/React access.
 */

import {
  AMENITIES,
  type AmenityDef,
  type AmenityGroup,
} from './amenities';
import type { WireAmenityAggregate } from './pubAmenitiesClient';
import type { AmenityVote, PubAmenityVotes } from '@/stores/pubAmenitiesStore';

/**
 * The community-signal state for one row. Distinct from the user's own vote —
 * the spec is explicit that "loading" must never collapse into "unmapped".
 *   - `loading`  : no aggregate snapshot has resolved yet (backend dormant /
 *                  first open / failed fetch). Render just the control, no count.
 *   - `known`    : a resolved aggregate with at least one vote (or a non-unknown
 *                  status). Render "{yes}× ano · {no}× ne" / "lidi se neshodnou".
 *   - `unmapped` : a resolved aggregate that confirmed zero votes. Render
 *                  "nezmapováno".
 */
export type AmenitySignalState = 'loading' | 'known' | 'unmapped';

/** The aggregated public verdict, mirrored from the wire. */
export type AmenityStatus = 'yes' | 'no' | 'disputed' | 'unknown';

/** One fully-merged render row for the sheet. */
export interface AmenityRow {
  amenityKey: string;
  label: string;
  shortLabel: string;
  /** IconGlyph export name (resolved to a component by the sheet). */
  icon: string;
  group: AmenityGroup;
  /**
   * The tapping user's own answer: 'yes' | 'no' (drives the pill state + the
   * leading-icon amber tint) or null when they have not voted. A local pending
   * vote wins over the server's `my_value`.
   */
  myValue: AmenityVote | null;
  /** Crowd counts, verbatim from the aggregate (0 while loading). */
  yesCount: number;
  noCount: number;
  /** The aggregated public verdict ('unknown' while loading). */
  status: AmenityStatus;
  /** Whether the community signal is loading / known / genuinely unmapped. */
  signalState: AmenitySignalState;
}

/** Per-pub completeness summary for the header ring + personal sub-line. */
export interface AmenityCompletenessView {
  /** Distinct active amenities the crowd has resolved (status != unknown). */
  mappedCount: number;
  /** Active amenity count = the completeness denominator. */
  totalKinds: number;
  /** mappedCount / totalKinds, 0..1, clamped. */
  pct: number;
}

/**
 * Inputs the sheet hands to the overlay. `aggregates` is `undefined` when no
 * snapshot has resolved (backend dormant / not yet fetched) — that is what makes
 * every row's signal `loading` instead of a fake `unmapped`.
 */
export interface BuildAmenityRowsInput {
  /** Cached server aggregates for this pub, or undefined when unresolved. */
  aggregates: WireAmenityAggregate[] | undefined;
  /** The user's own votes (pending + synced) from the store selector. */
  myVotes: PubAmenityVotes | undefined;
}

/** Index the aggregate array by amenity_key for O(1) row lookup. */
function indexAggregates(
  aggregates: WireAmenityAggregate[] | undefined,
): Map<string, WireAmenityAggregate> {
  const map = new Map<string, WireAmenityAggregate>();
  if (!aggregates) return map;
  for (const agg of aggregates) {
    if (agg && typeof agg.amenity_key === 'string') map.set(agg.amenity_key, agg);
  }
  return map;
}

/**
 * Decide the community-signal state for one amenity. `aggregatesResolved` is
 * false when the whole snapshot is still loading (undefined input) — in that
 * case every row is `loading`, never `unmapped` (spec §3.3: never misrepresent a
 * mapped pub as empty).
 */
function deriveSignalState(
  agg: WireAmenityAggregate | undefined,
  aggregatesResolved: boolean,
): AmenitySignalState {
  if (!aggregatesResolved) return 'loading';
  if (!agg) return 'unmapped';
  if (agg.yes_count > 0 || agg.no_count > 0 || agg.status !== 'unknown') return 'known';
  return 'unmapped';
}

/** Build one render row by merging a catalogue def, its aggregate, and the
 *  user's own (local-wins) vote. */
function buildRow(
  def: AmenityDef,
  agg: WireAmenityAggregate | undefined,
  localVote: AmenityVote | null,
  aggregatesResolved: boolean,
): AmenityRow {
  // Local pending/synced vote always wins for the tapping user; otherwise fall
  // back to the server's exact `my_value` overlay (no ±1 heuristic).
  const serverMyValue = agg?.my_value === 'yes' || agg?.my_value === 'no' ? agg.my_value : null;
  const myValue: AmenityVote | null = localVote ?? serverMyValue;

  return {
    amenityKey: def.key,
    label: def.label,
    shortLabel: def.shortLabel,
    icon: def.icon,
    group: def.group,
    myValue,
    yesCount: agg?.yes_count ?? 0,
    noCount: agg?.no_count ?? 0,
    status: agg?.status ?? 'unknown',
    signalState: deriveSignalState(agg, aggregatesResolved),
  };
}

/**
 * Build the full ordered list of render rows for the sheet — one per ACTIVE
 * amenity, in the catalogue's section/order. Pure: same inputs → same output.
 */
export function buildAmenityRows({ aggregates, myVotes }: BuildAmenityRowsInput): AmenityRow[] {
  const aggregatesResolved = aggregates !== undefined;
  const byKey = indexAggregates(aggregates);

  // AMENITIES is already ordered (payment → seating → games → atmosphere →
  // practical, ascending `order`), so a straight map preserves the section order
  // the sheet groups on.
  return AMENITIES.map((def) => {
    const local = myVotes?.[def.key];
    const localVote: AmenityVote | null = local ? local.vote : null;
    return buildRow(def, byKey.get(def.key), localVote, aggregatesResolved);
  });
}

/**
 * Completeness selector — the COMMUNITY meter for the header ring. An active
 * amenity counts as "mapped" once it has a non-unknown verdict — that means
 * EITHER the crowd has resolved it (`signalState === 'known'`) OR the tapping
 * user has just voted it (`myValue != null`), because their own vote alone makes
 * the amenity's status non-unknown. The denominator is the active amenity count.
 *
 * The ring is computed LOCALLY from the (already server-recomputed) rows so it
 * tracks every vote in the same round-trip — counting `myValue` also makes it
 * move instantly and offline, before/independent of the aggregate echoing back.
 * The optional `serverCompleteness` snapshot is ONLY a pre-resolution fallback:
 * it fills the ring during the very first load (before any aggregate has
 * resolved and before any local vote) so it isn't a flash of 0%. The moment any
 * row resolves or the user votes, the live local count takes over — which is why
 * a stale server snapshot can no longer freeze the ring after a vote.
 */
export function selectCompleteness(
  rows: AmenityRow[],
  serverCompleteness?: { mappedCount: number; totalKinds: number; pct: number } | null,
): AmenityCompletenessView {
  const totalKinds = rows.length;
  let mappedCount = 0;
  let anyResolved = false;
  for (const row of rows) {
    if (row.signalState !== 'loading') anyResolved = true;
    if (row.signalState === 'known' || row.myValue != null) mappedCount += 1;
  }

  // Initial load only: nothing has resolved and the user hasn't voted yet — show
  // the cached server snapshot instead of 0%. Once rows resolve or a vote lands,
  // mappedCount/anyResolved take over and the snapshot is ignored.
  if (
    !anyResolved &&
    mappedCount === 0 &&
    serverCompleteness &&
    typeof serverCompleteness.totalKinds === 'number' &&
    serverCompleteness.totalKinds > 0
  ) {
    const serverTotal = serverCompleteness.totalKinds;
    const serverMapped = clampInt(serverCompleteness.mappedCount, 0, serverTotal);
    const pct = clamp01(
      typeof serverCompleteness.pct === 'number'
        ? serverCompleteness.pct
        : serverMapped / serverTotal,
    );
    return { mappedCount: serverMapped, totalKinds: serverTotal, pct };
  }

  const pct = totalKinds > 0 ? mappedCount / totalKinds : 0;
  return { mappedCount, totalKinds, pct };
}

/**
 * The user's PERSONAL progress (the "ty jsi zmapoval/a {n} z {total}" sub-line).
 * Counts how many active amenities the user themselves has answered.
 */
export function selectPersonalProgress(rows: AmenityRow[]): { answered: number; total: number } {
  let answered = 0;
  for (const row of rows) {
    if (row.myValue != null) answered += 1;
  }
  return { answered, total: rows.length };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
