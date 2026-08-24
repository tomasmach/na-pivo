/**
 * "Co si dáš?" pick sheet — pure presentational contract.
 *
 * The sheet is dumb on purpose: rows in, callbacks out. These tests pin the
 * behaviour the Tácek rebuild depends on — ordering (tonight before the pub
 * menu), captions only when both groups exist, one add-a-beer entry point, and
 * the hard rule that this sheet can never remove anything (removing lives in
 * the "Tvůj účet" receipt sheet only).
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { cs } from '@/i18n/cs';
import { DrinkPickSheet, type DrinkPickRow } from '../DrinkPickSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// This suite owns the sheet's pure content contract. Native presentation and
// cross-sheet serialization are covered by BottomSheetModal's lifecycle tests.
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement('AnimatedView', props, children),
    },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => true,
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});

jest.mock('@/components/shared/IconGlyph', () => {
  const ReactModule = jest.requireActual('react');
  const icon = () => ReactModule.createElement('Icon');
  return { CupSodaIcon: icon, PlusIcon: icon, RefreshCwIcon: icon, XIcon: icon };
});

jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: { bold: 'display-bold', extrabold: 'display-extrabold' },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/theme/shadows', () => ({ softDrop: () => ({}) }));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

type Renderer = ReturnType<typeof TestRenderer.create>;

const row = (over: Partial<DrinkPickRow> & { key: string; name: string }): DrinkPickRow => ({
  meta: '0,5 l · 55 Kč',
  count: 0,
  hasPrice: true,
  ...over,
});

const TONIGHT: DrinkPickRow[] = [
  row({ key: 't-pilsner', name: 'Pilsner Urquell', meta: '0,5 l · 62 Kč', count: 2 }),
  row({ key: 't-kozel', name: 'Kozel 11', meta: 'Bez ceny', count: 1, hasPrice: false }),
];
const MENU: DrinkPickRow[] = [
  row({ key: 'm-radegast', name: 'Radegast 12', meta: '0,5 l · 49 Kč', count: 0 }),
];

function render(props: Partial<React.ComponentProps<typeof DrinkPickSheet>> = {}) {
  const handlers = {
    onCountRow: jest.fn(),
    onEditRow: jest.fn(),
    onAddBeer: jest.fn(),
    onAddOther: jest.fn(),
    onClose: jest.fn(),
  };
  let renderer: Renderer;
  act(() => {
    renderer = TestRenderer.create(
      <DrinkPickSheet
        visible
        isPub
        tonightRows={TONIGHT}
        menuRows={MENU}
        {...handlers}
        {...props}
      />,
    );
  });
  return { renderer: renderer!, ...handlers };
}

/** Every rendered string, in render order. */
function texts(renderer: Renderer): string[] {
  return renderer.root
    .findAllByType('Text')
    .flatMap((node: { props: { children?: unknown } }) =>
      (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).filter(
        (child: unknown): child is string => typeof child === 'string',
      ),
    );
}

/** Every accessibilityLabel in the tree, host and composite nodes alike. */
function labels(renderer: Renderer): string[] {
  return renderer.root
    .findAll(() => true, { deep: true })
    .map((node: { props?: { accessibilityLabel?: unknown } }) => node.props?.accessibilityLabel)
    .filter((label: unknown): label is string => typeof label === 'string');
}

/** First pressable node carrying `label` (composite + host share the props). */
function pressable(renderer: Renderer, label: string, role?: string) {
  const matches = renderer.root.findAll(
    (node: { props: Record<string, unknown> }) =>
      node.props?.accessibilityLabel === label &&
      typeof node.props?.onPress === 'function' &&
      (role === undefined || node.props?.accessibilityRole === role),
    { deep: true },
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
}

describe('DrinkPickSheet', () => {
  it("renders tonight's rows before the pub menu rows", () => {
    const { renderer } = render();
    const rendered = texts(renderer);

    expect(rendered).toEqual(expect.arrayContaining(['Pilsner Urquell', 'Kozel 11', 'Radegast 12']));
    expect(rendered.indexOf('Pilsner Urquell')).toBeLessThan(rendered.indexOf('Kozel 11'));
    expect(rendered.indexOf('Kozel 11')).toBeLessThan(rendered.indexOf('Radegast 12'));
  });

  it('shows both section captions only when both groups are non-empty', () => {
    const both = render().renderer;
    expect(texts(both)).toEqual(
      expect.arrayContaining([cs.counter.outsideMenuHeader, cs.counter.menuHeader]),
    );

    const tonightOnly = render({ menuRows: [] }).renderer;
    expect(texts(tonightOnly)).not.toContain(cs.counter.outsideMenuHeader);
    expect(texts(tonightOnly)).not.toContain(cs.counter.menuHeader);
    expect(texts(tonightOnly)).toContain('Pilsner Urquell');

    const menuOnly = render({ tonightRows: [] }).renderer;
    expect(texts(menuOnly)).not.toContain(cs.counter.outsideMenuHeader);
    expect(texts(menuOnly)).not.toContain(cs.counter.menuHeader);
    expect(texts(menuOnly)).toContain('Radegast 12');
  });

  it('hands the tapped row straight back to onCountRow', () => {
    const { renderer, onCountRow, onEditRow } = render();

    act(() => {
      pressable(renderer, cs.a11y.counterCountBeer('Radegast 12', '0,5 l · 49 Kč')).props.onPress();
    });
    expect(onCountRow).toHaveBeenCalledTimes(1);
    expect(onCountRow).toHaveBeenCalledWith(MENU[0]);

    act(() => {
      pressable(renderer, cs.a11y.counterCountBeerNoPrice('Kozel 11')).props.onPress();
    });
    expect(onCountRow).toHaveBeenLastCalledWith(TONIGHT[1]);
    expect(onEditRow).not.toHaveBeenCalled();
  });

  it('long-press edits the row inside a pub', () => {
    const { renderer, onEditRow, onCountRow } = render();

    act(() => {
      pressable(renderer, cs.a11y.counterCountBeer('Pilsner Urquell', '0,5 l · 62 Kč')).props.onLongPress();
    });

    expect(onEditRow).toHaveBeenCalledTimes(1);
    expect(onEditRow).toHaveBeenCalledWith(TONIGHT[0]);
    expect(onCountRow).not.toHaveBeenCalled();
  });

  it('has no long-press handler outside a pub', () => {
    const { renderer, onEditRow } = render({ isPub: false, menuRows: [] });

    const node = pressable(renderer, cs.a11y.counterCountBeer('Pilsner Urquell', '0,5 l · 62 Kč'));
    expect(node.props.onLongPress).toBeUndefined();
    expect(onEditRow).not.toHaveBeenCalled();
  });

  it('badges only the rows already drunk tonight', () => {
    const { renderer } = render();
    const rendered = texts(renderer);

    expect(rendered).toContain(cs.counter.perBeerCount(2));
    expect(rendered).toContain(cs.counter.perBeerCount(1));
    expect(rendered).not.toContain(cs.counter.perBeerCount(0));
    // Exactly the two tonight rows carry a badge; the menu row (count 0) does not.
    expect(rendered.filter((text) => /^\d+×$/.test(text))).toHaveLength(2);
  });

  it('wires the two bottom action rows', () => {
    const { renderer, onAddBeer, onAddOther } = render();

    expect(texts(renderer)).toContain(cs.counter.pickAddBeer);
    act(() => {
      pressable(renderer, cs.a11y.counterAddBeer).props.onPress();
    });
    expect(onAddBeer).toHaveBeenCalledTimes(1);
    expect(onAddOther).not.toHaveBeenCalled();

    act(() => {
      pressable(renderer, cs.counter.pickNonBeer).props.onPress();
    });
    expect(onAddOther).toHaveBeenCalledTimes(1);
    expect(onAddBeer).toHaveBeenCalledTimes(1);
  });

  it('explains an empty pub and relabels the first action', () => {
    const { renderer, onAddBeer } = render({ tonightRows: [], menuRows: [] });
    const rendered = texts(renderer);

    expect(rendered).toContain(cs.counter.pickEmptyPub);
    expect(rendered).not.toContain(cs.counter.pickEmptyOutside);
    expect(rendered).toContain(cs.counter.pickFirstBeer);
    expect(rendered).not.toContain(cs.counter.pickAddBeer);

    act(() => {
      pressable(renderer, cs.a11y.counterAddBeer).props.onPress();
    });
    expect(onAddBeer).toHaveBeenCalledTimes(1);
  });

  it('explains an empty outside-the-pub sheet with its own copy', () => {
    const { renderer } = render({ isPub: false, tonightRows: [], menuRows: [] });
    const rendered = texts(renderer);

    expect(rendered).toContain(cs.counter.pickEmptyOutside);
    expect(rendered).not.toContain(cs.counter.pickEmptyPub);
    expect(rendered).toContain(cs.counter.pickFirstBeer);
  });

  it('marks a rotating pub menu as the latest confirmed snapshot', () => {
    const { renderer } = render({ beerMenuRotates: true });
    const rendered = texts(renderer);

    expect(rendered).toContain(cs.counter.rotatingMenuHint);

    const empty = render({
      beerMenuRotates: true,
      tonightRows: [],
      menuRows: [],
    }).renderer;
    expect(texts(empty)).toContain(cs.counter.rotatingMenuBadge);
  });

  it('closes on the close button', () => {
    const { renderer, onClose } = render();

    act(() => {
      pressable(renderer, cs.a11y.counterCloseModal, 'button').props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never offers removing anything', () => {
    const { renderer } = render();
    const rendered = labels(renderer);
    const allRows = [...TONIGHT, ...MENU];

    for (const item of allRows) {
      expect(rendered).not.toContain(cs.a11y.counterRemoveBeer(item.name));
      expect(rendered).not.toContain(cs.a11y.counterRemoveIdentity(item.name));
    }
    // Both remove labels share this stem — nothing in the sheet may use it.
    const removeStem = cs.a11y.counterRemoveBeer('').trim();
    expect(rendered.filter((label) => label.includes(removeStem))).toHaveLength(0);
  });

  it('lets short content size the sheet and does not group it into one accessibility element', () => {
    const { renderer } = render({ tonightRows: [], menuRows: [] });
    const allNodes = renderer.root.findAll(() => true, { deep: true });
    expect(allNodes.some((node: { props?: { style?: unknown } }) => {
      const style = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined;
      return typeof style?.minHeight === 'string';
    })).toBe(false);
    const unlabeledGroupingPressables = allNodes.filter(
      (node: { props?: Record<string, unknown> }) =>
        typeof node.props?.onPress === 'function' &&
        node.props.accessibilityRole === undefined &&
        node.props.accessibilityElementsHidden !== true &&
        node.props.importantForAccessibility !== 'no-hide-descendants',
    );
    expect(unlabeledGroupingPressables).toHaveLength(0);
  });
});
