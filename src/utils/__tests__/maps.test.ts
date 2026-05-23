import { buildMapsUrl } from '../maps';

const simplePub = { name: 'U Fleků', lat: 50.0808, lng: 14.4178 };
const czechPub = { name: 'U Zlatého Tygra', lat: 50.0857, lng: 14.4148 };
const ampersandPub = { name: 'Pub & Bar', lat: 50.0, lng: 14.0 };

describe('buildMapsUrl', () => {
  it('contains the Google Maps search base URL', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain('https://www.google.com/maps/search/?api=1&query=');
  });

  it('contains the encoded lat,lng of the pub', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain(`${simplePub.lat},${simplePub.lng}`);
  });

  it('contains the URL-encoded pub name that round-trips via decodeURIComponent', () => {
    const url = buildMapsUrl(czechPub);
    // Extract the name portion from inside the parentheses
    const match = url.match(/\(([^)]+)\)/);
    expect(match).not.toBeNull();
    const encodedName = match![1];
    expect(decodeURIComponent(encodedName)).toBe(czechPub.name);
  });

  it('encodes & in a pub name so it does not appear raw in the URL query string', () => {
    const url = buildMapsUrl(ampersandPub);
    // The & in the name must be percent-encoded, not raw
    const queryPart = url.split('?')[1];
    // After the fixed api=1&query= prefix, the name should not introduce a raw &
    const afterQuery = queryPart.replace('api=1&query=', '');
    expect(afterQuery).not.toContain('Pub & Bar');
    expect(afterQuery).toContain('Pub%20%26%20Bar');
  });
});
