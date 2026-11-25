import { lastTogetherLabel, personName, ticketDay } from '../partaModel';

describe('parta model', () => {
  const now = new Date(2026, 9, 30, 20, 0);

  it('names people by their chosen name, else their handle', () => {
    expect(personName({ displayName: 'Klára', nickname: 'klara' })).toBe('Klára');
    expect(personName({ displayName: ' ', nickname: 'jirka' })).toBe('@jirka');
  });

  it('labels the last evening together the way the mock does', () => {
    expect(lastTogetherLabel(null, '', now)).toBe('Zatím jste spolu nebyli');
    expect(lastTogetherLabel(new Date(2026, 9, 29, 21).toISOString(), 'U Vystřelenýho oka', now)).toBe(
      'Naposledy včera · U Vystřelenýho oka',
    );
    expect(lastTogetherLabel(new Date(2026, 9, 21, 21).toISOString(), 'Lokál', now)).toBe('Naposledy minulý týden');
  });

  it('says today and tomorrow on tickets', () => {
    expect(ticketDay(new Date(2026, 9, 30, 21).toISOString(), now).dayName).toMatch(/^Dnes, /);
    expect(ticketDay(new Date(2026, 9, 31, 19).toISOString(), now)).toMatchObject({ dayNum: '31' });
    expect(ticketDay(new Date(2026, 9, 31, 19).toISOString(), now).dayName).toMatch(/^Zítra, /);
  });
});
