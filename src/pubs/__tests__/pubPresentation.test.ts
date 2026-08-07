import { buildPubNavigationUrl } from '../pubNavigation';
import { pubHoursLabel, toPubListItem } from '../pubPresentation';
import type { Pub } from '@/data/pubs';

const PUB: Pub = {
  id: 'pub-1',
  name: 'U Tří pěn',
  lat: 50.08,
  lng: 14.42,
  address: 'Pivní 3',
  city: 'Praha',
};

describe('pub presentation', () => {
  it('keeps missing tap and hours data honest', () => {
    const item = toPubListItem(PUB, 342, null);
    expect(item.distance).toBe('342 m');
    expect(item.addressLine).toBe('Pivní 3, Praha');
    expect(item.hoursLabel).toBe('Otevíračka neznámá');
    expect(item.beerLabel).toBe('Piva zatím nikdo nezmapoval');
    expect(item.priceCzk).toBeNull();
  });

  it('formats the next real opening-hours transition', () => {
    expect(
      pubHoursLabel({
        ...PUB,
        isOpenNow: true,
        hoursStatus: 'ok',
        nextChange: '2026-08-07T23:30:00+02:00',
      }),
    ).toBe('Otevřeno do 23:30');
  });
});

describe('pub navigation', () => {
  it('uses Apple Maps on iOS', () => {
    expect(buildPubNavigationUrl(PUB, 'ios')).toBe(
      'http://maps.apple.com/?daddr=50.08,14.42&q=U%20T%C5%99%C3%AD%20p%C4%9Bn',
    );
  });

  it('uses a geo URI on Android', () => {
    expect(buildPubNavigationUrl(PUB, 'android')).toBe(
      'geo:50.08,14.42?q=50.08,14.42(U%20T%C5%99%C3%AD%20p%C4%9Bn)',
    );
  });
});
