import React from 'react';
import { StyleSheet, Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { Colors } from '@/theme/colors';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('expo-glass-effect', () => ({
  GlassView: (props: Record<string, unknown>) => React.createElement('GlassView', props),
  isLiquidGlassAvailable: () => false,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

import {
  COLLAPSING_BAR_HEIGHT,
  CollapsingHeader,
  barFadeRange,
  useCollapsingHeader,
} from '../CollapsingHeader';

function Host() {
  const { progress } = useCollapsingHeader(40);
  return (
    <CollapsingHeader progress={progress} title="Na pivo">
      <Text>action</Text>
    </CollapsingHeader>
  );
}

type Flat = { backgroundColor?: string; height?: number; position?: string };

function styles(renderer: TestRenderer.ReactTestRenderer): Flat[] {
  return renderer.root
    .findAll(() => true, { deep: true })
    .map((node) => StyleSheet.flatten(node.props.style as never) as Flat)
    .filter((style): style is Flat => style != null);
}

function render(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Host />);
  });
  return renderer;
}

describe('CollapsingHeader', () => {
  // The bar has to be gone at the top of the list (the big title is the
  // heading there) and fully formed by the time the title has scrolled out.
  it('fades in over the last stretch before the title leaves', () => {
    expect(barFadeRange(40)).toEqual([16, 40]);
    // A threshold inside the fade distance still yields a rising range rather
    // than a zero-width one, which would make the interpolation undefined.
    expect(barFadeRange(8)).toEqual([0, 8]);
    expect(barFadeRange(0)).toEqual([0, 1]);
  });

  it('reserves the safe area plus one control row', () => {
    expect(styles(render())).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ position: 'absolute', height: 47 + COLLAPSING_BAR_HEIGHT }),
      ]),
    );
  });

  // §15.2: liquid glass only exists on iOS 26, so the bar must still be an
  // opaque surface everywhere else — otherwise the content it is meant to hide
  // shows straight through it.
  it('falls back to an opaque stout surface where liquid glass is missing', () => {
    const renderer = render();

    expect(JSON.stringify(renderer.toJSON())).not.toContain('GlassView');
    expect(styles(renderer).some((style) => style.backgroundColor === Colors.stout)).toBe(true);
  });

  it('keeps the trailing controls on the bar', () => {
    expect(JSON.stringify(render().toJSON())).toContain('action');
  });
});
