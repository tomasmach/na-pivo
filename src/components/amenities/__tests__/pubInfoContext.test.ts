import { contributeParamsFromPubInfo, type PubInfoContext } from '../pubInfoContext';

const info: PubInfoContext = {
  externalId: 'mapy:123',
  name: 'Výčep U Rotace',
  lat: 50.08,
  lng: 14.42,
  beerMenuRotates: false,
};

describe('contributeParamsFromPubInfo', () => {
  it('serializes the resolved optimistic menu type instead of stale raw pub data', () => {
    const params = contributeParamsFromPubInfo(info, 'beers', true);

    expect(params.beerMenuRotates).toBe('1');
  });

  it('preserves an explicitly resolved fixed menu', () => {
    const params = contributeParamsFromPubInfo(
      { ...info, beerMenuRotates: true },
      'beers',
      false,
    );

    expect(params.beerMenuRotates).toBe('0');
  });
});
