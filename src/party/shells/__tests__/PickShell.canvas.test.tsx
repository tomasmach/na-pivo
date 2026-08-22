import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockCommand = jest.fn();
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
    useReducedMotion: () => false,
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
    GameResult: ({ onDone }: { onDone: () => void }) =>
      ReactModule.createElement(Pressable, {
        accessibilityLabel: 'game-result',
        onPress: onDone,
      }),
  };
});

// eslint-disable-next-line import/first
import { PickShell } from '@/party/shells/PickShell';

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

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
