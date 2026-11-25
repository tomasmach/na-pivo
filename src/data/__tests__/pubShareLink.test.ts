import { geohash8 } from '../geohash';
import { buildPubShareUrl, parsePubShareUrl } from '../pubShareLink';

const pub = { name: 'U Zlatého tygra', lat: 50.0857, lng: 14.4186 };
const key = geohash8(pub.lat, pub.lng);

describe('pub share link', () => {
  it('points at the public page of the pub cell with a name hint', () => {
    expect(buildPubShareUrl(pub)).toBe(`https://na-pivo.cz/h/${key}?n=U%20Zlat%C3%A9ho%20tygra`);
  });

  it('round-trips through the web and the app scheme', () => {
    for (const url of [buildPubShareUrl(pub), `napivo://h/${key}?n=U+Zlat%C3%A9ho+tygra`]) {
      const parsed = parsePubShareUrl(url);
      expect(parsed).toMatchObject({ key, name: 'U Zlatého tygra' });
      expect(Math.abs((parsed?.lat ?? 0) - pub.lat)).toBeLessThan(0.001);
      expect(Math.abs((parsed?.lng ?? 0) - pub.lng)).toBeLessThan(0.001);
    }
  });

  it('rejects foreign hosts and malformed cells', () => {
    expect(parsePubShareUrl(`https://evil.example/h/${key}`)).toBeNull();
    expect(parsePubShareUrl('https://na-pivo.cz/h/aaaaaaaa')).toBeNull();
    expect(parsePubShareUrl('https://na-pivo.cz/h/u2fk')).toBeNull();
    expect(parsePubShareUrl('https://na-pivo.cz/p/abc')).toBeNull();
    expect(parsePubShareUrl(null)).toBeNull();
  });
});
