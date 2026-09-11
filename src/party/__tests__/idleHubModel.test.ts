import {
  firstDrinkTap,
  idleBeerCount,
  lastArchivedSession,
  primaryTapAction,
} from '@/party/idleHubModel';
import type { TallySession } from '@/stores/tallyStore';

const session = (startedAt: string, drinks: number): TallySession => ({
  clientId: startedAt,
  pubKey: 'u2fkbnyx',
  pubName: 'U Kotvy',
  startedAt,
  drinks: Array.from({ length: drinks }, (_, i) => ({
    id: `${startedAt}-${i}`,
    beerName: 'Plzeň',
    at: startedAt,
  })) as TallySession['drinks'],
});

describe('idle hub model', () => {
  describe('what the first-beer button pours', () => {
    it("names the pub's first mapped tap", () => {
      expect(
        firstDrinkTap(
          [
            { name: 'Pilsner Urquell 12°', priceCzk: 60 },
            { name: 'Kozel 11°', priceCzk: 45 },
          ],
          'Pivo',
        ),
      ).toEqual({ name: 'Pilsner Urquell 12°', priceCzk: 60 });
    });

    it('prefers the mapped tap over the stored house beer, which arrives first and generic', () => {
      expect(firstDrinkTap([{ name: 'Kozel 11°', priceCzk: 45 }], 'Pivo')).toEqual({
        name: 'Kozel 11°',
        priceCzk: 45,
      });
    });

    it('keeps the plain beer, without a price, at an unmapped pub', () => {
      expect(firstDrinkTap([], 'Pivo')).toEqual({ name: 'Pivo', priceCzk: null });
    });
  });

  describe('the number before the night', () => {
    it('is zero with no open session at all', () => {
      expect(idleBeerCount(null, [], new Date('2026-08-27T21:00:00+02:00'))).toBe(0);
    });

    it("counts tonight's beers when the hub reopens without a running night", () => {
      expect(
        idleBeerCount(
          session('2026-08-27T19:00:00+02:00', 3),
          [],
          new Date('2026-08-27T23:30:00+02:00'),
        ),
      ).toBe(3);
    });

    it('still counts them after midnight, before the 04:00 cutoff', () => {
      expect(
        idleBeerCount(
          session('2026-08-27T22:00:00+02:00', 2),
          [],
          new Date('2026-08-28T01:30:00+02:00'),
        ),
      ).toBe(2);
    });

    it("does not carry yesterday's session into tonight", () => {
      expect(
        idleBeerCount(
          session('2026-08-26T19:00:00+02:00', 4),
          [],
          new Date('2026-08-27T19:00:00+02:00'),
        ),
      ).toBe(0);
    });

    it('counts beers only — wine and shots are not beers', () => {
      const mixed = session('2026-08-27T19:00:00+02:00', 1);
      expect(
        idleBeerCount(
          {
            ...mixed,
            drinks: [
              ...mixed.drinks,
              { id: 'w', beerName: 'Ryzlink', at: '2026-08-27T19:30:00+02:00', drinkType: 'wine' },
            ] as TallySession['drinks'],
          },
          [],
          new Date('2026-08-27T21:00:00+02:00'),
        ),
      ).toBe(1);
    });

    it('adds up an evening that already moved pubs, because the evening is the day', () => {
      expect(
        idleBeerCount(
          session('2026-08-27T22:00:00+02:00', 2),
          [session('2026-08-27T19:00:00+02:00', 3), session('2026-08-26T19:00:00+02:00', 9)],
          new Date('2026-08-27T23:00:00+02:00'),
        ),
      ).toBe(5);
    });

    it('keeps counting a finished evening, so ending one does not reset the hub to zero', () => {
      expect(
        idleBeerCount(
          null,
          [session('2026-08-27T19:00:00+02:00', 4)],
          new Date('2026-08-27T23:00:00+02:00'),
        ),
      ).toBe(4);
    });
  });

  describe('what one press of the amber button does', () => {
    it('starts the night only when none is running', () => {
      expect(primaryTapAction(false, false)).toBe('first');
      expect(primaryTapAction(false, true)).toBe('first');
    });

    it('repeats the last drink while the night runs', () => {
      expect(primaryTapAction(true, true)).toBe('repeat');
    });

    it('asks instead of starting a second night after a move or a join', () => {
      // The regression: a running evening with nothing to repeat used to fall
      // through to "start the night", which reset the stopwatch and the stops.
      expect(primaryTapAction(true, false)).toBe('pick');
    });
  });

  it('skips archived sessions without a single drink', () => {
    expect(
      lastArchivedSession(
        [session('2026-08-26T19:00:00Z', 0), session('2026-08-20T19:00:00Z', 3)],
        new Date('2026-08-27T19:00:00Z'),
      ),
    ).toMatchObject({ startedAt: '2026-08-20T19:00:00Z' });
    expect(lastArchivedSession([], new Date('2026-08-27T19:00:00Z'))).toBeNull();
  });

  it("leaves tonight out of the memory row, because the big number already says it", () => {
    expect(
      lastArchivedSession(
        [session('2026-08-27T19:00:00+02:00', 4), session('2026-08-26T19:00:00+02:00', 2)],
        new Date('2026-08-27T23:00:00+02:00'),
      ),
    ).toMatchObject({ startedAt: '2026-08-26T19:00:00+02:00' });
  });
});
