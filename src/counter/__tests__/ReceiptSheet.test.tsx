/**
 * "Tvůj účet" — pure presentational tests for the receipt sheet.
 *
 * The sheet takes plain props and emits callbacks; there is no store, no queue
 * and no network here. The load-bearing rules under test:
 *   - beers are listed before everything else,
 *   - every line states its count (and its own money when known),
 *   - the minus hands back the exact item it belongs to,
 *   - "Celkem" only exists when there is a total (outside a pub there is none),
 *   - and the sheet offers NO way to add a drink (adding lives in "Co si dáš?").
 */

import React from 'react';
import TestRenderer, { act, ReactTestInstance } from 'react-test-renderer';

import { ReceiptSheet, type ReceiptItem, type ReceiptSheetProps } from '@/counter/ReceiptSheet';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

// This suite owns the receipt's pure content contract. Native presentation and
// cross-sheet serialization are covered by BottomSheetModal's lifecycle tests.
jest.mock('@/components/shared/BottomSheetModal', () => {
  const ReactModule = jest.requireActual('react') as typeof import('react');
  const { Pressable } = jest.requireActual('react-native') as typeof import('react-native');
  return {
    BottomSheetModal: ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
      <>
        {ReactModule.createElement(Pressable, {
          importantForAccessibility: 'no',
          onPress: onClose,
        })}
        {children}
      </>
    ),
  };
});

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: (c: unknown) => c },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  withSpring: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
  useReducedMotion: jest.fn(() => true),
}));

// theme/fonts pulls in .ttf assets jest can't parse — stub the tokens.
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

jest.mock('@/components/shared/IconGlyph', () => ({
  MinusIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
}));
jest.mock('@/components/shared/CloseButton', () => ({
  CloseButton: ({ onPress, label }: { onPress: () => void; label: string }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Pressable, {
      onPress,
      accessibilityRole: 'button',
      accessibilityLabel: label,
    }),
}));

const t = cs.counter;

const PILSNER: ReceiptItem = {
  key: 'beer:pilsner-urquell:500',
  name: 'Pilsner Urquell',
  meta: '0,5 l',
  count: 3,
  totalLabel: '186 Kč',
};
const KOZEL: ReceiptItem = {
  key: 'beer:kozel-11:500',
  name: 'Kozel 11',
  meta: '0,5 l',
  count: 1,
  totalLabel: '52 Kč',
};
const KOFOLA: ReceiptItem = {
  key: 'other:kofola:300',
  name: 'Kofola',
  meta: '0,3 l',
  count: 2,
  totalLabel: '78 Kč',
};

function renderSheet(overrides: Partial<ReceiptSheetProps> = {}) {
  const props: ReceiptSheetProps = {
    visible: true,
    startedAtLabel: null,
    beerItems: [PILSNER, KOZEL],
    otherItems: [KOFOLA],
    totalLabel: '316 Kč',
    onRemove: jest.fn(),
    onDone: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<ReceiptSheet {...props} />);
  });
  return { renderer, props };
}

/** Every rendered Text, in render order, flattened to a plain string. */
function texts(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => (node.type as unknown) === 'Text', { deep: true })
    .map((node) =>
      React.Children.toArray(node.props.children as React.ReactNode)
        .filter((child) => typeof child === 'string' || typeof child === 'number')
        .join(''),
    );
}

/** Interactive controls only — the backdrop shares a label with the X button. */
function buttonWithLabel(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
): ReactTestInstance {
  return renderer.root.find(
    (node) =>
      // Host nodes only: the RN mock renders each component through a composite
      // of the same name, so every element would otherwise match twice.
      typeof node.type === 'string' &&
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === label,
  );
}

function press(instance: ReactTestInstance) {
  act(() => {
    (instance.props.onPress as () => void)();
  });
}

describe('ReceiptSheet — ordering', () => {
  it('lists beers before the other drinks', () => {
    const { renderer } = renderSheet();
    const rendered = texts(renderer);

    const pilsner = rendered.indexOf(PILSNER.name);
    const kozel = rendered.indexOf(KOZEL.name);
    const kofola = rendered.indexOf(KOFOLA.name);

    expect(pilsner).toBeGreaterThanOrEqual(0);
    expect(pilsner).toBeLessThan(kozel);
    expect(kozel).toBeLessThan(kofola);
  });

  it('keeps beers first even when the beer list arrives after the other list in props order', () => {
    // otherItems given first in the object literal must not change render order.
    const { renderer } = renderSheet({ otherItems: [KOFOLA], beerItems: [PILSNER] });
    const rendered = texts(renderer);

    expect(rendered.indexOf(PILSNER.name)).toBeLessThan(rendered.indexOf(KOFOLA.name));
  });
});

describe('ReceiptSheet — line contents', () => {
  it('shows the per-identity count for every line', () => {
    const { renderer } = renderSheet();
    const rendered = texts(renderer);

    expect(rendered).toContain(`${t.perBeerCount(3)} · 0,5 l`);
    expect(rendered).toContain(`${t.perBeerCount(1)} · 0,5 l`);
    expect(rendered).toContain(`${t.perBeerCount(2)} · 0,3 l`);
  });

  it('drops the meta suffix but keeps the count when the item has no meta', () => {
    const { renderer } = renderSheet({
      beerItems: [{ ...PILSNER, meta: null }],
      otherItems: [],
    });

    expect(texts(renderer)).toContain(t.perBeerCount(3));
  });

  it("renders each line's own total when it has one", () => {
    const { renderer } = renderSheet();
    const rendered = texts(renderer);

    expect(rendered).toContain('186 Kč');
    expect(rendered).toContain('52 Kč');
    expect(rendered).toContain('78 Kč');
  });

  it('renders no per-line money when the price is unknown', () => {
    const { renderer } = renderSheet({
      beerItems: [{ ...PILSNER, totalLabel: null }],
      otherItems: [],
      totalLabel: null,
    });
    const rendered = texts(renderer);

    // The line is still there, only the money is gone.
    expect(rendered).toContain(PILSNER.name);
    expect(rendered.some((line) => line.includes('Kč'))).toBe(false);
  });
});

describe('ReceiptSheet — minus', () => {
  it('calls onRemove with the item that owns the pressed minus', () => {
    const { renderer, props } = renderSheet();

    press(buttonWithLabel(renderer, cs.a11y.counterRemoveIdentity(KOZEL.name)));

    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onRemove).toHaveBeenCalledWith(KOZEL);
  });

  it('gives every line its own minus, including the non-beer ones', () => {
    const { renderer, props } = renderSheet();

    press(buttonWithLabel(renderer, cs.a11y.counterRemoveIdentity(KOFOLA.name)));
    press(buttonWithLabel(renderer, cs.a11y.counterRemoveIdentity(PILSNER.name)));

    expect((props.onRemove as jest.Mock).mock.calls.map(([item]) => item)).toEqual([
      KOFOLA,
      PILSNER,
    ]);
  });
});

describe('ReceiptSheet — Celkem row', () => {
  it('renders the total row when a total is known', () => {
    const { renderer } = renderSheet({ totalLabel: '316 Kč' });
    const rendered = texts(renderer);

    expect(rendered).toContain(t.receiptTotal);
    expect(rendered).toContain('316 Kč');
  });

  it('hides the total row entirely outside a pub, where prices are optional', () => {
    const { renderer } = renderSheet({
      beerItems: [{ ...PILSNER, totalLabel: null }],
      otherItems: [],
      totalLabel: null,
    });
    const rendered = texts(renderer);

    expect(rendered).not.toContain(t.receiptTotal);
    expect(rendered).toContain(PILSNER.name);
  });

  it('hides the total row when there is nothing on the account at all', () => {
    const { renderer } = renderSheet({ beerItems: [], otherItems: [], totalLabel: '0 Kč' });

    expect(texts(renderer)).not.toContain(t.receiptTotal);
  });
});

describe('ReceiptSheet — header', () => {
  it('renders the start time when it is provided', () => {
    const started = t.receiptStarted('19:40');
    const { renderer } = renderSheet({ startedAtLabel: started });

    expect(texts(renderer)).toContain(started);
  });

  it('renders no start line when there is none', () => {
    const { renderer } = renderSheet({ startedAtLabel: null });
    const rendered = texts(renderer);

    expect(rendered).toContain(t.receiptTitle);
    expect(rendered.some((line) => line.startsWith('Načato'))).toBe(false);
  });
});

describe('ReceiptSheet — controls', () => {
  it('fires onDone from the close-the-evening button, not onClose', () => {
    const { renderer, props } = renderSheet();

    press(buttonWithLabel(renderer, cs.a11y.counterDone));

    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('fires onClose from the X button, not onDone', () => {
    const { renderer, props } = renderSheet();

    press(buttonWithLabel(renderer, cs.a11y.counterCloseModal));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('dismisses on a backdrop press', () => {
    const { renderer, props } = renderSheet();

    // The backdrop dismisses but is hidden from screen readers — only the real
    // close button announces itself, so VoiceOver hears "Zavřít" exactly once.
    // The first one is the scrim: `BottomSheetModal` renders it before the card,
    // and the card has a hidden press-swallower of its own further down.
    const backdrop = renderer.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        node.props.importantForAccessibility === 'no' &&
        typeof node.props.onPress === 'function',
    )[0];
    press(backdrop);

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReceiptSheet — the mirror rule', () => {
  it('exposes no add affordance anywhere on the sheet', () => {
    const { renderer } = renderSheet({ startedAtLabel: t.receiptStarted('19:40') });

    expect(texts(renderer)).not.toContain(t.pickAddBeer);

    const labels = renderer.root
      .findAll(() => true, { deep: true })
      .map((node) => node.props?.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string');

    expect(labels).not.toContain(cs.a11y.counterAddBeer);
    expect(labels).not.toContain(t.pickAddBeer);
  });

  it('exposes no add affordance on an empty account either', () => {
    const { renderer } = renderSheet({ beerItems: [], otherItems: [], totalLabel: null });

    expect(texts(renderer)).not.toContain(t.pickAddBeer);
    expect(texts(renderer)).toContain(t.receiptClose);
  });
});
