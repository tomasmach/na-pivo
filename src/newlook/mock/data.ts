// Seed data for the clickable mock. Names and numbers come from the redesign file.

export type LatLng = { latitude: number; longitude: number };

export type Tap = { beerId: string; size: string; price: number };

export type Pub = {
  id: string;
  name: string;
  area: string;
  city: string;
  coord: LatLng;
  distance: number;
  openUntil: string | null;
  open: boolean;
  price: number | null;
  mainBeerId: string | null;
  taps: Tap[];
  tags: ('craft' | 'sipky' | 'zahradka' | 'tv' | 'plzen')[];
  event?: string;
  rating?: { value: string; count: string; source: string };
  lastWeekBeers?: number;
  verified?: string;
  lastWeekCount?: number;
};

export type Beer = {
  id: string;
  name: string;
  brewery: string;
  style: string;
  rating: number;
  ratings: number;
  move: number;
  verified?: boolean;
  nearestPubId?: string;
  nearestDistance?: string;
  abv?: string;
  verdict?: string;
  bottomRank?: number;
};

export type Friend = {
  id: string;
  name: string;
  nick: string;
  initial: string;
  live?: { pubId: string; beers: number; since: string };
  lastSeen: string;
  level: number;
};

export type PlanResponse = 'jdu' | 'mozna' | 'nemuzu' | null;

export type Plan = {
  id: string;
  from: string;
  fromId: string;
  dayNum: string;
  dayName: string;
  time: string;
  place: string;
  pubId?: string;
  home?: boolean;
  address?: string;
  note: string;
  going: string[];
  my: PlanResponse;
  mine?: boolean;
};

export type Drink = { id: string; beerId: string; size: string; kind: string; price: number; time: string };

export type Evening = {
  id: string;
  date: string;
  dayLabel: string;
  pubIds: string[];
  beers: number;
  spent: number;
  from: string;
  to: string;
  photo?: number;
};

export type FeedPost = {
  id: string;
  user: string;
  initial: string;
  city: string;
  when: string;
  scope: string;
  beers: number;
  route: string;
  duration: string;
  rounds: number;
  photo?: number;
  friend?: boolean;
};

export type Badge = { id: string; name: string; icon: string; level: string; got: boolean; secret?: boolean; progress?: string };

// Photos from the redesign file (Unsplash), indexed like assets/newlook/p<n>.jpg.
export const PHOTOS = [
  require('../../../assets/newlook/p1.jpg'),
  require('../../../assets/newlook/p2.jpg'),
  require('../../../assets/newlook/p3.jpg'),
  require('../../../assets/newlook/p4.jpg'),
  require('../../../assets/newlook/p5.jpg'),
  require('../../../assets/newlook/p6.jpg'),
  require('../../../assets/newlook/p7.jpg'),
  require('../../../assets/newlook/p8.jpg'),
  require('../../../assets/newlook/p9.jpg'),
  require('../../../assets/newlook/p10.jpg'),
  require('../../../assets/newlook/p11.jpg'),
  require('../../../assets/newlook/p12.jpg'),
  require('../../../assets/newlook/p13.jpg'),
  require('../../../assets/newlook/p14.jpg'),
  require('../../../assets/newlook/p15.jpg'),
  require('../../../assets/newlook/p16.jpg'),
  require('../../../assets/newlook/p17.jpg'),
] as const;

export function photo(n: number) {
  return PHOTOS[(n - 1 + PHOTOS.length) % PHOTOS.length];
}

export const ME_COORD: LatLng = { latitude: 50.0843, longitude: 14.4199 };

export const PUBS: Pub[] = [
  {
    id: 'tygr',
    name: 'U Zlatého tygra',
    area: 'Staré Město',
    city: 'Praha',
    coord: { latitude: 50.0857, longitude: 14.4186 },
    distance: 260,
    openUntil: '23:00',
    open: true,
    price: 59,
    mainBeerId: 'pilsner',
    taps: [
      { beerId: 'pilsner', size: '0,5 l', price: 59 },
      { beerId: 'kozel', size: '0,5 l', price: 52 },
      { beerId: 'pilsner', size: '0,3 l', price: 42 },
    ],
    tags: ['plzen'],
    event: 'Dnes pub kvíz od 19:00',
    rating: { value: '4,6', count: '1 200', source: 'Firmy.cz' },
    lastWeekBeers: 86,
    verified: 'ověřeno dnes',
  },
  {
    id: 'dlouha',
    name: 'Lokál Dlouhááá',
    area: 'Staré Město',
    city: 'Praha',
    coord: { latitude: 50.0901, longitude: 14.4256 },
    distance: 650,
    openUntil: '01:00',
    open: true,
    price: 54,
    mainBeerId: 'pilsner',
    taps: [
      { beerId: 'pilsner', size: '0,5 l', price: 54 },
      { beerId: 'pilsner', size: '0,3 l', price: 38 },
    ],
    tags: ['plzen'],
    rating: { value: '4,5', count: '3 400', source: 'Firmy.cz' },
    lastWeekBeers: 142,
    verified: 'ověřeno včera',
  },
  {
    id: 'pinkas',
    name: 'U Pinkasů',
    area: 'Nové Město',
    city: 'Praha',
    coord: { latitude: 50.0829, longitude: 14.4238 },
    distance: 410,
    openUntil: '23:30',
    open: true,
    price: 59,
    mainBeerId: 'pilsner',
    taps: [{ beerId: 'pilsner', size: '0,5 l', price: 59 }],
    tags: ['plzen', 'zahradka'],
    lastWeekBeers: 64,
  },
  {
    id: 'medvidek',
    name: 'U Medvídků',
    area: 'Staré Město',
    city: 'Praha',
    coord: { latitude: 50.0826, longitude: 14.4176 },
    distance: 330,
    openUntil: '23:00',
    open: true,
    price: 62,
    mainBeerId: 'budvar',
    taps: [
      { beerId: 'budvar', size: '0,5 l', price: 62 },
      { beerId: 'unetice', size: '0,5 l', price: 64 },
    ],
    tags: ['craft'],
    lastWeekBeers: 51,
  },
  {
    id: 'celnice',
    name: 'Kolkovna Celnice',
    area: 'Nové Město',
    city: 'Praha',
    coord: { latitude: 50.0874, longitude: 14.4302 },
    distance: 880,
    openUntil: '00:00',
    open: true,
    price: 79,
    mainBeerId: 'pilsner',
    taps: [{ beerId: 'pilsner', size: '0,5 l', price: 79 }],
    tags: ['tv', 'plzen'],
    lastWeekBeers: 38,
  },
  {
    id: 'kolkovna',
    name: 'V Kolkovně',
    area: 'Josefov',
    city: 'Praha',
    coord: { latitude: 50.0896, longitude: 14.4196 },
    distance: 540,
    openUntil: '00:00',
    open: true,
    price: null,
    mainBeerId: null,
    taps: [],
    tags: ['sipky'],
  },
  {
    id: 'oko',
    name: 'U Vystřelenýho oka',
    area: 'Žižkov',
    city: 'Praha',
    coord: { latitude: 50.0838, longitude: 14.4481 },
    distance: 2400,
    openUntil: '01:00',
    open: true,
    price: 48,
    mainBeerId: 'pilsner',
    taps: [{ beerId: 'pilsner', size: '0,5 l', price: 48 }],
    tags: ['sipky', 'zahradka'],
    lastWeekBeers: 120,
  },
  {
    id: 'matuska',
    name: 'Pivovarský klub',
    area: 'Karlín',
    city: 'Praha',
    coord: { latitude: 50.0905, longitude: 14.4379 },
    distance: 1200,
    openUntil: '23:30',
    open: true,
    price: 75,
    mainBeerId: 'raptor',
    taps: [
      { beerId: 'raptor', size: '0,4 l', price: 75 },
      { beerId: 'samuraj', size: '0,4 l', price: 72 },
      { beerId: 'unetice', size: '0,5 l', price: 58 },
    ],
    tags: ['craft'],
    lastWeekBeers: 47,
  },
];

export const BEERS: Beer[] = [
  { id: 'raptor', name: 'Matuška Raptor 15°', brewery: 'Matuška', style: 'IPA', rating: 4.7, ratings: 812, move: 0, nearestPubId: 'matuska', nearestDistance: '1,2 km', abv: '6,3 %' },
  { id: 'bernard', name: 'Bernard Černý 12°', brewery: 'Bernard', style: 'tmavé', rating: 4.6, ratings: 1204, move: 1, verified: true, nearestDistance: '400 m', abv: '5,1 %' },
  { id: 'pilsner', name: 'Pilsner Urquell 12°', brewery: 'Prazdroj', style: 'ležák', rating: 4.4, ratings: 2318, move: -1, verified: true, nearestPubId: 'tygr', nearestDistance: '260 m', abv: '4,4 %' },
  { id: 'unetice', name: 'Únětické 12°', brewery: 'Únětice', style: 'ležák', rating: 4.4, ratings: 690, move: 3, nearestPubId: 'medvidek', nearestDistance: '1,8 km', abv: '5,0 %' },
  { id: 'svijany', name: 'Svijanský Rytíř 12°', brewery: 'Svijany', style: 'ležák', rating: 4.3, ratings: 540, move: 0, nearestDistance: '2,1 km', abv: '5,0 %' },
  { id: 'budvar', name: 'Budvar 33', brewery: 'Budvar', style: 'ležák', rating: 4.3, ratings: 1377, move: -2, verified: true, nearestPubId: 'medvidek', nearestDistance: '900 m', abv: '4,6 %' },
  { id: 'samuraj', name: 'Kocour Samuraj 12°', brewery: 'Kocour', style: 'APA', rating: 4.3, ratings: 210, move: 0, nearestPubId: 'matuska', nearestDistance: '3,4 km', abv: '5,0 %' },
  { id: 'kozel', name: 'Kozel 11°', brewery: 'Velké Popovice', style: 'ležák', rating: 3.6, ratings: 1840, move: 0, verified: true, nearestPubId: 'tygr', nearestDistance: '260 m', abv: '4,6 %', verdict: 'Ujde, když není nic jiného', bottomRank: 4 },
  { id: 'gambrinus', name: 'Gambrinus 10°', brewery: 'Prazdroj', style: 'výčepní', rating: 3.2, ratings: 2210, move: 0, verified: true, nearestDistance: '700 m', abv: '4,3 %', verdict: 'Na fotbal dobrý', bottomRank: 2 },
  { id: 'braník', name: 'Braník 10°', brewery: 'Staropramen', style: 'výčepní', rating: 2.9, ratings: 960, move: 0, nearestDistance: '1,4 km', abv: '4,1 %', verdict: 'Voda s pěnou', bottomRank: 1 },
  { id: 'staropramen', name: 'Staropramen 11°', brewery: 'Staropramen', style: 'ležák', rating: 3.4, ratings: 1580, move: 0, verified: true, nearestDistance: '500 m', abv: '4,7 %', verdict: 'Nic moc, ale teče všude', bottomRank: 3 },
];

export const FRIENDS: Friend[] = [
  { id: 'klara', name: 'Klára', nick: 'klara', initial: 'K', live: { pubId: 'pinkas', beers: 2, since: '20:10' }, lastSeen: 'Teď na pivu', level: 7 },
  { id: 'marek', name: 'Marek', nick: 'marek_stamgast', initial: 'M', live: { pubId: 'dlouha', beers: 1, since: '20:40' }, lastSeen: 'Teď na pivu', level: 9 },
  { id: 'jirka', name: 'Jirka z Žižkova', nick: 'jirka', initial: 'J', lastSeen: 'Naposledy včera · U Vystřelenýho oka', level: 6 },
  { id: 'petra', name: 'Petra', nick: 'petra', initial: 'P', lastSeen: 'Naposledy minulý týden', level: 4 },
  { id: 'ondra', name: 'Ondra', nick: 'ondra', initial: 'O', lastSeen: 'Zatím jste spolu nebyli', level: 2 },
];

export const PLANS: Plan[] = [
  {
    id: 'klara-doma',
    from: 'Kláry',
    fromId: 'klara',
    dayNum: '31',
    dayName: 'Zítra, sobota',
    time: '19:00',
    place: 'U Kláry doma',
    home: true,
    address: 'Bořivojova 54, Praha 3',
    note: 'Vařím guláš. Pivo vezměte, sklenice mám.',
    going: ['M', 'J'],
    my: null,
  },
  {
    id: 'marek-dlouha',
    from: 'Marka',
    fromId: 'marek',
    dayNum: '30',
    dayName: 'Dnes, pátek',
    time: '20:00',
    place: 'Lokál Dlouhááá',
    pubId: 'dlouha',
    note: 'Držím stůl u okna.',
    going: ['M', 'J', 'T'],
    my: 'jdu',
  },
];

export const TONIGHT: Drink[] = [
  { id: 'd3', beerId: 'pilsner', size: '0,5 l', kind: 'čepované', price: 59, time: '21:05' },
  { id: 'd2', beerId: 'pilsner', size: '0,5 l', kind: 'čepované', price: 59, time: '20:22' },
  { id: 'd1', beerId: 'kozel', size: '0,5 l', kind: 'čepované', price: 59, time: '19:41' },
];

export const EVENINGS: Evening[] = [
  { id: 'e-1024', date: '2026-10-24', dayLabel: 'So 24. 10.', pubIds: ['dlouha', 'pinkas'], beers: 5, spent: 274, from: '19:10', to: '23:20', photo: 7 },
  { id: 'e-1022', date: '2026-10-22', dayLabel: 'Čt 22. 10.', pubIds: ['medvidek'], beers: 2, spent: 124, from: '19:00', to: '21:15' },
  { id: 'e-1016', date: '2026-10-16', dayLabel: 'Pá 16. 10.', pubIds: ['tygr'], beers: 3, spent: 177, from: '18:30', to: '21:45' },
  { id: 'e-1009', date: '2026-10-09', dayLabel: 'Pá 9. 10.', pubIds: ['pinkas'], beers: 3, spent: 177, from: '19:00', to: '22:10' },
  { id: 'e-1003', date: '2026-10-03', dayLabel: 'So 3. 10.', pubIds: ['oko', 'dlouha'], beers: 6, spent: 296, from: '16:00', to: '23:40', photo: 3 },
];

/** The mock's "today": the diary and counter are set in the evening of 28. 10. 2026. */
export const TODAY = { y: 2026, m: 10, d: 28, label: 'St 28. 10.' };

export const FEED: FeedPost[] = [
  { id: 'f1', user: 'PivniVlk', initial: 'P', city: 'Brno', when: 'dnes 23:40', scope: 'celý svět', beers: 6, route: 'Pegas → Lokál U Caipla', duration: '5 h 20 min', rounds: 12, photo: 8 },
  { id: 'f2', user: 'klara', initial: 'K', city: 'Praha', when: 'dnes 22:10', scope: 'parta', beers: 3, route: 'U Pinkasů', duration: '2 h 05 min', rounds: 4, photo: 13, friend: true },
  { id: 'f3', user: 'Ostravak', initial: 'O', city: 'Ostrava', when: 'včera 01:20', scope: 'celý svět', beers: 8, route: 'Stodolní → Les', duration: '6 h 10 min', rounds: 31 },
  { id: 'f4', user: 'marek_stamgast', initial: 'M', city: 'Praha', when: 'včera 23:50', scope: 'parta', beers: 5, route: 'Lokál Dlouhááá', duration: '4 h', rounds: 7, photo: 7, friend: true },
];

export const BADGES: Badge[] = [
  { id: 'carkar', name: 'Čárkař', icon: 'beer', level: 'II', got: true },
  { id: 'poutnik', name: 'Poutník', icon: 'map', level: 'I', got: true },
  { id: 'parta', name: 'Parta', icon: 'users', level: 'I', got: true },
  { id: 'chatar', name: 'Chatař', icon: 'house', level: '', got: true },
  { id: 'ochutnavac', name: 'Ochutnávač', icon: 'medal', level: 'II', got: true },
  { id: 'mapar', name: 'Mapér', icon: 'map-pin-plus', level: 'I', got: true },
  { id: 'fotograf', name: 'FotoPivař', icon: 'camera', level: 'I', got: true },
  { id: 'tyden', name: 'Celý týden', icon: 'calendar-days', level: '', got: true },
  { id: 'nocni', name: 'Noční pták', icon: 'moon-star', level: '', got: true },
  { id: 'cestovatel', name: 'Cestovatel', icon: 'globe', level: '', got: false, progress: '3 z 5 měst' },
  { id: 'tour', name: 'Tour de pub', icon: 'route', level: '', got: false, progress: '0 z 1' },
  { id: 'sbirka', name: 'Sběratel', icon: 'list-ordered', level: '', got: false, progress: '27 z 50 piv' },
  { id: 'tajny', name: '???', icon: 'lock', level: '', got: false, secret: true },
];

export const ME = {
  nick: 'tomas',
  initial: 'T',
  level: 5,
  title: 'Pivař',
  xp: 340,
  xpNext: 500,
  lifetime: 142,
  since: '3. 6. 2025',
  pubs: 38,
  evenings: 61,
  avg: '2,3',
  spent: '9 870 Kč',
  email: 'tomas@example.cz',
};

export function pubById(id: string | null | undefined): Pub | undefined {
  return PUBS.find((p) => p.id === id);
}

export function beerById(id: string | null | undefined): Beer | undefined {
  return BEERS.find((b) => b.id === id);
}

export function friendById(id: string | null | undefined): Friend | undefined {
  return FRIENDS.find((f) => f.id === id);
}

export function formatDistance(m: number): { value: string; unit: string } {
  if (m < 1000) return { value: String(m), unit: 'm' };
  return { value: (m / 1000).toFixed(1).replace('.', ','), unit: 'km' };
}

export function kc(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Kč`;
}
