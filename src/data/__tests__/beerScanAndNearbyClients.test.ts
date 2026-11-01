import { parseScannedLabel } from '../beerLabelScanClient';
import { parseNearbyBeers } from '../beersNearbyClient';

describe('parseNearbyBeers', () => {
  it('maps the wire rows and skips malformed ones', () => {
    expect(
      parseNearbyBeers({
        beers: [
          { name: ' Bernard 11° ', price_czk: 55, volume_ml: 500, pub_name: 'U Pinkasů', pub_cache_key: 'u2fkbn34', distance_m: 420 },
          { name: 'Svijany', price_czk: null, volume_ml: null, pub_name: 'Lokál', pub_cache_key: 'u2fkbn12', distance_m: 900 },
          { name: '', pub_name: 'X' },
          null,
        ],
      }),
    ).toEqual([
      { name: 'Bernard 11°', priceCzk: 55, volumeMl: 500, pubName: 'U Pinkasů', pubCacheKey: 'u2fkbn34', distanceMeters: 420 },
      { name: 'Svijany', pubName: 'Lokál', pubCacheKey: 'u2fkbn12', distanceMeters: 900 },
    ]);
  });

  it('reads a broken body as unknown, not as an empty list', () => {
    expect(parseNearbyBeers({})).toBeNull();
    expect(parseNearbyBeers(null)).toBeNull();
  });
});

describe('parseScannedLabel', () => {
  it('keeps only known serving types', () => {
    expect(parseScannedLabel({ beer: { name: 'Bernard 11°', brewery: 'Bernard', matched: true, serving_type: 'can', volume_ml: 500 } })).toEqual({
      name: 'Bernard 11°',
      brewery: 'Bernard',
      matched: true,
      servingType: 'can',
      volumeMl: 500,
    });
    expect(parseScannedLabel({ beer: { name: 'Ležák', serving_type: 'keg' } })).toEqual({ name: 'Ležák', brewery: '', matched: false });
  });

  it('reads a null beer as nothing recognized', () => {
    expect(parseScannedLabel({ beer: null })).toBeNull();
  });
});
