/**
 * Unit tests for the two smallest blocks of the "Tácek" counter surface:
 *
 *  - NudgeSlot (block 3) — a fixed-height slot that holds AT MOST ONE nudge.
 *    The design rule under test: the slot reserves 52pt whether it is occupied
 *    or empty, so the CTA below it never jumps, and only one occupant is ever
 *    rendered.
 *  - CounterCta (block 4) — the single amber button. Under test: label /
 *    subLabel rendering and the 700 ms press-swallow that stops a fumbled
 *    double tap in a pub from logging two beers.
 *
 * Both are presentational, so the assertions are about rendered text,
 * callbacks firing and the reserved height — never about colors or fonts.
 */

import React from 'react';
import { cs as copy } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// IconGlyph wraps lucide-react-native / react-native-svg; the glyphs carry no
// behaviour these tests care about.
jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: jest.fn(() => null),
  CheckIcon: jest.fn(() => null),
  XIcon: jest.fn(() => null),
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const { NudgeSlot } = jest.requireActual('../NudgeSlot');
const { CounterCta } = jest.requireActual('../CounterCta');

type AnyInstance = { props: Record<string, any> };

const SLOT_HEIGHT = 52;

/** All rendered Text contents, flattened into one searchable string. */
function textOf(renderer: any): string {
  return renderer.root
    .findAllByType('Text')
    .map((node: AnyInstance) => node.props.children)
    .flat()
    .join(' ');
}

/**
 * The rendered Pressable carrying a given accessibility label. Matching on the
 * host element (not any instance with that prop) matters: CounterCta itself
 * takes `accessibilityLabel` + `onPress`, and calling its raw prop would skip
 * the debounce these tests exist to verify.
 */
function pressableWithLabel(renderer: any, label: string): AnyInstance {
  const hits = renderer.root.findAll(
    (node: any) => node.type === 'Pressable' && node.props?.accessibilityLabel === label,
  );
  expect(hits).toHaveLength(1);
  return hits[0];
}

function render(element: React.ReactElement): any {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-07-24T20:00:00Z'));
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('NudgeSlot — rapid nudge', () => {
  it('renders the warning text plus the confirm pill and fires onConfirm', () => {
    const onConfirm = jest.fn();
    const renderer = render(
      React.createElement(NudgeSlot, {
        nudge: {
          kind: 'rapid',
          text: 'To bylo rychlé, fakt další?',
          confirmLabel: 'Jo, dej to tam',
          onConfirm,
        },
      }),
    );

    expect(textOf(renderer)).toContain('To bylo rychlé, fakt další?');
    expect(textOf(renderer)).toContain('Jo, dej to tam');

    const confirm = pressableWithLabel(renderer, copy.a11y.counterRapidConfirm);
    act(() => confirm.props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('NudgeSlot — counted nudge (undo strip)', () => {
  it('renders the counted text plus the undo pill and fires onUndo', () => {
    const onUndo = jest.fn();
    const renderer = render(
      React.createElement(NudgeSlot, {
        nudge: {
          kind: 'counted',
          text: 'Pilsner Urquell připsán',
          undoLabel: 'Vrátit',
          onUndo,
        },
      }),
    );

    expect(textOf(renderer)).toContain('Pilsner Urquell připsán');
    expect(textOf(renderer)).toContain('Vrátit');

    const undo = pressableWithLabel(renderer, copy.a11y.counterUndoStrip);
    act(() => undo.props.onPress());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('NudgeSlot — dopito nudge', () => {
  it('renders the chip label as its own accessibility label and fires onPress', () => {
    const onPress = jest.fn();
    const renderer = render(
      React.createElement(NudgeSlot, {
        nudge: { kind: 'dopito', label: 'Dopito?', onPress },
      }),
    );

    expect(textOf(renderer)).toContain('Dopito?');

    const chip = pressableWithLabel(renderer, 'Dopito?');
    act(() => chip.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('NudgeSlot — checkin nudge', () => {
  it('renders the offer text and fires onPress and onDismiss independently', () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    const renderer = render(
      React.createElement(NudgeSlot, {
        nudge: {
          kind: 'checkin',
          text: 'Jak to tu vypadá?',
          ctaLabel: 'Ohodnotit',
          onPress,
          onDismiss,
        },
      }),
    );

    expect(textOf(renderer)).toContain('Jak to tu vypadá?');
    expect(textOf(renderer)).toContain('Ohodnotit');

    const cta = pressableWithLabel(renderer, 'Ohodnotit');
    act(() => cta.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    const dismiss = pressableWithLabel(renderer, copy.a11y.counterCheckinDismiss);
    act(() => dismiss.props.onPress());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('NudgeSlot — rank nudge', () => {
  it('renders the supplied node verbatim', () => {
    const renderer = render(
      React.createElement(NudgeSlot, {
        nudge: {
          kind: 'rank',
          node: React.createElement('Text', null, '3. místo v partě'),
        },
      }),
    );

    expect(textOf(renderer)).toContain('3. místo v partě');
  });
});

describe('NudgeSlot — slot geometry and exclusivity', () => {
  it('reserves the 52pt height even with no nudge, and renders nothing inside', () => {
    const renderer = render(React.createElement(NudgeSlot, { nudge: null }));

    const slot = renderer.toJSON();
    expect(slot.props.style.height).toBe(SLOT_HEIGHT);
    // Empty slot: no occupant at all, but the height above still holds.
    expect(slot.children).toBeNull();
    expect(renderer.root.findAllByType('Text')).toHaveLength(0);
  });

  it('keeps the same 52pt height and exactly one occupant for every kind', () => {
    const nudges = [
      { kind: 'rapid', text: 'rychle', confirmLabel: 'jo', onConfirm: jest.fn() },
      { kind: 'counted', text: 'pripsano', undoLabel: 'vratit', onUndo: jest.fn() },
      { kind: 'dopito', label: 'dopito', onPress: jest.fn() },
      {
        kind: 'checkin',
        text: 'ohodnot',
        ctaLabel: 'jdem',
        onPress: jest.fn(),
        onDismiss: jest.fn(),
      },
      { kind: 'rank', node: React.createElement('Text', null, 'rank') },
    ];

    for (const nudge of nudges) {
      const renderer = render(React.createElement(NudgeSlot, { nudge }));
      const slot = renderer.toJSON();
      expect(slot.props.style.height).toBe(SLOT_HEIGHT);
      // The union type admits one kind at a time; the slot renders exactly one
      // child for it and drops the other four branches entirely.
      expect(slot.children).toHaveLength(1);
    }
  });
});

describe('CounterCta — rendering', () => {
  it('renders the label, the subLabel and the accessibility label', () => {
    const renderer = render(
      React.createElement(CounterCta, {
        label: 'Ještě jedno',
        subLabel: 'Pilsner Urquell',
        onPress: jest.fn(),
        accessibilityLabel: 'Ještě jedno, Pilsner Urquell',
      }),
    );

    expect(textOf(renderer)).toContain('Ještě jedno');
    expect(textOf(renderer)).toContain('Pilsner Urquell');
    expect(pressableWithLabel(renderer, 'Ještě jedno, Pilsner Urquell')).toBeTruthy();
  });

  it('omits the subLabel line when it is null or empty', () => {
    for (const subLabel of [null, '']) {
      const renderer = render(
        React.createElement(CounterCta, {
          label: 'Zapiš pivo',
          subLabel,
          onPress: jest.fn(),
          accessibilityLabel: 'Zapiš pivo',
        }),
      );
      const texts = renderer.root
        .findAllByType('Text')
        .map((node: AnyInstance) => node.props.children);
      expect(texts).toEqual(['Zapiš pivo']);
    }
  });

  it('uses a real disabled state and never forwards a disabled press', () => {
    const onPress = jest.fn();
    const renderer = render(
      React.createElement(CounterCta, {
        label: 'Uložit',
        subLabel: 'Uvidí to ostatní pivaři',
        onPress,
        accessibilityLabel: 'Uložit doplněné údaje',
        disabled: true,
      }),
    );
    const cta = pressableWithLabel(
      renderer,
      'Uložit doplněné údaje',
    );

    expect(cta.props.disabled).toBe(true);
    expect(cta.props.accessibilityState).toEqual({ disabled: true });
    act(() => cta.props.onPress());
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('CounterCta — press debounce', () => {
  function renderCta(label: string, onPress: jest.Mock) {
    return render(
      React.createElement(CounterCta, {
        label,
        subLabel: null,
        onPress,
        accessibilityLabel: label,
      }),
    );
  }

  it('fires onPress on a single tap', () => {
    const onPress = jest.fn();
    const renderer = renderCta('Ještě jedno', onPress);

    act(() => pressableWithLabel(renderer, 'Ještě jedno').props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows a second press 300 ms later', () => {
    const onPress = jest.fn();
    const renderer = renderCta('Ještě jedno', onPress);
    const cta = pressableWithLabel(renderer, 'Ještě jedno');

    act(() => cta.props.onPress());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    act(() => cta.props.onPress());

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lets a press through once the 700 ms window has elapsed', () => {
    const onPress = jest.fn();
    const renderer = renderCta('Ještě jedno', onPress);
    const cta = pressableWithLabel(renderer, 'Ještě jedno');

    act(() => cta.props.onPress());
    act(() => {
      jest.advanceTimersByTime(300);
    });
    act(() => cta.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(400);
    });
    act(() => cta.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('resets the window when the label changes, because that is a new action', () => {
    const onPress = jest.fn();
    const renderer = renderCta('Pokračovat ve večeru', onPress);

    act(() => pressableWithLabel(renderer, 'Pokračovat ve večeru').props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);

    act(() => {
      renderer.update(
        React.createElement(CounterCta, {
          label: 'Ještě jedno',
          subLabel: null,
          onPress,
          accessibilityLabel: 'Ještě jedno',
        }),
      );
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Well inside the 700 ms window, but it is a different action now.
    act(() => pressableWithLabel(renderer, 'Ještě jedno').props.onPress());
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
