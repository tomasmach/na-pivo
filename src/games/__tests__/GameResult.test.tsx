/* eslint-disable import/first */

import React from 'react';
import { AccessibilityInfo, Platform, ScrollView } from 'react-native';
import { render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ BeerIcon: () => null, PlusIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { View }: typeof import('react-native') = jest.requireActual('react-native');
  const transition = { duration: () => transition, delay: () => transition };
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(View, props, children),
    },
    FadeIn: transition,
    FadeInDown: transition,
    useReducedMotion: () => true,
  };
});

import { GameResult } from '@/games/GameResult';

it('keeps a long result scrollable with the final action still available', () => {
  const players = Array.from({ length: 16 }, (_, index) => ({
    id: `player-${index}`,
    name: `Hráč ${index + 1}`,
    tint: '#E8A317',
  }));
  const view = render(
    <GameResult
      players={players}
      outcome={{
        scores: players.map((player, index) => ({ playerId: player.id, score: 20 - index })),
        winnerId: players[0].id,
      }}
      onDone={jest.fn()}
    />,
  );

  expect(view.UNSAFE_getByType(ScrollView)).toBeTruthy();
  expect(screen.getByText('Vyhrává Hráč 1')).toBeTruthy();
  expect(screen.getByText('Nejvíc bodů u stolu.')).toBeTruthy();
  expect(screen.getByLabelText('Konec')).toBeTruthy();
  expect(screen.queryByText(/rána|zasloužil/i)).toBeNull();
});

it('uses the neutral saved-result ending when nobody won or paid', () => {
  render(
    <GameResult
      players={[]}
      outcome={{ scores: [], winnerId: null, payingId: null }}
      onDone={jest.fn()}
    />,
  );

  expect(screen.getByText('Dohráno')).toBeTruthy();
  expect(screen.getByText('Výsledek zůstal u večera.')).toBeTruthy();
});

it('announces the ending as one assertive summary built from the existing title and note', () => {
  render(
    <GameResult
      players={[{ id: 'p1', name: 'Hráč 1', tint: '#E8A317' }]}
      outcome={{ scores: [], winnerId: 'p1', payingId: null }}
      onDone={jest.fn()}
    />,
  );

  const summary = screen.getByLabelText('Vyhrává Hráč 1. Nejvíc bodů u stolu.');
  expect(summary.props.accessible).toBe(true);
  expect(summary.props.accessibilityLiveRegion).toBe('assertive');
  expect(screen.getByLabelText('Konec').props.accessibilityRole).toBe('button');
});

it('builds the same summary label for the payer and neutral endings', () => {
  const payerView = render(
    <GameResult
      players={[{ id: 'p1', name: 'Kája', tint: '#E8A317' }]}
      outcome={{ scores: [], winnerId: null, payingId: 'p1' }}
      onDone={jest.fn()}
    />,
  );
  expect(payerView.getByLabelText('Platí Kája. Další runda je jasná.')).toBeTruthy();
  payerView.unmount();

  render(
    <GameResult
      players={[]}
      outcome={{ scores: [], winnerId: null, payingId: null }}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Dohráno. Výsledek zůstal u večera.')).toBeTruthy();
});

it('reads each ranking row as a single label with rank, name and displayed score', () => {
  render(
    <GameResult
      players={[
        { id: 'a', name: 'Hráč 1', tint: '#E8A317' },
        { id: 'b', name: 'Hráč 2', tint: '#E8A317' },
      ]}
      outcome={{
        scores: [
          { playerId: 'a', score: 20 },
          { playerId: 'b', score: 12 },
        ],
        winnerId: 'a',
      }}
      onDone={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('1. Hráč 1 20')).toBeTruthy();
  expect(screen.getByLabelText('2. Hráč 2 12')).toBeTruthy();
});

it('includes the displayed suffix verbatim in the ranking row label', () => {
  render(
    <GameResult
      players={[]}
      outcome={{ scores: [], winnerId: null, payingId: null }}
      board={[{ name: 'Kája', score: 4, suffix: '3× trefa' }]}
      onDone={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('1. Kája 3× trefa')).toBeTruthy();
});

describe('GameResult screen-reader announcements', () => {
  // The repo RN mock is partial: announceForAccessibility is attached here and
  // removed again so other suites sharing the mock stay untouched.
  const announce = jest.fn();
  const realOS = Platform.OS;

  beforeEach(() => {
    (AccessibilityInfo as unknown as Record<string, unknown> &
      typeof AccessibilityInfo).announceForAccessibility = announce;
    Platform.OS = 'ios';
    announce.mockClear();
  });

  afterEach(() => {
    Platform.OS = realOS;
  });

  afterAll(() => {
    delete (AccessibilityInfo as unknown as Record<string, unknown>).announceForAccessibility;
    Platform.OS = realOS;
  });

  it('announces the exact grouped summary label once when the result screen appears', () => {
    render(
      <GameResult
        players={[{ id: 'p1', name: 'Hráč 1', tint: '#E8A317' }]}
        outcome={{ scores: [], winnerId: 'p1' }}
        onDone={jest.fn()}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Vyhrává Hráč 1. Nejvíc bodů u stolu.');
    expect(screen.getByLabelText('Konec').props.accessibilityRole).toBe('button');
  });

  it('does not announce again for identical rerenders, fresh equivalent data or a reconnect-like repeat', () => {
    const players = [{ id: 'p1', name: 'Hráč 1', tint: '#E8A317' }];
    const outcome = { scores: [], winnerId: 'p1' };
    const view = render(<GameResult players={players} outcome={outcome} onDone={jest.fn()} />);
    announce.mockClear();

    view.rerender(<GameResult players={players} outcome={outcome} onDone={jest.fn()} />);
    view.rerender(
      <GameResult
        players={[...players]}
        outcome={{ ...outcome }}
        onDone={jest.fn()}
      />,
    );
    view.rerender(
      <GameResult
        players={players.map((player) => ({ ...player }))}
        outcome={{ scores: [], winnerId: 'p1' }}
        onDone={jest.fn()}
      />,
    );

    expect(announce).not.toHaveBeenCalled();
  });

  it('announces a genuinely changed result label exactly once', () => {
    const players = [
      { id: 'p1', name: 'Hráč 1', tint: '#E8A317' },
      { id: 'p2', name: 'Hráč 2', tint: '#E8A317' },
    ];
    const view = render(
      <GameResult
        players={players}
        outcome={{ scores: [], winnerId: 'p1' }}
        onDone={jest.fn()}
      />,
    );
    announce.mockClear();

    view.rerender(
      <GameResult
        players={players}
        outcome={{ scores: [], winnerId: null, payingId: 'p2' }}
        onDone={jest.fn()}
      />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Platí Hráč 2. Další runda je jasná.');
  });

  it('keeps Android fully declarative with zero imperative calls', () => {
    Platform.OS = 'android';
    render(
      <GameResult
        players={[{ id: 'p1', name: 'Hráč 1', tint: '#E8A317' }]}
        outcome={{ scores: [], winnerId: 'p1' }}
        onDone={jest.fn()}
      />,
    );

    expect(announce).not.toHaveBeenCalled();
    const summary = screen.getByLabelText('Vyhrává Hráč 1. Nejvíc bodů u stolu.');
    expect(summary.props.accessible).toBe(true);
    expect(summary.props.accessibilityRole).toBe('header');
    expect(summary.props.accessibilityLiveRegion).toBe('assertive');
    expect(screen.getByLabelText('Konec').props.accessibilityRole).toBe('button');
  });
});
