/**
 * Building a night from what already exists (src/party/nightBuilder.ts).
 *
 * The load-bearing property is that no drink has two ways in. My own come off
 * the counter, everybody else's off the server — because my drinks come back
 * down in the evening's events as soon as they sync, and there is no shared id
 * to dedupe them by. Get this wrong and every phone at the table shows a
 * different, inflated total.
 */

import { buildNightRecord, peopleOf, tintFor, ME_TINT } from '@/party/nightBuilder';
import { nightStandings, nightTally } from '@/party/nightRecord';
import type { PartyEvening } from '@/data/partyClient';
import type { TallySession } from '@/stores/tallyStore';

const ME = 'me-id';

function evening(over: Partial<PartyEvening> = {}): PartyEvening {
  return {
    id: 'e1',
    joinCode: 'STUL24',
    joinUrl: 'https://na-pivo.cz/party/STUL24',
    host: { id: ME, nickname: 'ja', displayName: 'Já', avatarUrl: null },
    pubName: 'U Fleků',
    pubCity: 'Praha',
    active: true,
    startedAt: '2026-07-30T18:00:00.000Z',
    endedAt: null,
    isHost: true,
    members: [
      { id: ME, nickname: 'ja', displayName: 'Já', avatarUrl: null },
      { id: 'h-id', nickname: 'honza', displayName: 'Honza Novák', avatarUrl: null },
    ],
    events: [],
    ...over,
  };
}

function session(count: number): TallySession {
  return {
    clientId: 'sess-1',
    pubKey: 'u2fkbjgx',
    pubName: 'U Fleků',
    startedAt: '2026-07-30T18:00:00.000Z',
    drinks: Array.from({ length: count }, (_, index) => ({
      id: `t${index}`,
      beerName: 'Plzeň',
      at: `2026-07-30T1${8 + index}:00:00.000Z`,
    })),
  };
}

const drinkEvent = (accountId: string, quantity = 1) => ({
  id: `log:${accountId}:${quantity}`,
  kind: 'drink' as const,
  at: '2026-07-30T19:30:00.000Z',
  account: { id: accountId, nickname: 'honza', displayName: 'Honza', avatarUrl: null },
  beerName: 'Kozel',
  quantity,
});

describe('buildNightRecord', () => {
  it('counts my beer once, even after the server has read it back', () => {
    // Two on the counter, and the server echoing one of them back as an event.
    const record = buildNightRecord({
      evening: evening({ events: [{ ...drinkEvent(ME), id: 'log:mine' }] }),
      session: session(2),
      meId: ME,
    });

    expect(nightTally(record).beers).toBe(2);
  });

  it('takes everybody else from the server, because their phone is not this one', () => {
    const record = buildNightRecord({
      evening: evening({ events: [drinkEvent('h-id')] }),
      session: session(1),
      meId: ME,
    });
    const standings = nightStandings(record);

    // "honza" — the handle they chose, not the name on their card.
    expect(standings.map((row) => [row.name, row.beers])).toEqual([
      ['honza', 1],
      ['Ty', 1],
    ]);
  });

  it('unpacks a released app sharing two beers as one row', () => {
    const record = buildNightRecord({
      evening: evening({ events: [drinkEvent('h-id', 2)] }),
      session: null,
      meId: ME,
    });

    expect(nightTally(record).beers).toBe(2);
  });

  it('is the same shape for a night nobody shared', () => {
    const record = buildNightRecord({ evening: null, session: session(3), meId: ME });

    expect(record.code).toBeNull();
    expect(record.people.map((person) => person.name)).toEqual(['Ty']);
    expect(nightTally(record).beers).toBe(3);
  });

  it('puts the drinks in the order they happened, whoever logged them', () => {
    const record = buildNightRecord({
      evening: evening({ events: [drinkEvent('h-id')] }),
      session: session(2),
      meId: ME,
    });

    expect(record.drinks.map((drink) => drink.at)).toEqual([
      '2026-07-30T18:00:00.000Z',
      '2026-07-30T19:00:00.000Z',
      '2026-07-30T19:30:00.000Z',
    ]);
  });

  it('hangs a drink on the stop that was open when it landed', () => {
    const record = buildNightRecord({
      evening: null,
      session: session(1),
      meId: ME,
      stops: [
        { id: 's1', pubName: 'U Fleků', cacheKey: 'a', arrivedAt: '2026-07-30T18:00:00.000Z' },
        { id: 's2', pubName: 'Zlý časy', cacheKey: 'b', arrivedAt: '2026-07-30T21:00:00.000Z' },
      ],
    });

    expect(record.drinks[0].stopId).toBe('s2');
  });
});

describe('peopleOf', () => {
  it('puts you first and in amber', () => {
    const people = peopleOf(evening(), ME);

    expect(people[0]).toEqual({ id: ME, name: 'Ty', avatarUrl: null, tint: ME_TINT });
    expect(people[1].name).toBe('honza');
  });

  it('prefers the handle, because nobody is Honza Novák at the table', () => {
    const people = peopleOf(
      evening({
        members: [
          { id: ME, nickname: null, displayName: 'Já', avatarUrl: null },
          { id: 'x', nickname: null, displayName: 'Petr Dvořák', avatarUrl: null },
        ],
      }),
      ME,
    );

    expect(people[1].name).toBe('Petr Dvořák');
  });

  it('leaves nobody in amber but you', () => {
    const people = peopleOf(evening(), ME);

    expect(people.slice(1).every((person) => person.tint !== ME_TINT)).toBe(true);
  });
});

describe('tintFor', () => {
  it('gives the same person the same colour on every phone', () => {
    expect(tintFor('h-id')).toBe(tintFor('h-id'));
    // And does not repaint the table when somebody joins.
    expect(tintFor('a')).not.toBe(ME_TINT);
  });
});
