/**
 * The current account's slice of a shared NightRecord, for personal records.
 *
 * The recap itself is deliberately a table recap, but "osobní rekord" must be
 * compared with the phone owner's history only. This projection keeps only that
 * person's drinks and visits and measures their membership span, never the
 * host's whole table time. Legacy records without join/leave timestamps fall
 * back to the first and last personal diary row.
 */

import type { NightBest, NightRecord } from '@/party/nightRecord';

export function mergeConfirmedNightBest(
  local: NightBest,
  remote: { mostBeers: number; longestSeconds: number; mostStops: number },
): NightBest {
  return {
    beers: Math.max(local.beers, remote.mostBeers),
    minutes: Math.max(local.minutes, Math.round(remote.longestSeconds / 60)),
    stops: Math.max(local.stops, remote.mostStops),
  };
}

export function personalNightRecord(
  night: NightRecord,
  personId: string | undefined,
): NightRecord | null {
  if (!personId) return null;
  const person = night.people.find((candidate) => candidate.id === personId);
  if (!person) return null;

  const drinks = night.drinks
    .filter((drink) => drink.by === personId)
    .sort((a, b) => a.at.localeCompare(b.at));
  const referencedStopIds = new Set(
    drinks.flatMap((drink) => (drink.stopId ? [drink.stopId] : [])),
  );
  const stops = night.stops
    .filter(
      (stop) =>
        stop.by === personId || (stop.by === undefined && referencedStopIds.has(stop.id)),
    )
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt));

  const activity = [
    ...drinks.map((drink) => drink.at),
    ...stops.map((stop) => stop.arrivedAt),
  ].sort((a, b) => a.localeCompare(b));
  const starts = [person.joinedAt, ...activity].filter(
    (value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)),
  );
  if (starts.length === 0) return null;

  const startedAt = starts.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest,
  );
  const explicitEnd = person.leftAt ?? night.endedAt;
  const endedAt =
    explicitEnd &&
    Number.isFinite(Date.parse(explicitEnd)) &&
    Date.parse(explicitEnd) >= Date.parse(startedAt)
      ? explicitEnd
      : (activity.at(-1) ?? null);

  return {
    id: `${night.id}:${personId}`,
    code: night.code,
    startedAt,
    endedAt,
    people: [person],
    stops,
    drinks,
    games: [],
    photos: [],
  };
}
