/**
 * The shared stage: the frame every game is played on.
 *
 * These tests guard the parts of the redesign that are behaviour and not
 * decoration — the deck counter, the single amber pill, the lettered quiz
 * tiles, the card's rank and suit — because those are the pieces a later
 * refactor would silently drop while the screen still "looks fine".
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(RNView, props, children),
      Text: RNText,
    },
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    FadeIn: { duration: () => undefined },
    FadeInDown: { delay: () => ({ duration: () => undefined }), duration: () => undefined },
    FadeOut: { duration: () => undefined },
    SlideInRight: { duration: () => undefined },
    SlideOutLeft: { duration: () => undefined },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    withSequence: (...values: unknown[]) => values.at(-1),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@/games/GameHost', () => ({ GAME_HOST_AVAILABLE: false, GameHost: () => null }));

const { PromptShell } = jest.requireActual(
  '@/party/shells/PromptShell',
) as typeof import('@/party/shells/PromptShell');
const { DrawShell } = jest.requireActual(
  '@/party/shells/DrawShell',
) as typeof import('@/party/shells/DrawShell');
const { GameResult } = jest.requireActual(
  '@/games/GameResult',
) as typeof import('@/games/GameResult');
const { KINGS_DECK } = jest.requireActual(
  '@/party/gameContent',
) as typeof import('@/party/gameContent');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111111' },
  { id: 'honza', name: 'Honza', tint: '#222222' },
];

it('deals the prompt on a card with a deck counter and one amber pill', () => {
  const onNext = jest.fn();
  render(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={0} onNext={onNext} />,
  );

  expect(screen.getByText('1/3')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Další'));
  expect(onNext).toHaveBeenCalledTimes(1);
});

it('gives a one-card rule no counter and no way to deal another', () => {
  render(<PromptShell prompts={['Jedno pravidlo.']} seed={17} step={0} onNext={jest.fn()} />);

  expect(screen.queryByText('1/1')).toBeNull();
  expect(screen.queryByLabelText('Další')).toBeNull();
});

it('draws a King’s Cup card with its rank, suit and what is left of the deck', () => {
  const hearts = KINGS_DECK.find((card) => card.id === 'hearts-Q')!;
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={{ nonce: 'n1', cardId: hearts.id }}
      drawnCardIds={[hearts.id]}
    />,
  );

  // Rank and suit sit in both corners, so each appears twice — and both are
  // hidden from the reader, which already gets the whole card as one label.
  const hidden = { includeHiddenElements: true } as const;
  expect(screen.getAllByText(hearts.rank, hidden)).toHaveLength(2);
  expect(screen.getAllByText('♥', hidden)).toHaveLength(2);
  expect(screen.getByText(hearts.title)).toBeTruthy();
  expect(screen.getByText(`Zbývá ${KINGS_DECK.length - 1}`)).toBeTruthy();
});

it('shows a scored ending as a podium and keeps the rest as ranked rows', () => {
  render(
    <GameResult
      players={[
        { id: 'a', name: 'Ty', tint: '#111111' },
        { id: 'b', name: 'Honza', tint: '#222222' },
        { id: 'c', name: 'Klára', tint: '#333333' },
        { id: 'd', name: 'Pepa', tint: '#444444' },
      ]}
      outcome={{
        scores: [
          { playerId: 'a', score: 9 },
          { playerId: 'b', score: 7 },
          { playerId: 'c', score: 4 },
          { playerId: 'd', score: 1 },
        ],
        winnerId: 'a',
      }}
      onDone={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('1. Ty 9')).toBeTruthy();
  expect(screen.getByLabelText('2. Honza 7')).toBeTruthy();
  expect(screen.getByLabelText('3. Klára 4')).toBeTruthy();
  expect(screen.getByLabelText('4. Pepa 1')).toBeTruthy();
  expect(screen.getByLabelText('Konec')).toBeTruthy();
});

it('never leaves the ending half empty: an unranked result is the card itself', () => {
  render(
    <GameResult
      players={[{ id: 'a', name: 'Kája', tint: '#111111' }]}
      outcome={{ scores: [], winnerId: null, payingId: 'a' }}
      onDone={jest.fn()}
    />,
  );

  expect(screen.getByLabelText('Platí Kája. Další runda je jasná.')).toBeTruthy();
  expect(screen.getByText('Dohráno')).toBeTruthy();
  // The stage is a real surface, not an empty box the sentence floats under.
  expect(
    screen
      .UNSAFE_getAllByType(View)
      .some((node) => StyleSheet.flatten(node.props.style)?.borderRadius === 34),
  ).toBe(true);
});
