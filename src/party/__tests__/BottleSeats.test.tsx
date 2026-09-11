import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { BottleSeats, bottleSeatPosition, bottleNeedsRoster } from '@/party/BottleSeats';

const players = [
  { id: 'one', name: 'Adam', tint: '#7DD66B' },
  { id: 'two', name: 'Alexandr Dlouhé Jméno', tint: '#6FB3D9' },
];

function layOut() {
  fireEvent(screen.UNSAFE_getAllByType(View).find(node => node.props.onLayout)!, 'layout', {
    nativeEvent: { layout: { width: 300, height: 360 } },
  });
}

it('keeps full native names accessible and distinguishes matching initials', () => {
  render(<BottleSeats players={players} selectedId="two" crowded={false} />);
  layOut();
  expect(screen.getByLabelText('Adam').props.accessibilityState.selected).toBe(false);
  expect(screen.getByLabelText('Alexandr Dlouhé Jméno').props.accessibilityState.selected).toBe(true);
});

it('does not stack full labels over a large table; only the chosen seat is named there', () => {
  const crowd = Array.from({ length: 64 }, (_, i) => ({ id: String(i), name: `Player ${i}`, tint: '#7DD66B' }));
  render(<BottleSeats players={crowd} selectedId="42" crowded />);
  layOut();
  expect(screen.getByLabelText('Player 42')).toBeTruthy();
  expect(screen.queryByLabelText('Player 41')).toBeNull();
});

it.each([2, 3, 5, 8, 12, 64])('keeps %i seats in bounds and on their physics heading', count => {
  for (const [width, height] of [[270, 300], [360, 470]]) {
    for (let index = 0; index < count; index++) {
      const { x, y } = bottleSeatPosition(width, height, index, count);
      expect(x - 44).toBeGreaterThanOrEqual(0);
      expect(x + 44).toBeLessThanOrEqual(width);
      expect(y - 24).toBeGreaterThanOrEqual(0);
      expect(y + 55).toBeLessThanOrEqual(height);
      const angle = index / count * Math.PI * 2;
      expect((x-width/2)*Math.cos(angle) + (y-height/2)*Math.sin(angle)).toBeCloseTo(0);
    }
  }
});

it('uses the readable roster for eight seats on small screens', () => {
  expect(bottleNeedsRoster(270, 300, 8)).toBe(true);
  expect(bottleNeedsRoster(300, 360, 8)).toBe(true);
  expect(bottleNeedsRoster(360, 470, 8)).toBe(false);
  expect(bottleNeedsRoster(270, 300, 6)).toBe(false);
  expect(bottleNeedsRoster(360, 470, 64)).toBe(true);
});
