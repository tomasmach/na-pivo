import {
  HOME_STOP_RADIUS_M,
  MAX_HOME_STOP_IDS,
  idosConnectionUrl,
  isUpcomingDeparture,
  stopIdsNearHome,
  type HomeTransitDeparture,
} from '@/transit/homeTransit';

const HOME = { lat: 50.0905, lng: 14.4392 };
// ~111 m per 0.001° of latitude in Prague.
const north = (meters: number) => ({ lat: HOME.lat + meters / 111_320, lng: HOME.lng });

const DEPARTURE: HomeTransitDeparture = {
  line: '9',
  headsign: 'Spojovací',
  routeType: 0,
  fromStopId: 'U1Z1P',
  fromStopName: 'Anděl',
  toStopId: 'U2Z1P',
  toStopName: 'Náměstí Míru',
  departsAtMs: Date.parse('2026-10-07T21:58:00Z'),
};

describe('stopIdsNearHome', () => {
  it('keeps stops inside the radius, nearest first', () => {
    const stops = [
      { id: 'far', ...north(HOME_STOP_RADIUS_M + 40) },
      { id: 'mid', ...north(500) },
      { id: 'near', ...north(80) },
    ];
    expect(stopIdsNearHome(stops, HOME)).toEqual(['near', 'mid']);
  });

  it('sends at most the nearest ids the server accepts', () => {
    const stops = Array.from({ length: MAX_HOME_STOP_IDS + 10 }, (_, index) => ({
      id: `S${index}`,
      ...north(index * 5),
    }));
    const ids = stopIdsNearHome(stops, HOME);
    expect(ids).toHaveLength(MAX_HOME_STOP_IDS);
    expect(ids[0]).toBe('S0');
  });

  it('finds nothing outside PID', () => {
    expect(stopIdsNearHome([{ id: 'U1Z1P', lat: 50.07, lng: 14.4 }], { lat: 49.19, lng: 16.6 })).toEqual([]);
  });
});

describe('isUpcomingDeparture', () => {
  it('drops a connection once it left', () => {
    expect(isUpcomingDeparture(DEPARTURE, DEPARTURE.departsAtMs - 1)).toBe(true);
    expect(isUpcomingDeparture(DEPARTURE, DEPARTURE.departsAtMs)).toBe(false);
    expect(isUpcomingDeparture(null)).toBe(false);
  });
});

describe('idosConnectionUrl', () => {
  it('searches between the two stop names only', () => {
    expect(idosConnectionUrl(DEPARTURE)).toBe(
      'https://idos.cz/pid/spojeni/vysledky/?f=And%C4%9Bl&t=N%C3%A1m%C4%9Bst%C3%AD%20M%C3%ADru',
    );
  });
});
