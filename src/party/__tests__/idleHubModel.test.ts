import { gamesLine, lastArchivedSession } from '@/party/idleHubModel';
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
  it('names two games and counts the rest', () => {
    expect(gamesLine([{ name: 'Pub kvíz' }, { name: 'Kostky' }, { name: 'Flaška' }])).toBe(
      'Pub kvíz, Kostky a 1 další',
    );
    expect(gamesLine([{ name: 'A' }, { name: 'B' }])).toBe('A, B');
    expect(
      gamesLine(Array.from({ length: 9 }, (_, i) => ({ name: `G${i}` }))),
    ).toBe('G0, G1 a 7 dalších');
  });

  it('skips archived sessions without a single drink', () => {
    expect(lastArchivedSession([session('2026-08-26T19:00:00Z', 0), session('2026-08-20T19:00:00Z', 3)]))
      .toMatchObject({ startedAt: '2026-08-20T19:00:00Z' });
    expect(lastArchivedSession([])).toBeNull();
  });
});
