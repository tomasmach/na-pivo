import { buildMapsUrl } from '../maps';

const simplePub = { name: 'U Fleků', lat: 50.0808, lng: 14.4178 };
const czechPub = { name: 'U Zlatého Tygra', lat: 50.0857, lng: 14.4148 };
const ampersandPub = { name: 'Pub & Bar', lat: 50.0, lng: 14.0 };

// Regression: name searches can resolve to a similarly named business in a
// different city. The link must target the exact coordinates instead.
describe('buildMapsUrl', () => {
  it('uses the keyless Google Maps URL API', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain('https://www.google.com/maps/search/');
    expect(url).toContain('api=1');
  });

  it('pins the exact pub position in latitude-longitude order', () => {
    const url = buildMapsUrl(czechPub);
    expect(url).toContain(`query=${czechPub.lat}%2C${czechPub.lng}`);
  });

  it('never searches by pub name — name matches can resolve far away', () => {
    const url = buildMapsUrl(ampersandPub);
    expect(url).not.toContain('query=Pub');
    expect(url).not.toContain(encodeURIComponent(ampersandPub.name));
  });
});
