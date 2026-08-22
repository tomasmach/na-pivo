/* eslint-disable import/first */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockDownload = jest.fn(async () => ({ localUri: 'file:///dice.html' }));
const mockInject = jest.fn();
let mockWebProps: Record<string, unknown> | null = null;

jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: mockDownload }) },
}));

jest.mock('react-native-webview', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { View }: typeof import('react-native') = jest.requireActual('react-native');
  return {
    WebView: ReactModule.forwardRef((props: Record<string, unknown>, ref) => {
      mockWebProps = props;
      ReactModule.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
      return ReactModule.createElement(View, { accessibilityLabel: 'web-game' });
    }),
  };
});

jest.mock('../../../assets/games/dice.html', () => 1, { virtual: true });
jest.mock('../../../assets/games/bottle.html', () => 2, { virtual: true });
jest.mock('../../../assets/games/wheel.html', () => 3, { virtual: true });

import { GameHost, type GameHostHandle } from '@/games/GameHost';

const PLAYERS = [{ id: 'me', colour: '#E8A317', label: 'Ty' }];

beforeEach(() => {
  jest.clearAllMocks();
  mockDownload.mockResolvedValue({ localUri: 'file:///dice.html' });
});

it('shows loading, exposes a recoverable error, and clears it after the ready handshake', async () => {
  const onError = jest.fn();
  render(<GameHost game="dice" players={PLAYERS} onError={onError} />);

  expect(screen.getByText('Načítám hru…')).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText('web-game')).toBeTruthy());

  act(() => (mockWebProps?.onError as (() => void) | undefined)?.());
  expect(screen.getByText('Hru se nepodařilo načíst.')).toBeTruthy();
  expect(onError).toHaveBeenCalledWith('Hru se nepodařilo načíst.');

  fireEvent.press(screen.getByLabelText('Zkusit znovu'));
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
  act(() =>
    (mockWebProps?.onMessage as ((event: unknown) => void) | undefined)?.({
      nativeEvent: { data: JSON.stringify({ v: 1, type: 'ready' }) },
    }),
  );

  expect(screen.queryByText('Načítám hru…')).toBeNull();
  expect(screen.queryByText('Hru se nepodařilo načíst.')).toBeNull();
});

it('times out while the bundled game asset is still downloading', () => {
  jest.useFakeTimers();
  mockDownload.mockImplementationOnce(() => new Promise(() => undefined));
  const onError = jest.fn();

  render(<GameHost game="dice" players={PLAYERS} onError={onError} />);
  act(() => jest.advanceTimersByTime(8000));

  expect(screen.getByText('Hra se nespustila včas.')).toBeTruthy();
  expect(screen.getByLabelText('Zkusit znovu')).toBeTruthy();
  expect(onError).toHaveBeenCalledWith('Hra se nespustila včas.');
  jest.useRealTimers();
});

it('delivers a stranded command when a slow cold load becomes ready after the timeout', async () => {
  jest.useFakeTimers();
  let resolveDownload!: (value: { localUri: string }) => void;
  mockDownload.mockImplementationOnce(
    () =>
      new Promise<{ localUri: string }>((resolve) => {
        resolveDownload = resolve;
      }),
  );

  const hostRef = React.createRef<GameHostHandle>();
  render(<GameHost ref={hostRef} game="dice" players={PLAYERS} />);

  // The cold load overruns the host timeout: error and Retry show up.
  act(() => jest.advanceTimersByTime(8000));
  expect(screen.getByText('Hra se nespustila včas.')).toBeTruthy();

  // The parent queues its first command anyway instead of stranding the game.
  act(() => hostRef.current?.command('roll', { n: 1 }));

  // …and the queue's own patience runs out while nothing is listening.
  act(() => jest.advanceTimersByTime(4000));

  // Then the slow asset finally lands and the page comes up.
  await act(async () => {
    resolveDownload({ localUri: 'file:///dice.html' });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByLabelText('web-game')).toBeTruthy();

  mockInject.mockClear();
  act(() =>
    (mockWebProps?.onMessage as ((event: unknown) => void) | undefined)?.({
      nativeEvent: { data: JSON.stringify({ v: 1, type: 'ready' }) },
    }),
  );

  // Late success is success: no stuck error, and init is followed by the
  // command that was queued during the failed window.
  expect(screen.queryByText('Hra se nespustila včas.')).toBeNull();
  const sent = mockInject.mock.calls.map(([script]) => {
    const match = /window\.napivoGame\((.*)\);true;$/.exec(script as string);
    return JSON.parse(JSON.parse((match as RegExpMatchArray)[1] as string));
  });
  expect(sent[0].type).toBe('init');
  expect(sent.some((message: { type: string; name?: string }) => message.name === 'roll'))
    .toBe(true);
  jest.useRealTimers();
});
