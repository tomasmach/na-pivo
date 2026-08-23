import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCommand = jest.fn();
let mockReducedMotion = false;
type MockOutcome = { scores: never[]; winnerId: null; payingId: string | null };
let mockLastOutcome: MockOutcome | null = null;
let mockGameHostProps: {
  onResult: (result: { scores: never[]; winnerId: null; payingId: string }) => void;
  onEvent: (name: string, payload: { playerId: string }) => void;
} | null = null;

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  PlusIcon: () => null,
}));
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
    useReducedMotion: () => mockReducedMotion,
  };
});
jest.mock('@/games/GameHost', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { View }: typeof import('react-native') = jest.requireActual('react-native');
  return {
    GAME_HOST_AVAILABLE: true,
    GameHost: ReactModule.forwardRef((props: typeof mockGameHostProps, ref) => {
      mockGameHostProps = props;
      ReactModule.useImperativeHandle(ref, () => ({ command: mockCommand }));
      return ReactModule.createElement(View, { accessibilityLabel: 'game-host' });
    }),
  };
});
jest.mock('@/games/GameResult', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable }: typeof import('react-native') = jest.requireActual('react-native');
  return {
    GameResult: ({
      outcome,
      onDone,
    }: {
      outcome: MockOutcome;
      onDone: () => void;
    }) => {
      mockLastOutcome = outcome;
      return ReactModule.createElement(Pressable, {
        accessibilityLabel: 'game-result',
        onPress: onDone,
      });
    },
  };
});

// eslint-disable-next-line import/first
import { PickShell } from '@/party/shells/PickShell';

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

afterEach(() => {
  mockCommand.mockClear();
  mockGameHostProps = null;
  mockReducedMotion = false;
  mockLastOutcome = null;
});

it('reports the canvas payer as a stable player id, not a name', () => {
  const onFinished = jest.fn();
  const onDone = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={onDone}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  act(() => {
    mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'honza' });
  });

  expect(mockLastOutcome?.payingId).toBe('honza');
});

it('reports the local reduced-motion payer as a stable player id, not a name', () => {
  mockReducedMotion = true;
  const onFinished = jest.fn();
  const onDone = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={[PLAYERS[1]]}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={onDone}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));

  expect(onFinished).toHaveBeenCalledWith('Honza', 'honza');
  expect(mockLastOutcome?.payingId).toBe('honza');
});

it('locks a wheel spin and finishes with the physical canvas payer', () => {
  const onFinished = jest.fn();
  const onDone = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={onDone}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  fireEvent.press(screen.getByLabelText('Roztoč'));
  expect(mockCommand).toHaveBeenCalledTimes(1);
  expect(mockCommand).toHaveBeenCalledWith('spin');

  act(() => {
    mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'honza' });
  });

  expect(onFinished).toHaveBeenCalledTimes(1);
  expect(onFinished).toHaveBeenCalledWith('Honza', 'honza');
  fireEvent.press(screen.getByLabelText('game-result'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('ignores canvas picked/result messages that arrive before any spin', () => {
  const onFinished = jest.fn();
  const onPicked = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={jest.fn()}
      onPicked={onPicked}
    />,
  );

  act(() => mockGameHostProps?.onEvent('picked', { playerId: 'honza' }));
  act(() => mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'honza' }));

  expect(onFinished).not.toHaveBeenCalled();
  expect(onPicked).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('game-result')).toBeNull();
});

it('consumes exactly one picked/result sequence per ending spin and ignores duplicate results', () => {
  const onFinished = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  act(() => mockGameHostProps?.onEvent('picked', { playerId: 'honza' }));
  act(() => mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'honza' }));

  expect(onFinished).toHaveBeenCalledTimes(1);
  expect(onFinished).toHaveBeenCalledWith('Honza', 'honza');
  expect(mockLastOutcome?.payingId).toBe('honza');

  act(() => mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'me' }));

  expect(onFinished).toHaveBeenCalledTimes(1);
  expect(mockLastOutcome?.payingId).toBe('honza');
});

it('does not end an ending game when the result names a payer outside the roster', () => {
  const onFinished = jest.fn();
  render(
    <PickShell
      game="wheel"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByLabelText('Roztoč'));
  act(() => mockGameHostProps?.onResult({ scores: [], winnerId: null, payingId: 'ghost' }));

  expect(onFinished).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('game-result')).toBeNull();
});

it('reduced-motion spin with an empty roster never reports an empty pick and stays unlocked', () => {
  mockReducedMotion = true;
  const onPicked = jest.fn();
  const onFinished = jest.fn();
  const view = render(
    <PickShell
      game="wheel"
      players={[]}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={jest.fn()}
      onPicked={onPicked}
    />,
  );
  fireEvent.press(screen.getByLabelText('Roztoč'));
  expect(onPicked).not.toHaveBeenCalled();

  view.rerender(
    <PickShell
      game="wheel"
      players={[PLAYERS[1]]}
      action="Roztoč"
      verdict={(name) => `Platí ${name}`}
      onFinished={onFinished}
      onDone={jest.fn()}
      onPicked={onPicked}
    />,
  );
  fireEvent.press(screen.getByLabelText('Roztoč'));

  expect(onFinished).toHaveBeenCalledWith('Honza', 'honza');
});

it('hides the stale bottle verdict and re-announces the same player on a new revision', () => {
  const onPicked = jest.fn();
  const view = render(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId="honza"
      pickRevision={1}
      onPicked={onPicked}
    />,
  );

  expect(screen.getByText('Honza je na řadě')).toBeTruthy();
  const spin = screen.getByLabelText('Roztoč znovu');
  fireEvent.press(spin);
  expect(screen.queryByText('Honza je na řadě')).toBeNull();

  act(() => mockGameHostProps?.onEvent('picked', { playerId: 'honza' }));
  expect(onPicked).toHaveBeenCalledWith('honza');
  view.rerender(
    <PickShell
      game="bottle"
      players={PLAYERS}
      action="Roztoč"
      verdict={(name) => `${name} je na řadě`}
      pickedId="honza"
      pickRevision={2}
      onPicked={onPicked}
    />,
  );
  expect(screen.getByText('Honza je na řadě')).toBeTruthy();
});
