import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import type { DiceState } from '@/games/web/dice/rules';

let mockGameHostProps: {
  options?: Record<string, unknown>;
  onState?: (state: unknown) => void;
  onEvent?: (name: string, payload: unknown) => void;
} | null = null;

const mockHostMounts = { mount: 0, unmount: 0 };
type MockOutcome = { scores: { playerId: string; score: number }[]; winnerId: null; payingId: string | null };
let mockLastOutcome: MockOutcome | null = null;
let mockLastBoard: { playerId?: string; name: string; score: number; suffix?: string }[] | null = null;

const mockAnnounce = jest.fn();

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Platform: { ...actual.Platform, OS: 'ios' },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      announceForAccessibility:
        (...args: unknown[]) => mockAnnounce(...args),
    },
  };
});

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
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
    useReducedMotion: () => false,
  };
});
jest.mock('@/games/GameHost', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    GAME_HOST_AVAILABLE: true,
    GameHost: ReactModule.forwardRef((props: typeof mockGameHostProps, _ref) => {
      mockGameHostProps = props;
      ReactModule.useEffect(() => {
        mockHostMounts.mount += 1;
        return () => {
          mockHostMounts.unmount += 1;
        };
      }, []);
      return null;
    }),
  };
});
jest.mock('@/games/GameResult', () => ({
  GameResult: ({
    outcome,
    board,
  }: {
    outcome: MockOutcome;
    board?: { playerId?: string; name: string; score: number; suffix?: string }[];
  }) => {
    mockLastOutcome = outcome;
    mockLastBoard = board ?? null;
    return null;
  },
}));

const { startDice, recordRoll, settleRound, whoseTurn, isOver } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');

beforeEach(() => {
  mockGameHostProps = null;
  mockHostMounts.mount = 0;
  mockHostMounts.unmount = 0;
  mockLastOutcome = null;
  mockLastBoard = null;
  mockAnnounce.mockClear();
  RN.Platform.OS = 'ios';
});
afterEach(() => {
  jest.useRealTimers();
  RN.Platform.OS = 'ios';
});
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');

const RN = jest.requireMock('react-native') as { Platform: { OS: string } };

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

const COMPLETE: DiceState = {
  ...startDice(PLAYERS),
  live: ['honza'],
  safe: ['me'],
  wins: { me: 3, honza: 1 },
  round: [],
  roundNumber: 4,
  payingId: 'honza',
};

it('waits for a durable finish and retries the exact dice result after rejection', async () => {
  let rejectFirst!: (reason?: unknown) => void;
  const onFinished = jest
    .fn()
    .mockImplementationOnce(
      () => new Promise<boolean>((_resolve, reject) => { rejectFirst = reject; }),
    )
    .mockResolvedValueOnce(true);

  render(
    <DiceDuelShell
      players={PLAYERS}
      onFinished={onFinished}
      onDone={jest.fn()}
      state={COMPLETE}
    />,
  );

  await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  expect(mockLastOutcome).toBeNull();

  await act(async () => {
    rejectFirst(new Error('offline'));
    await Promise.resolve();
  });
  const retry = await screen.findByLabelText('Zkusit znovu');
  expect(mockLastOutcome).toBeNull();

  act(() => retry.props.onPress());
  await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(2));
  expect(onFinished.mock.calls[1]).toEqual(onFinished.mock.calls[0]);
  await waitFor(() => expect(mockLastOutcome?.payingId).toBe('honza'));
});

it('keeps stable player ids on the finished dice board with duplicate names', async () => {
  const duplicatePlayers = [
    { id: 'alex-a', name: 'Alex', tint: '#111111' },
    { id: 'alex-b', name: 'Alex', tint: '#222222' },
  ];
  const complete: DiceState = {
    ...startDice(duplicatePlayers),
    live: ['alex-b'],
    safe: ['alex-a'],
    wins: { 'alex-a': 3, 'alex-b': 1 },
    round: [],
    roundNumber: 4,
    payingId: 'alex-b',
  };

  render(
    <DiceDuelShell
      players={duplicatePlayers}
      onFinished={jest.fn(async () => true)}
      onDone={jest.fn()}
      state={complete}
    />,
  );

  await waitFor(() => expect(mockLastBoard).not.toBeNull());
  expect(mockLastBoard).toEqual([
    { playerId: 'alex-a', name: 'Alex', score: 1, suffix: '1.' },
  ]);
});

it('keeps the latest local state in GameHost options so a WebView retry can resume', () => {
  render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );
  const initial = startDice(PLAYERS);
  expect(mockGameHostProps?.options).toEqual({ count: 2, state: initial });

  const afterFirstRoll: DiceState = recordRoll(initial, 'me', [6, 4]);
  act(() => mockGameHostProps?.onState?.(afterFirstRoll));

  expect(mockGameHostProps?.options).toEqual({ count: 2, state: afterFirstRoll });
});

it('mounts GameHost exactly once across active -> roundDone -> next active round', () => {
  const initial = startDice(PLAYERS);
  const afterMe = recordRoll(initial, 'me', [6, 4]);
  const afterHonza = recordRoll(afterMe, 'honza', [2, 3]);
  expect(whoseTurn(afterHonza)).toBeNull();
  expect(isOver(afterHonza)).toBe(false);
  const nextRound = settleRound(afterHonza);

  const { rerender } = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={initial} />,
  );
  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={afterHonza} />,
  );
  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={nextRound} />,
  );

  expect(mockHostMounts).toEqual({ mount: 1, unmount: 0 });
  expect(mockGameHostProps?.options).toEqual({ count: 2, state: nextRound });
});

it('uncontrolled play drives rounds through the same mounted host', () => {
  const initial = startDice(PLAYERS);
  const afterMe = recordRoll(initial, 'me', [6, 4]);
  const afterHonza = recordRoll(afterMe, 'honza', [2, 3]);
  expect(whoseTurn(afterHonza)).toBeNull();
  const nextRound = settleRound(afterHonza);

  render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );
  act(() => mockGameHostProps?.onState?.(afterHonza));
  act(() => mockGameHostProps?.onState?.(nextRound));

  expect(mockHostMounts).toEqual({ mount: 1, unmount: 0 });
  expect(mockGameHostProps?.options).toEqual({ count: 2, state: nextRound });
});

it('a fresh settled cheer survives the previous cheer timer', () => {
  jest.useFakeTimers();
  const { getByText, queryByText } = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );

  act(() =>
    mockGameHostProps?.onEvent?.('settled', { dice: [6, 6], playerId: 'honza' }),
  );
  expect(getByText('Honza má dvanáct!')).toBeTruthy();

  act(() => jest.advanceTimersByTime(1000));
  act(() =>
    mockGameHostProps?.onEvent?.('settled', { dice: [1, 1], playerId: 'honza' }),
  );
  act(() => jest.advanceTimersByTime(1000));

  expect(getByText('Honza… dvě. Au.')).toBeTruthy();
  act(() => jest.advanceTimersByTime(600));
  expect(queryByText('Honza… dvě. Au.')).toBeNull();
});

it('unmount cancels the pending cheer timer', () => {
  jest.useFakeTimers();
  const view = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );
  act(() =>
    mockGameHostProps?.onEvent?.('settled', { dice: [6, 6], playerId: 'me' }),
  );
  expect(jest.getTimerCount()).toBe(1);

  view.unmount();

  expect(jest.getTimerCount()).toBe(0);
});

it('a malformed over state with an unknown payer contains itself instead of publishing a stranger', () => {
  const onFinished = jest.fn();
  const corrupted: DiceState = {
    ...startDice(PLAYERS),
    live: ['ghost'],
    safe: ['me', 'honza'],
    round: [],
    roundNumber: 7,
    payingId: 'ghost',
  };

  render(
    <DiceDuelShell
      players={PLAYERS}
      onFinished={onFinished}
      onDone={jest.fn()}
      state={corrupted}
    />,
  );

  expect(onFinished).not.toHaveBeenCalled();
  expect(mockLastOutcome?.payingId).toBeNull();
});

it('the active turn is one polite live header saying exactly who throws', () => {
  render(
    <DiceDuelShell
      players={PLAYERS}
      onFinished={jest.fn()}
      onDone={jest.fn()}
      state={startDice(PLAYERS)}
    />,
  );

  // The status line is one grouped node — the disc and the sentence together.
  const turn = screen.getByLabelText('Házíš ty');
  expect(turn.props.accessibilityRole).toBe('header');
  expect(turn.props.accessibilityLiveRegion).toBe('polite');
  expect(screen.getByText('Házíš ty')).toBeTruthy();
});

it('a completed round announces the visible verdict with the loser folded into one node', () => {
  const afterMe = recordRoll(startDice(PLAYERS), 'me', [6, 4]);
  const complete = recordRoll(afterMe, 'honza', [2, 3]);
  render(
    <DiceDuelShell
      players={PLAYERS}
      onFinished={jest.fn()}
      onDone={jest.fn()}
      state={complete}
    />,
  );

  const verdict = screen.getByLabelText('Ty bere kolo Nejmíň hodil Honza.');
  expect(['assertive', 'polite']).toContain(
    verdict.props.accessibilityLiveRegion,
  );

  const sub = screen.getByText('Nejmíň hodil Honza.', {
    includeHiddenElements: true,
  });
  expect(sub.props.importantForAccessibility).toBe('no');
  expect(sub.props.accessibilityElementsHidden).toBe(true);
});

it('a transient cheer is a polite live text node', () => {
  jest.useFakeTimers();
  render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );

  act(() =>
    mockGameHostProps?.onEvent?.('settled', { dice: [6, 6], playerId: 'honza' }),
  );
  expect(
    screen.getByText('Honza má dvanáct!').props.accessibilityLiveRegion,
  ).toBe('polite');
});

it('a new turn is announced imperatively once and never repeated', () => {
  const initial = startDice(PLAYERS);
  const afterMe = recordRoll(initial, 'me', [6, 4]);

  const { rerender } = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={initial} />,
  );
  expect(mockAnnounce).not.toHaveBeenCalled();

  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={afterMe} />,
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
  expect(mockAnnounce).toHaveBeenLastCalledWith('Honza hází');

  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={afterMe} />,
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
});

it('a completed round verdict is announced imperatively once and never repeated', () => {
  const initial = startDice(PLAYERS);
  const afterMe = recordRoll(initial, 'me', [6, 4]);
  const complete = recordRoll(afterMe, 'honza', [2, 3]);

  const { rerender } = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={initial} />,
  );
  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={complete} />,
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
  expect(mockAnnounce).toHaveBeenLastCalledWith('Ty bere kolo Nejmíň hodil Honza.');

  rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={complete} />,
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
});

it('a transient cheer is announced imperatively once and never repeated', () => {
  jest.useFakeTimers();
  const view = render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );

  act(() =>
    mockGameHostProps?.onEvent?.('settled', { dice: [6, 6], playerId: 'honza' }),
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);
  expect(mockAnnounce).toHaveBeenLastCalledWith('Honza má dvanáct!');

  view.rerender(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );
  expect(mockAnnounce).toHaveBeenCalledTimes(1);

  act(() => jest.advanceTimersByTime(1700));
});

it('stays silent on Android across turns, verdicts and cheers', () => {
  RN.Platform.OS = 'android';
  try {
    jest.useFakeTimers();
    const initial = startDice(PLAYERS);
    const afterMe = recordRoll(initial, 'me', [6, 4]);
    const complete = recordRoll(afterMe, 'honza', [2, 3]);

    const { rerender } = render(
      <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={initial} />,
    );
    rerender(
      <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={afterMe} />,
    );
    rerender(
      <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} state={complete} />,
    );

    const uncontrolled = render(
      <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
    );
    act(() =>
      mockGameHostProps?.onEvent?.('settled', { dice: [6, 6], playerId: 'honza' }),
    );
    act(() => jest.advanceTimersByTime(1700));
    act(() =>
      mockGameHostProps?.onEvent?.('settled', { dice: [1, 1], playerId: 'honza' }),
    );
    act(() => jest.advanceTimersByTime(1700));
    uncontrolled.unmount();

    expect(mockAnnounce).not.toHaveBeenCalled();
  } finally {
    RN.Platform.OS = 'ios';
  }
});
