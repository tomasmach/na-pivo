import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { PubFilterChips } from '@/pubs/PubFilterChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronDownIcon: () => null,
}));

jest.mock('@/mocks/MenuChip', () => ({
  MenuChip: ({ value }: { value: string }) => React.createElement('MenuChip', { value }),
}));

jest.mock('@/pubs/BeerFilterSheet', () => ({
  BeerFilterSheet: () => null,
}));

jest.mock('@/components/compass/PubFilterSheet', () => ({
  PubFilterSheet: (props: Record<string, unknown>) =>
    React.createElement('PubFilterSheet', props),
}));

function renderBar(
  onFilters = jest.fn(),
  filterOverrides: Partial<React.ComponentProps<typeof PubFilterChips>['filters']> = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <PubFilterChips
        sort="nearest"
        onSort={jest.fn()}
        beerOptions={[{ key: 'pilsner-urquell', label: 'Pilsner Urquell' }]}
        nearbyPrices={[]}
        filters={{
          beers: [],
          openOnly: false,
          tankOnly: false,
          amenityKeys: [],
          includeOtherPlaces: false,
          priceMinCzk: null,
          priceMaxCzk: null,
          ...filterOverrides,
        }}
        onFilters={onFilters}
      />,
    );
  });
  return { renderer, onFilters };
}

describe('PubFilterChips', () => {
  it('keeps scrolling chips inside the sheet gutter', () => {
    const { renderer } = renderBar();
    const scroller = renderer.root.findByProps({ testID: 'pub-filter-scroller' });

    expect(StyleSheet.flatten(scroller.props.style)).toMatchObject({
      marginHorizontal: MockLayout.screenPad,
    });
    expect(StyleSheet.flatten(scroller.props.contentContainerStyle)).not.toHaveProperty(
      'paddingHorizontal',
    );
  });

  it('exposes the variant B filters in the horizontal bar', () => {
    const { renderer } = renderBar();
    const labels = renderer.root.findAllByType(Text).map((node) => node.props.children);

    expect(labels).toEqual(
      expect.arrayContaining([
        cs.pubList.beerChip,
        cs.pubList.toggleOpen,
        'Cena',
        cs.mapPub.amenities.payment_card.short,
        cs.pubList.toggleGarden,
        'Hry',
        'Další',
      ]),
    );
  });

  it('toggles card payment directly without opening another sheet', () => {
    const { renderer, onFilters } = renderBar();

    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.togglePubAmenityFilter(
          cs.mapPub.amenities.payment_card.label,
        ),
      }).props.onPress();
    });

    expect(onFilters).toHaveBeenCalledWith(
      expect.objectContaining({ amenityKeys: ['payment_card'] }),
    );
  });

  it('opens the full sheet with the limit warning instead of dropping a filter', () => {
    const { renderer, onFilters } = renderBar(jest.fn(), {
      tankOnly: true,
      amenityKeys: [
        'seating_garden',
        'seating_barrier_free',
        'game_darts',
        'game_billiards',
      ],
    });

    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.togglePubAmenityFilter(
          cs.mapPub.amenities.payment_card.label,
        ),
      }).props.onPress();
    });

    expect(onFilters).not.toHaveBeenCalled();
    expect(renderer.root.findByType('PubFilterSheet' as never).props).toMatchObject({
      visible: true,
      initialSection: 'all',
      limitReachedInitially: true,
    });
  });

  it.each([
    [cs.pubList.priceChipA11y, 'price'],
    [cs.pubList.gamesChipA11y, 'games'],
    [cs.pubList.moreFiltersChipA11y, 'all'],
  ] as const)('opens %s at the matching section', (accessibilityLabel, initialSection) => {
    const { renderer } = renderBar();

    act(() => {
      renderer.root.findByProps({ accessibilityLabel }).props.onPress();
    });

    expect(renderer.root.findByType('PubFilterSheet' as never).props).toMatchObject({
      visible: true,
      showBeerFilter: false,
      showTankFilter: true,
      initialSection,
    });
  });
});
