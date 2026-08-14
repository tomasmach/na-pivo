import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { PanResponder } from 'react-native';

import { BarChart, barIndexAt } from '@/mocks/BarChart';

describe('barIndexAt', () => {
  it('walks every bucket as a finger moves across the plot', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 99, 100].map((x) => barIndexAt(x, 100, 4))).toEqual([
      0,
      0,
      1,
      1,
      2,
      2,
      3,
      3,
      3,
    ]);
  });

  it('clamps outside touches and rejects an unmeasured plot', () => {
    expect(barIndexAt(-10, 100, 4)).toBe(0);
    expect(barIndexAt(140, 100, 4)).toBe(3);
    expect(barIndexAt(10, 0, 4)).toBeNull();
    expect(barIndexAt(10, 100, 0)).toBeNull();
  });
});

describe('BarChart scrubbing', () => {
  it('uses the measured plot width while dragging and clears on release', () => {
    const onScrub = jest.fn();
    const rendered = render(
      React.createElement(BarChart, {
        points: [
          { label: 'I', value: 1 },
          { label: 'II', value: 2 },
          { label: 'III', value: 3 },
          { label: 'IV', value: 4 },
        ],
        onScrub,
      }),
    );
    fireEvent(rendered.getByTestId('bar-chart-plot'), 'layout', {
      nativeEvent: { layout: { width: 100 } },
    });

    const create = PanResponder.create as jest.Mock;
    const handlers = create.mock.calls.at(-1)?.[0] as {
      onPanResponderMove: (event: { nativeEvent: { locationX: number } }) => void;
      onPanResponderRelease: () => void;
    };
    act(() => handlers.onPanResponderMove({ nativeEvent: { locationX: 60 } }));
    act(() => handlers.onPanResponderRelease());

    expect(onScrub.mock.calls).toEqual([[2], [null]]);
  });

  it('leaves a vertical swipe to the scrolling page', () => {
    render(
      React.createElement(BarChart, {
        points: [
          { label: 'I', value: 1 },
          { label: 'II', value: 2 },
        ],
      }),
    );

    const create = PanResponder.create as jest.Mock;
    const handlers = create.mock.calls.at(-1)?.[0] as {
      onMoveShouldSetPanResponderCapture: (
        event: unknown,
        gesture: { dx: number; dy: number },
      ) => boolean;
    };
    const capture = (dx: number, dy: number) =>
      handlers.onMoveShouldSetPanResponderCapture({}, { dx, dy });

    expect(capture(0, 40)).toBe(false);
    expect(capture(9, 40)).toBe(false);
    expect(capture(3, 0)).toBe(false);
    expect(capture(40, 9)).toBe(true);
    expect(capture(-40, 9)).toBe(true);
  });
});
