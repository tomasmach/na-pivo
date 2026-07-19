import React from 'react';
import { cs } from '@/i18n/cs';
import { fetchMyStats } from '@/data/statsClient';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import StatsScreenDefault from '../StatsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

// Keep the screen purely local — no backend overlay, no network.
jest.mock('@/data/statsClient', () => ({ fetchMyStats: jest.fn(async () => null) }));

// fonts.ts require()s .ttf assets jest can't transform — stub the font tokens.
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      regular: 'display-regular',
      medium: 'display-medium',
      semibold: 'display-semibold',
      bold: 'display-bold',
      extrabold: 'display-extrabold',
      black: 'display-extrabold',
    },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

// Icons render to SVG; stub them so the lean RN test mock is enough.
jest.mock('@/components/shared/IconGlyph', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});

const StatsScreen = StatsScreenDefault as React.ComponentType<{ embedded?: boolean }>;
const fetchMyStatsMock = fetchMyStats as jest.MockedFunction<typeof fetchMyStats>;

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let idSeq = 0;
function drink(minutesAgo: number, priceCzk = 50) {
  idSeq += 1;
  return {
    id: `id-${idSeq}`,
    beerName: 'Pilsner Urquell',
    priceCzk,
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

function session(over: Partial<TallySession>, drinks: ReturnType<typeof drink>[]): TallySession {
  return {
    clientId: over.clientId ?? 'visit-x',
    pubKey: over.pubKey ?? 'aaaaaaaa',
    pubName: over.pubName ?? 'U Zlatého tygra',
    startedAt: over.startedAt ?? drinks[0]?.at ?? new Date().toISOString(),
    drinks: drinks.map((d) => d as TallySession['drinks'][number]),
    ...(over.archivedReason ? { archivedReason: over.archivedReason } : {}),
  };
}

function flatTexts(renderer: { root: { findAllByType: (t: string) => { props: { children: unknown } }[] } }) {
  const out: string[] = [];
  for (const node of renderer.root.findAllByType('Text')) {
    const c = node.props.children;
    if (typeof c === 'string') out.push(c);
    else if (typeof c === 'number') out.push(String(c));
    else if (Array.isArray(c)) out.push(c.map((x) => (typeof x === 'object' ? '' : String(x))).join(''));
  }
  return out;
}

beforeEach(() => {
  idSeq = 0;
  fetchMyStatsMock.mockResolvedValue(null);
  act(() => {
    useTallyStore.setState({ current: null, history: [] });
  });
});

describe('StatsScreen', () => {
  it('shows the empty state with no drinks', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(StatsScreen, { embedded: true }));
    });
    const texts = flatTexts(renderer!);
    expect(texts).toContain(cs.stats.emptyTitle);
  });

  it('renders the hero, records, totals and top pubs from local sessions', () => {
    act(() => {
      useTallyStore.setState({
        current: session({ pubKey: 'aaaaaaaa', pubName: 'U Zlatého tygra' }, [
          drink(90),
          drink(50),
          drink(20),
        ]),
        history: [
          session(
            { pubKey: 'bbbbbbbb', pubName: 'Pivnice U Tří růží', startedAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
            [drink(5 * 1440), drink(5 * 1440 - 30)],
          ),
        ],
      });
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(React.createElement(StatsScreen, { embedded: true }));
    });
    const texts = flatTexts(renderer!);

    // Not empty.
    expect(texts).not.toContain(cs.stats.emptyTitle);
    // Section headers present.
    expect(texts).toContain(cs.stats.recordsHeader);
    expect(texts).toContain(cs.stats.totalsHeader);
    expect(texts).toContain(cs.stats.periodsHeader);
    expect(texts).toContain(cs.stats.monthsHeader);
    expect(texts).toContain(cs.stats.pubsHeader);
    // Hero count numeral (3 beers tonight) + pub name.
    expect(texts).toContain('3');
    expect(texts).toContain('U Zlatého tygra');
    // Both pubs appear in the top-pubs list.
    expect(texts).toContain('Pivnice U Tří růží');
    expect(texts).toContain(cs.stats.totalPubs);
  });

  it('hides an implausibly fast remote beer record', async () => {
    fetchMyStatsMock.mockResolvedValue({
      totalBeers: 2,
      totalEvenings: 1,
      distinctPubs: 1,
      totalSpentCzk: 100,
      firstDrinkAt: new Date().toISOString(),
      topPubs: [],
      records: {
        mostBeersInEvening: 2,
        mostBeersPubName: 'U Tygra',
        mostBeersDate: null,
        fastestBeerSeconds: 1,
        longestEveningSeconds: 1800,
      },
      periods: {
        timezone: 'Europe/Prague',
        months: [],
        years: [],
      },
    });

    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(StatsScreen, { embedded: true }));
      await Promise.resolve();
    });
    const texts = flatTexts(renderer!);

    expect(texts).not.toContain('1 s');
    expect(texts).toContain(cs.stats.recordEmpty);
  });
});
