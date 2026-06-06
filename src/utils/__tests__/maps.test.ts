import { buildMapsUrl } from '../maps';

const simplePub = { name: 'U Fleků', lat: 50.0808, lng: 14.4178 };
const czechPub = { name: 'U Zlatého Tygra', lat: 50.0857, lng: 14.4148 };
const ampersandPub = { name: 'Pub & Bar', lat: 50.0, lng: 14.0 };

describe('buildMapsUrl', () => {
  it('contains the Mapy.cz base URL', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain('https://mapy.cz/zakladni');
  });

  it('searches by the pub name so Mapy.cz shows its label', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain(`q=${encodeURIComponent(simplePub.name)}`);
  });

  it('centres the map on the pub using x=longitude and y=latitude', () => {
    const url = buildMapsUrl(czechPub);
    expect(url).toContain(`x=${czechPub.lng}`);
    expect(url).toContain(`y=${czechPub.lat}`);
  });

  it('URL-encodes the pub name so & does not break the query string', () => {
    const url = buildMapsUrl(ampersandPub);
    const queryValue = url.split('q=')[1].split('&')[0];
    expect(queryValue).toBe('Pub%20%26%20Bar');
    expect(decodeURIComponent(queryValue)).toBe(ampersandPub.name);
  });
});
