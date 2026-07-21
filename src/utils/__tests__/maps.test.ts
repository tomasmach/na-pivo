import { buildMapsUrl, buildNavigationUrl } from '../maps';

const simplePub = { name: 'U Fleků', lat: 50.0808, lng: 14.4178 };
const czechPub = { name: 'U Zlatého Tygra', lat: 50.0857, lng: 14.4148 };
const ampersandPub = { name: 'Pub & Bar', lat: 50.0, lng: 14.0 };
const placeIdPub = {
  name: 'U Zlatého Tygra',
  lat: 50.0857,
  lng: 14.4148,
  googlePlaceId: 'ChIJl-inTnyUC0cRw4Y0F76_uUE',
};

// Regression: name searches can resolve to a similarly named business in a
// different city. Without a place id the link must target exact coordinates.
describe('buildMapsUrl', () => {
  it('uses the keyless Google Maps URL API', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain('https://www.google.com/maps/search/');
    expect(url).toContain('api=1');
  });

  it('pins the exact pub position in latitude-longitude order', () => {
    const url = buildMapsUrl(czechPub);
    expect(url).toContain(`query=${czechPub.lat}%2C${czechPub.lng}`);
    expect(url).not.toContain('query_place_id');
  });

  it('never searches by bare pub name — name matches can resolve far away', () => {
    const url = buildMapsUrl(ampersandPub);
    expect(url).not.toContain('query=Pub');
    expect(url).not.toContain(encodeURIComponent(ampersandPub.name));
  });

  it('targets the exact business via query_place_id when a place id is known', () => {
    const url = buildMapsUrl(placeIdPub);
    expect(url).toContain(`query_place_id=${placeIdPub.googlePlaceId}`);
    // The name is only a human-readable fallback; the place id wins in Maps.
    // URLSearchParams form-encodes spaces as '+'.
    expect(url).toContain('query=U+Zlat%C3%A9ho+Tygra');
  });

  it('falls back to coordinates as the query when a place id pub has no name', () => {
    const url = buildMapsUrl({
      lat: 50.0857,
      lng: 14.4148,
      googlePlaceId: 'ChIJl-inTnyUC0cRw4Y0F76_uUE',
    });
    expect(url).toContain('query=50.0857%2C14.4148');
    expect(url).toContain('query_place_id=ChIJl-inTnyUC0cRw4Y0F76_uUE');
  });
});

describe('buildNavigationUrl', () => {
  it('passes only a destination to Google Maps', () => {
    const url = buildNavigationUrl({ lat: 50.08, lng: 14.42 }, 'google');
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=50.08%2C14.42&travelmode=walking');
    expect(url).not.toContain('origin');
  });

  it('uses longitude-latitude order for Mapy.com routing', () => {
    const url = buildNavigationUrl({ lat: 50.08, lng: 14.42 }, 'mapy');
    expect(url).toContain('https://mapy.com/fnc/v1/route?');
    expect(url).toContain('end=14.42%2C50.08');
    expect(url).toContain('routeType=foot_fast');
    expect(url).not.toContain('start=');
  });
});
