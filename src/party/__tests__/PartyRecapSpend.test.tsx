/**
 * The recap's "Účtenka" section, rendered.
 *
 * `nightSpend` has its own unit test; this one proves the screen actually puts
 * the numbers on screen, keeps the section away when no price was ever filled
 * in, and says out loud that the total only covers the phone's owner.
 */

import React from 'react';

import type { NightDrink, NightRecord } from '@/party/nightRecord';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startedAt = new Date(2026, 8, 5, 18, 0).toISOString();

const mockNight: NightRecord = {
  id: 'night-1',
  code: null,
  startedAt,
  endedAt: new Date(2026, 8, 5, 22, 0).toISOString(),
  people: [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }],
  stops: [],
  drinks: [],
  games: [],
  photos: [],
};

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
    Share: { share: jest.fn() },
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));

jest.mock('@/components/shared/GlassIconButton', () => ({ GlassIconButton: 'GlassIconButton' }));
jest.mock('@/components/shared/IconGlyph', () => ({ Share2Icon: 'Share2Icon' }));
jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: 'PersonAvatar' }));
jest.mock('@/mocks/NightChart', () => ({ NightChart: 'NightChart' }));
jest.mock('@/mocks/NightRoute', () => ({ NightRoute: 'NightRoute' }));
jest.mock('@/mocks/StatGrid', () => ({ StatGrid: 'StatGrid' }));
jest.mock('@/mocks/SectionBreak', () => ({ SectionBreak: 'SectionBreak' }));
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 132 }));

jest.mock('@/party/useNightRecord', () => ({
  hasRenderableNightRecord: () => true,
  useNightRecord: () => mockNight,
}));

jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({ priceCurrency: 'CZK' }),
}));

// Mocks must be registered before the screen module is evaluated.
// eslint-disable-next-line import/first
import PartyRecapScreen from '@/party/PartyRecapScreen';

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

function beer(id: string, priceCzk?: number, beerName = 'Plzeň', by = 'me'): NightDrink {
  return {
    id,
    at: startedAt,
    by,
    beerName,
    drinkType: 'beer',
    stopId: null,
    ...(priceCzk !== undefined ? { priceCzk } : {}),
  };
}

/** Every rendered string, plus the section titles that live on SectionBreak. */
function renderText(): string {
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(<PartyRecapScreen />);
  });
  const texts = renderer!.root
    .findAllByType('Text')
    .map((node: { props: { children?: unknown } }) => JSON.stringify(node.props.children));
  const titles = renderer!.root
    .findAllByType('SectionBreak')
    .map((node: { props: { title?: string } }) => node.props.title ?? '');
  return [...texts, ...titles].join(' ');
}

describe('PartyRecapScreen receipt', () => {
  afterEach(() => {
    mockNight.drinks = [];
  });

  it('shows the total, the average and the priciest beer', () => {
    mockNight.drinks = [beer('a', 62), beer('b', 55), beer('c', 89, 'Matuška Raptor')];

    const text = renderText();

    expect(text).toContain('Účtenka');
    expect(text).toContain('206'); // 62 + 55 + 89
    expect(text).toContain('69'); // rounded average
    expect(text).toContain('Matuška Raptor');
  });

  it('says the total is only mine when every drink carried a price', () => {
    mockNight.drinks = [beer('a', 62)];

    expect(renderText()).toContain('jen tvoje zápisy');
  });

  it('admits how many of my drinks the total is missing', () => {
    mockNight.drinks = [beer('a', 62), beer('b'), beer('c')];

    expect(renderText()).toContain('1 ze 3');
  });

  it('stays away entirely when no beer carried a price', () => {
    mockNight.drinks = [beer('a'), beer('b')];

    expect(renderText()).not.toContain('Účtenka');
  });

  it('ignores everybody else, because their drinks carry no price', () => {
    mockNight.people = [
      { id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' },
      { id: 'pepa', name: 'Pepa', avatarUrl: null, tint: '#F0BE5C' },
    ];
    mockNight.drinks = [beer('a', 62), beer('b', 999, 'Cizí', 'pepa')];

    const text = renderText();

    expect(text).toContain('62');
    expect(text).not.toContain('999');
    mockNight.people = [{ id: 'me', name: 'Ty', avatarUrl: null, tint: '#E8A317' }];
  });
});
