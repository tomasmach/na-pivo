/* eslint-disable import/first */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));

import { RoundDrumShell } from '@/party/shells/RoundDrumShell';

const PLAYERS = [
  { id: 'anonymous-1', name: '', tint: '#483511' },
  { id: 'honza', name: 'Honza', tint: '#2B3940' },
];

it('chooses and publishes a stable id once on a reduced-motion double tap', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const onPicked = jest.fn();
  render(
    <RoundDrumShell players={PLAYERS} pickedId={null} onPicked={onPicked} />,
  );

  const action = screen.getByLabelText('Roztoč');
  fireEvent.press(action);
  fireEvent.press(action);

  expect(onPicked).toHaveBeenCalledTimes(1);
  expect(onPicked).toHaveBeenCalledWith('anonymous-1');
});

it('renders an anonymous player and a canonical finished result without another spin', () => {
  const onDone = jest.fn();
  render(
    <RoundDrumShell
      players={PLAYERS}
      pickedId="anonymous-1"
      readOnly
      onDone={onDone}
    />,
  );

  expect(screen.getByLabelText('Platí Hráč 1')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Zpátky k večeru'));
  expect(onDone).toHaveBeenCalledTimes(1);
});
