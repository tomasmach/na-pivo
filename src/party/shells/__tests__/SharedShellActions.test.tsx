import React from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(View, props, children),
    },
    Easing: { cubic: 'cubic', out: (value: unknown) => value },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    // Flip via globalThis.__napivoReduceMotion in tests to exercise the
    // animated (rolling) draw path; default true keeps other tests static.
    useReducedMotion: () =>
      (globalThis as { __napivoReduceMotion?: boolean }).__napivoReduceMotion ?? true,
    useSharedValue: (value: unknown) => ({ value }),
    withSequence: (...values: unknown[]) => values.at(-1),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@/games/GameHost', () => ({
  GAME_HOST_AVAILABLE: false,
  GameHost: () => null,
}));
jest.mock('@/games/GameResult', () => ({ GameResult: () => null }));

const { recordRoll, settleRound, startDice, TARGET_WINS } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');
const { DrawShell } = jest.requireActual('@/party/shells/DrawShell') as typeof import('@/party/shells/DrawShell');
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');
const { PickShell } = jest.requireActual('@/party/shells/PickShell') as typeof import('@/party/shells/PickShell');
const { PromptShell } = jest.requireActual('@/party/shells/PromptShell') as typeof import('@/party/shells/PromptShell');
const { promptDeck } = jest.requireActual('@/party/shells/PromptShell') as typeof import('@/party/shells/PromptShell');
const { KINGS_DECK, KINGS_CARDS } = jest.requireActual('@/party/gameContent') as typeof import('@/party/gameContent');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

// The repo RN jest mock leaves announceForAccessibility unset at runtime;
// attach a stable spy so shell effects have something real to call on iOS.
const announceSpy = (() => {
  const holder = AccessibilityInfo as unknown as {
    announceForAccessibility?: unknown;
  };
  if (jest.isMockFunction(holder.announceForAccessibility)) {
    return holder.announceForAccessibility;
  }
  const spy = jest.fn();
  holder.announceForAccessibility = spy;
  return spy;
})();

beforeEach(() => {
  announceSpy.mockClear();
});

it('keeps the prompt footer above the home indicator and the game beer action', () => {
  render(
    <PromptShell prompts={['První', 'Druhá']} seed={17} step={0} onNext={jest.fn()} />,
  );

  const footer = screen.getByText('Ťukni kamkoliv').parent?.parent;
  expect(StyleSheet.flatten(footer?.props.style)).toEqual(
    expect.objectContaining({ bottom: 122 }),
  );
});

it('keeps the King’s Cup action above the home indicator and the game beer action', () => {
  render(
    <DrawShell kind="card" players={PLAYERS} action="Táhni kartu" seed={17} />,
  );

  expect(
    screen
      .UNSAFE_getAllByType(View)
      .some((node) => StyleSheet.flatten(node.props.style)?.paddingBottom === 122),
  ).toBe(true);
});

it('renders a prompt from the folded step and emits only an append action intent', () => {
  const onNext = jest.fn();
  const view = render(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={0} onNext={onNext} />,
  );
  const first = screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel;

  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  fireEvent.press(screen.getByLabelText(/Ťukni pro další/));
  expect(onNext).toHaveBeenCalledTimes(1);
  // Controlled state cannot drift before the canonical fold advances.
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).toBe(first);

  view.rerender(
    <PromptShell prompts={['První', 'Druhá', 'Třetí']} seed={17} step={1} onNext={onNext} />,
  );
  expect(screen.getByLabelText(/Ťukni pro další/).props.accessibilityLabel).not.toBe(first);
});

it('does not announce double punctuation after a complete prompt sentence', () => {
  render(
    <PromptShell
      prompts={['Už jsem to udělal.', 'Druhá věta.']}
      seed={17}
      step={0}
      onNext={() => {}}
    />,
  );

  expect(screen.getByLabelText(/\. Ťukni pro další\.$/)).toBeTruthy();
  expect(screen.queryByLabelText(/\.\. Ťukni pro další/)).toBeNull();
});

it('persists the draw result and can render the same card after reconnect', () => {
  const onDraw = jest.fn();
  const view = render(
    <DrawShell kind="card" players={PLAYERS} action="Táhni kartu" result={null} onDraw={onDraw} />,
  );

  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  expect(onDraw).toHaveBeenCalledTimes(1);
  expect(onDraw).toHaveBeenCalledWith(expect.objectContaining({ cardId: expect.any(String) }));

  view.rerender(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={{ nonce: 'server-event-7', cardId: 'K' }}
      onDraw={onDraw}
    />,
  );
  expect(screen.getByText('Král')).toBeTruthy();
  expect(screen.getByText('Doprostřed. Čtvrtý král platí rundu pro stůl.')).toBeTruthy();
});

it('draws the only remaining fourth king and finishes the persisted deck', () => {
  jest.useFakeTimers();
  const onDraw = jest.fn();
  const onDeckFinished = jest.fn();
  const remaining = 'spades-K';
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={null}
      drawnCardIds={KINGS_DECK.map((card) => card.id).filter((id) => id !== remaining)}
      onDraw={onDraw}
      onDeckFinished={onDeckFinished}
    />,
  );

  fireEvent.press(screen.getByLabelText('Táhni kartu'));
  expect(onDraw).toHaveBeenCalledWith(expect.objectContaining({ cardId: remaining }));
  act(() => jest.advanceTimersByTime(700));
  expect(onDeckFinished).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('uses stable player ids for a pick and rehydrates the same verdict', () => {
  const onPicked = jest.fn();
  const view = render(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId={null}
      onPicked={onPicked}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  fireEvent.press(screen.getByLabelText('Roztoč'));
  expect(onPicked).toHaveBeenCalledTimes(1);
  expect(['me', 'honza']).toContain(onPicked.mock.calls[0][0]);

  view.rerender(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId="honza"
      onPicked={onPicked}
    />,
  );
  expect(screen.getByText('Honza je na řadě')).toBeTruthy();
});

it('emits dice results from the game and renders a cold-restarted fold', () => {
  const onRoll = jest.fn();
  const onNextRound = jest.fn();
  const start = startDice(PLAYERS);
  const view = render(
    <DiceDuelShell
      players={PLAYERS}
      state={start}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText('Hodit za Ty'));
  fireEvent.press(screen.getByLabelText('Hodit za Ty'));
  expect(onRoll).toHaveBeenCalledTimes(1);
  expect(onRoll).toHaveBeenCalledWith({
    playerId: 'me',
    dice: [expect.any(Number), expect.any(Number)],
  });

  const afterMe = recordRoll(start, 'me', [6, 4]);
  view.rerender(
    <DiceDuelShell
      players={PLAYERS}
      state={afterMe}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByLabelText('Hodit za Honza')).toBeTruthy();

  const complete = recordRoll(afterMe, 'honza', [2, 1]);
  view.rerender(
    <DiceDuelShell
      players={PLAYERS}
      state={complete}
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  fireEvent.press(screen.getByLabelText('Další kolo'));
  expect(onNextRound).toHaveBeenCalledTimes(1);
});

it('keeps a dice spectator from rolling or advancing a live game', () => {
  const onRoll = jest.fn();
  const onNextRound = jest.fn();
  const start = startDice(PLAYERS);
  const view = render(
    <DiceDuelShell
      players={PLAYERS}
      state={start}
      spectator
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );

  const roll = screen.queryByLabelText('Hodit za Ty');
  if (roll) fireEvent.press(roll);
  expect(onRoll).not.toHaveBeenCalled();

  const midway = recordRoll(recordRoll(start, 'me', [6, 5]), 'honza', [2, 1]);
  view.rerender(
    <DiceDuelShell
      players={PLAYERS}
      state={midway}
      spectator
      onRoll={onRoll}
      onNextRound={onNextRound}
      onFinished={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  const next = screen.queryByLabelText('Další kolo');
  if (next) fireEvent.press(next);
  expect(onNextRound).not.toHaveBeenCalled();
});

it('does not announce an already-finished dice duel to a spectator', () => {
  const onFinished = jest.fn();
  let over = startDice(PLAYERS);
  for (let round = 0; round < TARGET_WINS; round += 1) {
    over = recordRoll(over, 'me', [6, 5]);
    over = recordRoll(over, 'honza', [2, 1]);
    over = settleRound(over);
  }

  render(
    <DiceDuelShell
      players={PLAYERS}
      state={over}
      spectator
      onRoll={jest.fn()}
      onNextRound={jest.fn()}
      onFinished={onFinished}
      onDone={jest.fn()}
    />,
  );
  expect(onFinished).not.toHaveBeenCalled();
});

it('keeps a pick spectator from spinning or publishing a pick', () => {
  const onPicked = jest.fn();
  const onFinished = jest.fn();
  render(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId={null}
      onPicked={onPicked}
      onFinished={onFinished}
      spectator
    />,
  );

  const spin = screen.queryByLabelText(/Roztoč/);
  if (spin) fireEvent.press(spin);
  expect(onPicked).not.toHaveBeenCalled();
  expect(onFinished).not.toHaveBeenCalled();
});

it('keeps a draw spectator from drawing or finishing the deck', () => {
  const onDraw = jest.fn();
  const onDeckFinished = jest.fn();
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={null}
      drawnCardIds={[]}
      onDraw={onDraw}
      onDeckFinished={onDeckFinished}
      spectator
    />,
  );

  const draw = screen.queryByLabelText(/Táhni kartu/);
  if (draw) {
    fireEvent.press(draw);
    fireEvent.press(draw);
  }
  expect(onDraw).not.toHaveBeenCalled();
  expect(onDeckFinished).not.toHaveBeenCalled();
});

it('exposes the current prompt as a polite live region on both the button and the spectator view', () => {
  const onNext = jest.fn();
  const prompts = ['První', 'Druhá', 'Třetí'];
  const view = render(
    <PromptShell prompts={prompts} seed={17} step={0} onNext={onNext} />,
  );
  expect(
    screen.getByLabelText(/Ťukni pro další/).props.accessibilityLiveRegion,
  ).toBe('polite');

  view.rerender(
    <PromptShell prompts={prompts} seed={17} step={1} onNext={onNext} />,
  );
  expect(
    screen.getByLabelText(/Ťukni pro další/).props.accessibilityLiveRegion,
  ).toBe('polite');

  const spectatorFirst = promptDeck(prompts, 17, 0)[0];
  view.rerender(
    <PromptShell prompts={prompts} seed={17} step={0} onNext={onNext} spectator />,
  );
  expect(
    screen.getByLabelText(spectatorFirst).props.accessibilityLiveRegion,
  ).toBe('polite');
});

it('announces a settled person once, with the label exactly the visible name', () => {
  render(
    <DrawShell
      kind="person"
      players={PLAYERS}
      action="Roztoč"
      result={{ nonce: 'n1', personId: 'honza' }}
    />,
  );

  const name = screen.getByText('Honza');
  expect(name.props.accessibilityLabel).toBe('Honza');
  expect(name.props.accessibilityLiveRegion).toBe('polite');
});

it('announces a settled card as one node from the visible rank, title and rule', () => {
  const king = KINGS_CARDS.find((card) => card.card === 'K')!;
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={{ nonce: 'n2', cardId: 'K' }}
    />,
  );

  const cardNode = screen.getByLabelText(`K ${king.title} ${king.rule}`);
  expect(cardNode.props.accessible).toBe(true);
  expect(cardNode.props.accessibilityLiveRegion).toBe('polite');
});

it('keeps the unturned card back decorative', () => {
  render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={null}
      drawnCardIds={[]}
      onDraw={jest.fn()}
    />,
  );

  const back = screen.getByText('?', { includeHiddenElements: true });
  expect(back.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(back.props.accessibilityElementsHidden).toBe(true);
});

it('shows a prompt spectator plain text without hint or advance', () => {
  const onNext = jest.fn();
  const prompts = ['První', 'Druhá', 'Třetí'];
  const expectedFirst = promptDeck(prompts, 17, 0)[0];
  const { UNSAFE_queryAllByType } = render(
    <PromptShell prompts={prompts} seed={17} step={0} onNext={onNext} spectator />,
  );

  expect(UNSAFE_queryAllByType(Pressable)).toHaveLength(0);
  expect(screen.getByText(expectedFirst)).toBeTruthy();
  expect(screen.queryByText('Ťukni kamkoliv')).toBeNull();

  const card = screen.getByLabelText(expectedFirst);
  expect(card.props.accessibilityRole).toBe('text');

  const count = StyleSheet.flatten(screen.getByText('1/3').props.style);
  expect(count.marginLeft).toBe('auto');

  fireEvent.press(screen.getByText(expectedFirst));
  expect(onNext).not.toHaveBeenCalled();
});

it('announces the new prompt once on a controlled step change and never on unrelated rerenders', () => {
  const onNext = jest.fn();
  const prompts = ['První', 'Druhá', 'Třetí'];
  const view = render(
    <PromptShell prompts={prompts} seed={17} step={0} onNext={onNext} />,
  );
  expect(announceSpy).not.toHaveBeenCalled();

  view.rerender(
    <PromptShell prompts={prompts} seed={17} step={1} onNext={onNext} />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
  expect(announceSpy).toHaveBeenCalledWith(promptDeck(prompts, 17, 0)[1]);

  view.rerender(
    <PromptShell prompts={prompts} seed={17} step={1} onNext={jest.fn()} />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
});

it('announces a remotely advanced prompt once for a spectator and not on mount', () => {
  const prompts = ['První', 'Druhá', 'Třetí'];
  const view = render(
    <PromptShell prompts={prompts} seed={17} step={0} spectator />,
  );
  expect(announceSpy).not.toHaveBeenCalled();

  view.rerender(<PromptShell prompts={prompts} seed={17} step={2} spectator />);
  expect(announceSpy).toHaveBeenCalledTimes(1);
  expect(announceSpy).toHaveBeenCalledWith(promptDeck(prompts, 17, 0)[2]);

  view.rerender(<PromptShell prompts={prompts} seed={17} step={2} spectator />);
  expect(announceSpy).toHaveBeenCalledTimes(1);
});

it('announces a newly settled person once by the exact visible name and never repeats a nonce', () => {
  const result = { nonce: 'p1', personId: 'honza' };
  const view = render(
    <DrawShell kind="person" players={PLAYERS} action="Roztoč" result={null} />,
  );
  expect(announceSpy).not.toHaveBeenCalled();

  view.rerender(
    <DrawShell kind="person" players={PLAYERS} action="Roztoč" result={result} />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
  expect(announceSpy).toHaveBeenCalledWith('Honza');

  view.rerender(
    <DrawShell kind="person" players={PLAYERS} action="Roztoč" result={result} />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
});

it('announces a newly settled card once by the exact rendered label and never repeats a nonce', () => {
  const king = KINGS_CARDS.find((card) => card.card === 'K')!;
  const label = `K ${king.title} ${king.rule}`;
  const result = { nonce: 'c1', cardId: 'K' };
  const view = render(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={null}
      drawnCardIds={[]}
    />,
  );
  expect(announceSpy).not.toHaveBeenCalled();

  view.rerender(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={result}
      drawnCardIds={['K']}
    />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
  expect(announceSpy).toHaveBeenCalledWith(label);

  view.rerender(
    <DrawShell
      kind="card"
      players={PLAYERS}
      action="Táhni kartu"
      result={result}
      drawnCardIds={['K']}
    />,
  );
  expect(announceSpy).toHaveBeenCalledTimes(1);
});

it('waits for the roll to finish before announcing a local draw once', () => {
  jest.useFakeTimers();
  (globalThis as { __napivoReduceMotion?: boolean }).__napivoReduceMotion = false;
  try {
    render(<DrawShell kind="person" players={PLAYERS} action="Roztoč" />);
    fireEvent.press(screen.getByLabelText('Roztoč'));
    expect(announceSpy).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(900);
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(['Ty', 'Honza']).toContain(announceSpy.mock.calls[0][0]);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);
  } finally {
    (globalThis as { __napivoReduceMotion?: boolean }).__napivoReduceMotion = true;
    jest.useRealTimers();
  }
});

it('never announces imperatively on Android and leaves it to the live region', () => {
  const originalOS = Platform.OS;
  Platform.OS = 'android';
  try {
    const prompts = ['První', 'Druhá', 'Třetí'];
    const promptView = render(
      <PromptShell prompts={prompts} seed={17} step={0} onNext={jest.fn()} />,
    );
    promptView.rerender(
      <PromptShell prompts={prompts} seed={17} step={1} onNext={jest.fn()} />,
    );
    promptView.unmount();
    expect(announceSpy).not.toHaveBeenCalled();

    // A real null -> valid transition: Android must leave the reveal entirely
    // to the polite live region, never to announceForAccessibility.
    const drawView = render(
      <DrawShell
        kind="card"
        players={PLAYERS}
        action="Táhni kartu"
        result={null}
        drawnCardIds={[]}
      />,
    );
    expect(screen.getByText('?', { includeHiddenElements: true })).toBeTruthy();

    drawView.rerender(
      <DrawShell
        kind="card"
        players={PLAYERS}
        action="Táhni kartu"
        result={{ nonce: 'android-1', cardId: 'K' }}
        drawnCardIds={['K']}
      />,
    );
    expect(screen.getByText('Král')).toBeTruthy();
    expect(announceSpy).not.toHaveBeenCalled();
  } finally {
    Platform.OS = originalOS;
  }
});
