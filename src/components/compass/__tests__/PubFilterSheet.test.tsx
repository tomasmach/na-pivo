import React from 'react';
import { cs } from '@/i18n/cs';
import { PubFilterSheet } from '../PubFilterSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement('AnimatedView', props, children),
    },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = require('react');
  const icon = () => ReactModule.createElement('Icon');
  return {
    AccessibilityIcon: icon,
    BeerIcon: icon,
    CheckIcon: icon,
    CircleDotIcon: icon,
    CreditCardIcon: icon,
    MicIcon: icon,
    MapPinnedIcon: icon,
    RadioIcon: icon,
    SearchIcon: icon,
    SoccerBallIcon: icon,
    SquareParkingIcon: icon,
    TargetIcon: icon,
    TreePineIcon: icon,
    TvIcon: icon,
    WifiIcon: icon,
    XIcon: icon,
  };
});

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { extrabold: 'display-extrabold' },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/theme/shadows', () => ({ softDrop: () => ({}) }));
jest.mock('@/data/beerSuggestionsClient', () => ({
  POPULAR_BEER_BRANDS: [
    { key: 'pilsner-urquell', label: 'Pilsner Urquell', short: 'Pilsner' },
  ],
  suggestBeerBrands: jest.fn(async () => []),
}));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function renderSheet(onApply = jest.fn(), onClose = jest.fn(), nearbyPrices: number[] = []) {
  let renderer: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(
      <PubFilterSheet
        visible
        value={{ beerBrand: null, amenityKeys: [], priceMinCzk: null, priceMaxCzk: null }}
        nearbyPrices={nearbyPrices}
        onClose={onClose}
        onApply={onApply}
      />,
    );
  });
  return { renderer: renderer!, onApply, onClose };
}

describe('PubFilterSheet', () => {
  it('keeps other tap places off by default and applies the explicit opt-in', () => {
    const { renderer, onApply } = renderSheet();

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.toggleOtherTapPlaces }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.applyPubFilters }).props.onPress();
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ includeOtherPlaces: true }),
    );
  });

  it('keeps choices as a draft until the user applies them', () => {
    const { renderer, onApply, onClose } = renderSheet();

    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.togglePubAmenityFilter('Platba kartou'),
      }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.togglePubAmenityFilter('Stolní fotbal'),
      }).props.onPress();
    });

    expect(onApply).not.toHaveBeenCalled();

    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.applyPubFilters }).props.onPress();
    });

    expect(onApply).toHaveBeenCalledWith({
      beerBrand: null,
      amenityKeys: ['payment_card', 'game_foosball'],
      priceMinCzk: null,
      priceMaxCzk: null,
      includeOtherPlaces: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('combines one beer brand with multiple amenities', () => {
    const { renderer, onApply } = renderSheet();

    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.selectBeerBrand('Pilsner Urquell'),
      }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({
        accessibilityLabel: cs.a11y.togglePubAmenityFilter('Šipky'),
      }).props.onPress();
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.applyPubFilters }).props.onPress();
    });

    expect(onApply).toHaveBeenCalledWith({
      beerBrand: { key: 'pilsner-urquell', label: 'Pilsner' },
      amenityKeys: ['game_darts'],
      priceMinCzk: null,
      priceMaxCzk: null,
      includeOtherPlaces: false,
    });
  });

  it('renders only amenities marked as map-filterable', () => {
    const { renderer } = renderSheet();

    expect(renderer.root.findAllByProps({
      accessibilityLabel: cs.a11y.togglePubAmenityFilter('Jukebox'),
    })).toHaveLength(0);
    expect(renderer.root.findAllByProps({
      accessibilityLabel: cs.a11y.togglePubAmenityFilter('Živá hudba'),
    })).toHaveLength(0);
  });

  it('applies a price range through two independent slider thumbs', () => {
    const { renderer, onApply } = renderSheet(jest.fn(), jest.fn(), [35, 42, 48, 55, 69]);
    const minSlider = renderer.root.findByProps({
      accessibilityLabel: cs.a11y.priceFilterMinSlider,
    });
    const maxSlider = renderer.root.findByProps({
      accessibilityLabel: cs.a11y.priceFilterMaxSlider,
    });

    act(() => {
      minSlider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    });
    act(() => {
      maxSlider.props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } });
    });
    act(() => {
      renderer.root.findByProps({ accessibilityLabel: cs.a11y.applyPubFilters }).props.onPress();
    });

    expect(onApply).toHaveBeenCalledWith({
      beerBrand: null,
      amenityKeys: [],
      priceMinCzk: 35,
      priceMaxCzk: 70,
      includeOtherPlaces: false,
    });
  });
});
