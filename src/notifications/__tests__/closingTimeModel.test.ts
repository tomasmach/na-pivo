import { planClosingReminder, type ClosingCandidate } from '../closingTimeModel';

const NOW = Date.parse('2026-11-06T20:00:00Z');
const iso = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const openUntil = (minutes: number | null) => ({
  status: 'ok' as const,
  isOpenNow: true,
  nextChange: minutes === null ? null : iso(minutes),
});

function candidate(name: string, distanceMeters: number, hours: Partial<ClosingCandidate>): ClosingCandidate {
  return { key: name, name, lat: 50, lng: 14, distanceMeters, ...openUntil(300), ...hours };
}

it('rings an hour before closing with the three nearest pubs open at least 30 minutes longer', () => {
  const plan = planClosingReminder({
    nowMs: NOW,
    current: openUntil(180),
    candidates: [
      candidate('far', 900, openUntil(300)),
      candidate('closes-same-time', 50, openUntil(180)),
      candidate('closes-20-later', 60, openUntil(200)),
      candidate('closed-now', 70, { isOpenNow: false, nextChange: iso(30) }),
      candidate('unknown', 80, { status: 'pending', isOpenNow: null, nextChange: null }),
      candidate('nonstop', 400, openUntil(null)),
      candidate('closes-30-later', 300, openUntil(210)),
      candidate('near', 100, openUntil(240)),
    ],
  });

  expect(plan?.closesAtMs).toBe(NOW + 180 * 60_000);
  expect(plan?.fireAtMs).toBe(NOW + 120 * 60_000);
  expect(plan?.alternatives.map((pub) => pub.name)).toEqual(['near', 'closes-30-later', 'nonstop']);
});

it('rings right away when the evening starts within the last hour', () => {
  const plan = planClosingReminder({ nowMs: NOW, current: openUntil(40), candidates: [candidate('a', 100, {})] });
  expect(plan?.fireAtMs).toBe(NOW);
});

it.each([
  ['the pub closes in under 15 minutes', openUntil(10)],
  ['the closing time is not tonight', openUntil(20 * 60)],
  ['the pub is open around the clock', openUntil(null)],
  ['the hours are unknown', { status: 'unknown' as const, isOpenNow: null, nextChange: null }],
  ['the pub is already closed', { status: 'ok' as const, isOpenNow: false, nextChange: iso(600) }],
])('stays quiet when %s', (_case, current) => {
  expect(planClosingReminder({ nowMs: NOW, current, candidates: [candidate('a', 100, {})] })).toBeNull();
});

it('stays quiet when nothing nearby is open longer', () => {
  const plan = planClosingReminder({
    nowMs: NOW,
    current: openUntil(120),
    candidates: [candidate('a', 100, openUntil(130))],
  });
  expect(plan).toBeNull();
});
