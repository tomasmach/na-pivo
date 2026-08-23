/* eslint-disable import/first */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

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
      spectator
      onDone={onDone}
    />,
  );

  expect(screen.getByLabelText('Platí Hráč 1')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Zpátky k večeru'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('does not let a spectator spin or publish a pick', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const onPicked = jest.fn();
  render(
    <RoundDrumShell players={PLAYERS} pickedId={null} spectator onPicked={onPicked} />,
  );

  const action = screen.getByLabelText('Roztoč');
  expect(action.props.accessibilityState.disabled).toBe(true);
  fireEvent.press(action);

  expect(onPicked).not.toHaveBeenCalled();
});

describe('result announcements (iOS imperative)', () => {
  const originalOS = Platform.OS;
  let announce: jest.Mock;
  const randomSpyFactory = () => jest.spyOn(Math, 'random');

  beforeEach(() => {
    announce = jest.fn();
    (
      AccessibilityInfo as { announceForAccessibility?: unknown }
    ).announceForAccessibility = announce;
    (Platform as unknown as { OS: string }).OS = 'ios';
  });

  afterEach(() => {
    delete (AccessibilityInfo as { announceForAccessibility?: unknown })
      .announceForAccessibility;
    (Platform as unknown as { OS: string }).OS = originalOS;
    jest.restoreAllMocks();
  });

  const base = { players: PLAYERS };

  it('announces a fresh canonical payer once and does not repeat on same props', () => {
    const view = render(<RoundDrumShell {...base} pickedId={null} />);
    expect(announce).not.toHaveBeenCalled();

    view.rerender(<RoundDrumShell {...base} pickedId="honza" />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Platí Honza');

    view.rerender(<RoundDrumShell {...base} pickedId="honza" />);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('does not announce when mounted with an existing canonical payer', () => {
    render(<RoundDrumShell {...base} pickedId="honza" spectator />);
    expect(announce).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Platí Honza')).toBeTruthy();
  });

  it('announces a reduced-motion local result once', () => {
    const randomSpy = randomSpyFactory();
    randomSpy.mockReturnValue(0);
    render(
      <RoundDrumShell {...base} pickedId={null} onPicked={jest.fn()} />,
    );
    fireEvent.press(screen.getByLabelText('Roztoč'));
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Platí Hráč 1');
  });

  it('announces again when a distinct stable id shares the displayed name', () => {
    const twins = [
      { id: 'a', name: 'Honza', tint: '#111111' },
      { id: 'b', name: 'Honza', tint: '#222222' },
    ];
    const view = render(<RoundDrumShell players={twins} pickedId={null} />);
    expect(announce).not.toHaveBeenCalled();

    view.rerender(<RoundDrumShell players={twins} pickedId="a" />);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Platí Honza');

    view.rerender(<RoundDrumShell players={twins} pickedId="b" />);
    expect(announce).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenLastCalledWith('Platí Honza');
  });

  it('announces a repeated same-player reduced-motion result after the lock clears', () => {
    jest.useFakeTimers();
    try {
      const randomSpy = randomSpyFactory();
      randomSpy.mockReturnValue(0);
      render(
        <RoundDrumShell {...base} pickedId={null} onPicked={jest.fn()} />,
      );

      fireEvent.press(screen.getByLabelText('Roztoč'));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Platí Hráč 1');

      act(() => {
        jest.advanceTimersByTime(350);
      });
      fireEvent.press(screen.getByLabelText('Roztoč znovu'));
      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenLastCalledWith('Platí Hráč 1');
    } finally {
      jest.useRealTimers();
    }
  });

  it('makes zero imperative announcements on Android', () => {
    (Platform as unknown as { OS: string }).OS = 'android';
    const view = render(<RoundDrumShell {...base} pickedId={null} />);
    view.rerender(<RoundDrumShell {...base} pickedId="honza" />);
    expect(announce).not.toHaveBeenCalled();
  });
});
