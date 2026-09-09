import * as queryString from 'query-string';
import decodeUriComponent from 'decode-uri-component';

describe('query string security backport', () => {
  it('keeps Expo Router query parsing compatible', () => {
    expect(queryString.parse('name=%C5%A0tamgast&broken=%E0%A4%A')).toEqual({
      broken: '%E0%A4%A',
      name: 'Štamgast',
    });
    expect(queryString.stringify({ name: 'Štamgast', round: 3 }, { sort: false })).toBe(
      'name=%C5%A0tamgast&round=3'
    );
  });

  it.each([
    ['%FE%FF', '\uFFFD\uFFFD'],
    ['%FF%FE', '\uFFFD\uFFFD'],
    ['%C2', '\uFFFD'],
    ['%C2%41', '\uFFFDA'],
    ['%C2%C2', '\uFFFD\uFFFD'],
    ['%C2%B5%C2', 'µ\uFFFD'],
    ['%ea%ba%5a%ba', '%ea%baZ%ba'],
    ['%C3%5A%A5', '%C3Z%A5'],
    ['%F0%9F%41', '%F0%9FA'],
    ['%F0%41%82%83', '%F0A%82%83'],
    ['%C3%A5%80%C3%A5', 'å%80å'],
    ['%84%D7%25%88%90', '%84%D7%%88%90'],
    ['%20%20%25%80', '  %%80'],
    ['a%FE%FFb', `a\uFFFD\uFFFDb`],
    ['%FE%FF%FE%FF', '\uFFFD\uFFFD\uFFFD\uFFFD'],
  ])('preserves v0.5 behavior for malformed input %s', (input, expected) => {
    expect(decodeUriComponent(input)).toBe(expected);
  });

  it('decodes a long malformed input in bounded time', () => {
    const repeatedLeadBytes = '%C2'.repeat(100_000);
    const uniqueMalformedRuns = Array.from({ length: 16_000 }, (_, index) => {
      const encodedIndex = Array.from(String(index), (character) =>
        `%${character.charCodeAt(0).toString(16)}`
      ).join('');

      return `%FF${encodedIndex}`;
    }).join('x');

    expect(decodeUriComponent(repeatedLeadBytes)).toBe('\uFFFD'.repeat(100_000));

    const startedAt = performance.now();
    const decoded = decodeUriComponent(uniqueMalformedRuns);

    expect(decoded).toContain('%FF0x%FF1x%FF2');
    expect(decoded).toContain('%FF15999');
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
