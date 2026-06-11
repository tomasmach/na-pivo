import { buildMapsUrl } from '../maps';

const simplePub = { name: 'U Fleků', lat: 50.0808, lng: 14.4178 };
const czechPub = { name: 'U Zlatého Tygra', lat: 50.0857, lng: 14.4148 };
const ampersandPub = { name: 'Pub & Bar', lat: 50.0, lng: 14.0 };

// Regression: a name search (`q=Restaurace Kamenec`) anchored at coordinates is
// resolved by Mapy.cz nationwide by textual relevance — a user near Olomouc got
// sent to "Pohostinství Kamenec u Poličky" ~150 km away. The link must target
// the pub's exact coordinates and never rely on its name.
describe('buildMapsUrl', () => {
  it('uses the Mapy.com showmap URL API', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toContain('https://mapy.com/fnc/v1/showmap');
  });

  it('pins the exact pub position via center=lng,lat with a marker', () => {
    const url = buildMapsUrl(czechPub);
    expect(url).toContain(`center=${czechPub.lng}%2C${czechPub.lat}`);
    expect(url).toContain('marker=true');
  });

  it('zooms in close enough to identify the pub', () => {
    const url = buildMapsUrl(simplePub);
    expect(url).toMatch(/zoom=1[5-9]/);
  });

  it('never searches by pub name — name matches can resolve far away', () => {
    const url = buildMapsUrl(ampersandPub);
    expect(url).not.toContain('q=');
    expect(url).not.toContain('query=');
    expect(url).not.toContain(encodeURIComponent(ampersandPub.name));
  });
});
