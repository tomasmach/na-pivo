import type { BeerCheckIn } from '@/data/beerCheckinsClient';

/** Pending rows win until the server returns the same client id. */
export function mergeDiaryCheckIns(
  pending: BeerCheckIn[],
  remote: BeerCheckIn[],
): BeerCheckIn[] {
  const byClientId = new Map<string, BeerCheckIn>();
  for (const item of remote) byClientId.set(item.clientId || item.id, item);
  for (const item of pending) byClientId.set(item.clientId || item.id, item);
  return [...byClientId.values()].sort(
    (a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt),
  );
}
