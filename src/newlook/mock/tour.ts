import type { LatLng, Pub } from './data';

export type StopState = 'todo' | 'visited' | 'skipped';

export type TourStop = {
  name: string;
  address: string;
  hours: string;
  beer: string;
  walk: string;
  walkShort: string;
  challenge?: string;
  coord: LatLng;
  distance: number;
};

export const TOUR = {
  id: 'zizkov',
  name: 'Žižkovský tah',
  day: 'Sobota',
  dayNum: '31',
  date: 'Sobota 31. 10.',
  time: '20:00',
  length: 'asi 2,1 km pěšky',
  stops: [
    { name: 'Lokál Dlouhááá', address: 'Dlouhá 33', hours: 'V sobotu 11:00–1:00', beer: 'Pilsner Urquell 12°', walk: '900 m · asi 12 min pěšky', walkShort: 'asi 12 min', coord: { latitude: 50.0846, longitude: 14.4430 }, distance: 900 },
    { name: 'U Vystřelenýho oka', address: 'U Božích bojovníků 3', hours: 'Dnes 16:00–1:00', beer: 'Pilsner Urquell 12°', walk: '450 m · asi 6 min pěšky', walkShort: 'asi 6 min', challenge: 'Zeptej se výčepního, jak dlouho tu čepuje.', coord: { latitude: 50.0866, longitude: 14.4470 }, distance: 450 },
    { name: "Bukowski's", address: 'Bořivojova 86', hours: 'Dnes 17:00–2:00', beer: 'Matuška Raptor', walk: '350 m · asi 5 min pěšky', walkShort: 'asi 6 min', challenge: 'Dej si pivo, které jsi ještě neměl.', coord: { latitude: 50.0838, longitude: 14.4505 }, distance: 450 },
    { name: 'U Sadu', address: 'Škroupovo náměstí 5', hours: 'Dnes 11:00–2:00', beer: 'Kozel 11°, Svijany 11°', walk: '400 m · asi 5 min pěšky', walkShort: 'asi 5 min', coord: { latitude: 50.0862, longitude: 14.4542 }, distance: 400 },
    { name: 'U Kurelů', address: 'Chvalova 1', hours: 'Dnes 16:00–0:00', beer: 'Bernard 12°', walk: '300 m · asi 4 min pěšky', walkShort: 'asi 4 min', challenge: 'Připijte tomu, kdo to naplánoval.', coord: { latitude: 50.0840, longitude: 14.4578 }, distance: 300 },
  ] as TourStop[],
};

export function nextStopIndex(stops: StopState[]): number {
  return stops.findIndex((x) => x === 'todo');
}

/** A tour stop as a pub, so the compass can aim at it. */
export function stopAsPub(i: number): Pub {
  const st = TOUR.stops[i];
  return {
    id: `tour-${i}`,
    name: st.name,
    area: 'Žižkov',
    city: 'Praha',
    coord: st.coord,
    distance: st.distance,
    openUntil: st.hours.split('–')[1] ?? '1:00',
    open: true,
    price: null,
    mainBeerId: null,
    taps: [],
    tags: [],
  };
}
