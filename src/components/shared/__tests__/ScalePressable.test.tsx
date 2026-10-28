import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { GlowButton } from '@/components/shared/GlowButton';
import { ListRow, RoundButton } from '@/components/shared/FlatPage';
import { PressScale, ScalePressable } from '@/components/shared/ScalePressable';
import { ToneContext } from '@/layout/pane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/components/shared/IconGlyph', () => new Proxy({}, { get: () => () => null }));

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

function render(element: React.ReactElement) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

const pressable = (renderer: any, label: string) =>
  renderer.root.find((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel === label);

function look(renderer: any, label: string) {
  const style = StyleSheet.flatten(pressable(renderer, label).props.style);
  return { scale: style.transform?.[0]?.scale, opacity: style.opacity };
}

function press(renderer: any, label: string, phase: 'onPressIn' | 'onPressOut') {
  act(() => pressable(renderer, label).props[phase]({ nativeEvent: {} }));
}

async function setReduceMotion(enabled: boolean) {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(enabled);
}

afterEach(() => setReduceMotion(false));

describe('ScalePressable', () => {
  it('sinks on press-in and comes back on release, without delaying the press', () => {
    const onPress = jest.fn();
    const onPressIn = jest.fn();
    const onPressOut = jest.fn();
    const renderer = render(
      <ScalePressable
        accessibilityLabel="tile"
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
      />,
    );
    expect(look(renderer, 'tile')).toEqual({ scale: 1, opacity: 1 });

    press(renderer, 'tile', 'onPressIn');
    expect(look(renderer, 'tile')).toEqual({ scale: PressScale.default, opacity: 1 });
    expect(onPressIn).toHaveBeenCalledTimes(1);

    press(renderer, 'tile', 'onPressOut');
    act(() => pressable(renderer, 'tile').props.onPress());
    expect(look(renderer, 'tile')).toEqual({ scale: 1, opacity: 1 });
    expect(onPressOut).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('only dims under reduce motion, and keeps a disabled look as the resting opacity', async () => {
    await setReduceMotion(true);
    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <ScalePressable accessibilityLabel="tile" style={{ opacity: 0.5 }} onPress={jest.fn()} />,
      );
    });
    expect(look(renderer, 'tile')).toEqual({ scale: 1, opacity: 0.5 });

    press(renderer, 'tile', 'onPressIn');
    expect(look(renderer, 'tile')).toEqual({ scale: 1, opacity: 0.35 });

    press(renderer, 'tile', 'onPressOut');
    expect(look(renderer, 'tile')).toEqual({ scale: 1, opacity: 0.5 });
  });

  it('passes accessibility, testID, hitSlop and disabled through to the pressable', () => {
    const renderer = render(
      <ScalePressable
        testID="tile-id"
        accessibilityLabel="tile"
        accessibilityRole="button"
        accessibilityState={{ disabled: true }}
        accessibilityHint="hint"
        hitSlop={8}
        disabled
        onPress={jest.fn()}
      />,
    );
    expect(pressable(renderer, 'tile').props).toMatchObject({
      testID: 'tile-id',
      accessibilityRole: 'button',
      accessibilityState: { disabled: true },
      accessibilityHint: 'hint',
      hitSlop: 8,
      disabled: true,
    });
  });
});

describe('shared buttons', () => {
  it('presses the amber button deeper than the quiet one', () => {
    const renderer = render(
      <>
        <GlowButton label="amber" onPress={jest.fn()} />
        <GlowButton label="pill" variant="secondary" onPress={jest.fn()} />
        <ToneContext.Provider value="quiet">
          <GlowButton label="quiet" onPress={jest.fn()} />
        </ToneContext.Provider>
      </>,
    );
    for (const [label, scale] of [
      ['amber', PressScale.primary],
      ['pill', PressScale.default],
      ['quiet', PressScale.default],
    ] as const) {
      press(renderer, label, 'onPressIn');
      expect(look(renderer, label).scale).toBe(scale);
    }
  });

  it('keeps the GlowButton busy state and press target', () => {
    const onPress = jest.fn();
    const renderer = render(<GlowButton label="Ještě jedno" testID="cta" loading onPress={onPress} />);
    const button = pressable(renderer, 'Ještě jedno');
    expect(button.props).toMatchObject({
      testID: 'cta',
      disabled: true,
      accessibilityRole: 'button',
      accessibilityState: { disabled: true, busy: true },
    });
  });

  it('presses a full-width row only slightly and a round button like a pill', () => {
    const renderer = render(
      <>
        <ListRow title="Row" onPress={jest.fn()} />
        <RoundButton label="Round" onPress={jest.fn()}>
          {null}
        </RoundButton>
      </>,
    );
    press(renderer, 'Row', 'onPressIn');
    press(renderer, 'Round', 'onPressIn');
    expect(look(renderer, 'Row').scale).toBe(PressScale.row);
    expect(look(renderer, 'Round').scale).toBe(PressScale.default);
  });
});
