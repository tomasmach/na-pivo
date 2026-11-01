import { create } from 'zustand';

import type { StopState } from './tour';
import { EVENINGS, PLANS, PUBS, TONIGHT, beerById, pubById, type Drink, type Evening, type Plan, type PlanResponse, type Pub } from './data';

export { dialog, toast, type Dialog, type DialogAction, type Toast, type ToastKind } from '../ui/store';

export type KompasScenario = 'normal' | 'empty' | 'error' | 'noresults';

type MockState = {
  pubId: string;
  tonight: Drink[];
  lastDrinkSize: string;
  plans: Plan[];
  evenings: Evening[];
  addEvening: (e: Evening) => void;
  visibleToParta: boolean;
  favorites: string[];
  ratings: Record<string, number>;
  watched: string[];
  watchAlerts: boolean;
  openNow: boolean;
  maxPrice: number | null;
  beerFilter: string | null;
  targetId: string;
  mapView: 'okoli' | 'stopy' | 'parta';
  pinMode: 'price' | 'count';
  onlyDrunk: boolean;
  tags: string[];
  surprise: boolean;
  tourActive: boolean;
  tourStops: StopState[];
  tourParty: string[];
  tourStarted: string | null;
  tourDone: boolean;
  stamgastMode: 'pocitat' | 'denik' | 'tour';
  tourBanner: number | null;
  markStop: (i: number, state: StopState) => void;
  startTour: () => void;
  endTour: () => void;
  shareMode: 'all' | 'parta' | null;
  offline: boolean;
  kompas: KompasScenario;
  addedPubs: boolean;
  promileEnabled: boolean;
  atHome: boolean;
  stickerNudge: boolean;
  emailUnverified: boolean;
  singleLogin: boolean;
  atFriend: string | null;
  partaRequest: boolean;
  pivaEarly: boolean;
  newBeerNudge: string | null;
  lastEvening: { beers: number; spent: number; pubIds: string[]; from: string; to: string } | null;
  homeSet: boolean;
  badgeDot: boolean;

  addDrink: (beerId?: string, opts?: { price?: number; size?: string; kind?: string }) => void;
  removeLastDrink: () => void;
  endEvening: () => void;
  setPub: (pubId: string) => void;
  respond: (planId: string, r: PlanResponse) => void;
  addPlan: (p: Plan) => void;
  setVisible: (v: boolean) => void;
  toggleFavorite: (pubId: string) => void;
  rate: (beerId: string, stars: number) => void;
  toggleWatch: (beerId: string) => void;
  nextTarget: () => void;
  toggleTag: (tag: string) => void;
  set: (patch: Partial<MockState>) => void;
};

function clock(): string {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const useMock = create<MockState>((set, get) => ({
  pubId: 'tygr',
  tonight: TONIGHT,
  lastDrinkSize: '0,5 l',
  plans: PLANS,
  evenings: EVENINGS,
  addEvening: (e) => set({ evenings: [e, ...get().evenings.filter((x) => x.date !== e.date)] }),
  visibleToParta: true,
  favorites: ['tygr'],
  ratings: { pilsner: 5, kozel: 3 },
  watched: ['raptor', 'unetice'],
  watchAlerts: true,
  openNow: true,
  maxPrice: 60,
  beerFilter: null,
  targetId: 'tygr',
  mapView: 'okoli',
  pinMode: 'price',
  onlyDrunk: false,
  tags: [],
  surprise: false,
  tourActive: false,
  tourStops: ['todo', 'todo', 'todo', 'todo', 'todo'],
  tourParty: [],
  tourStarted: null,
  tourDone: false,
  stamgastMode: 'pocitat',
  tourBanner: null,
  markStop: (i, state) => set({ tourStops: get().tourStops.map((x, j) => (j === i ? state : x)) }),
  startTour: () => set({ tourActive: true, tourStarted: '20:04', tourStops: ['todo', 'todo', 'todo', 'todo', 'todo'], tourDone: false, tourParty: [] }),
  endTour: () => set({ tourActive: false, tourDone: true, stamgastMode: 'pocitat' }),
  shareMode: null,
  offline: false,
  kompas: 'normal',
  addedPubs: true,
  promileEnabled: false,
  atHome: false,
  stickerNudge: false,
  emailUnverified: false,
  singleLogin: false,
  atFriend: null,
  partaRequest: true,
  pivaEarly: false,
  newBeerNudge: null,
  lastEvening: null,
  homeSet: false,
  badgeDot: true,

  addDrink: (beerId, opts) => {
    if (get().tourActive) {
      const i = get().tourStops.findIndex((x) => x === 'todo');
      if (i >= 0) set({ tourStops: get().tourStops.map((x, j) => (j === i ? 'visited' : x)), tourBanner: i });
    }
    const last = get().tonight[0];
    const id = beerId ?? last?.beerId ?? 'pilsner';
    const pub = pubById(get().pubId);
    const tap = pub?.taps.find((t) => t.beerId === id);
    const drink: Drink = {
      id: `d${Date.now()}`,
      beerId: id,
      size: opts?.size ?? tap?.size ?? last?.size ?? '0,5 l',
      kind: opts?.kind ?? 'čepované',
      price: opts?.price ?? tap?.price ?? last?.price ?? 59,
      time: clock(),
    };
    set({ tonight: [drink, ...get().tonight], lastDrinkSize: drink.size });
  },
  removeLastDrink: () => set({ tonight: get().tonight.slice(1) }),
  endEvening: () => {
    const tonight = get().tonight;
    set({
      tonight: [],
      lastEvening: tonight.length
        ? {
            beers: tonight.length,
            spent: tonight.reduce((sum, d) => sum + d.price, 0),
            pubIds: [get().pubId],
            from: tonight[tonight.length - 1].time,
            to: tonight[0].time,
          }
        : get().lastEvening,
    });
  },
  setPub: (pubId) => set({ pubId }),
  respond: (planId, r) => set({ plans: get().plans.map((p) => (p.id === planId ? { ...p, my: r } : p)) }),
  addPlan: (p) => set({ plans: [p, ...get().plans] }),
  setVisible: (v) => set({ visibleToParta: v }),
  toggleFavorite: (pubId) => {
    const f = get().favorites;
    set({ favorites: f.includes(pubId) ? f.filter((x) => x !== pubId) : [...f, pubId] });
  },
  rate: (beerId, stars) => set({ ratings: { ...get().ratings, [beerId]: stars } }),
  toggleWatch: (beerId) => {
    const w = get().watched;
    set({ watched: w.includes(beerId) ? w.filter((x) => x !== beerId) : [...w, beerId] });
  },
  nextTarget: () => {
    const list = matchingPubs(get());
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === get().targetId);
    set({ targetId: list[(i + 1) % list.length].id });
  },
  toggleTag: (tag) => {
    const tags = get().tags;
    set({ tags: tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag] });
  },
  set: (patch) => set(patch),
}));

export function useTonight() {
  const tonight = useMock((s) => s.tonight);
  const spent = tonight.reduce((sum, d) => sum + d.price, 0);
  const last = tonight[0];
  const lastBeer = beerById(last?.beerId);
  return { tonight, count: tonight.length, spent, last, lastBeer };
}


/** Pubs that pass the current filters, nearest first. */
export function matchingPubs(st: Pick<MockState, 'openNow' | 'maxPrice' | 'beerFilter' | 'tags' | 'onlyDrunk'>): Pub[] {
  return PUBS.filter((p) => p.distance < 2000)
    .filter((p) => !st.openNow || p.open)
    .filter((p) => st.maxPrice === null || p.price === null || p.price <= st.maxPrice)
    .filter((p) => !st.beerFilter || p.taps.some((t) => t.beerId === st.beerFilter))
    .filter((p) => st.tags.every((tag) => (p.tags as string[]).includes(tag)))
    .filter((p) => !st.onlyDrunk || (p.lastWeekBeers ?? 0) > 0)
    .sort((a, b) => a.distance - b.distance);
}
