import React from 'react';
import { act, render } from '@testing-library/react-native';

import type { DiceState } from '@/games/web/dice/rules';

let mockGameHostProps: {
  options?: Record<string, unknown>;
  onState?: (state: unknown) => void;
  onEvent?: (name: string, payload: unknown) => void;
} | null = null;

const mockHostMounts = { mount: 0, unmount: 0 };
type MockOutcome = { scores: { playerId: string; score: number }[]; winnerId: null; payingId: string | null };
let mockLastOutcome: MockOutcome | null = null;

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
  GameResult: ({ outcome }: { outcome: MockOutcome }) => {
    mockLastOutcome = outcome;
    return null;
  },
}));

const { startDice, recordRoll, settleRound, whoseTurn, isOver } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');

beforeEach(() => {
  mockGameHostProps = null;
  mockHostMounts.mount = 0;
  mockHostMounts.unmount = 0;
  mockLastOutcome = null;
});
afterEach(() => {
  jest.useRealTimers();
});
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

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
