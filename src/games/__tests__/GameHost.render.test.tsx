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
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));

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

it('recovers through the fail path when the Android renderer process is gone', async () => {
  const onError = jest.fn();
  render(<GameHost game="dice" players={PLAYERS} onError={onError} />);
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));

  act(() => (mockWebProps?.onRenderProcessGone as (() => void) | undefined)?.());

  expect(screen.getByText('Hra se zastavila.')).toBeTruthy();
  expect(screen.getByLabelText('Zkusit znovu')).toBeTruthy();
  expect(onError).toHaveBeenCalledWith('Hra se zastavila.');

  fireEvent.press(screen.getByLabelText('Zkusit znovu'));
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
  expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' });
});

it('injects init once per attempt and resets the guard on retry', async () => {
  const countInits = () =>
    mockInject.mock.calls.filter(([script]) => {
      const match = /window\.napivoGame\((.*)\);true;$/.exec(script as string);
      return match !== null && JSON.parse(JSON.parse(match[1] as string)).type === 'init';
    }).length;

  render(<GameHost game="dice" players={PLAYERS} />);
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));
  mockInject.mockClear();

  const sendReady = () =>
    act(() =>
      (mockWebProps?.onMessage as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { data: JSON.stringify({ v: 1, type: 'ready' }) },
      }),
    );

  sendReady();
  sendReady();
  expect(countInits()).toBe(1);

  act(() => (mockWebProps?.onError as (() => void) | undefined)?.());
  fireEvent.press(screen.getByLabelText('Zkusit znovu'));
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
  mockInject.mockClear();

  sendReady();
  sendReady();
  expect(countInits()).toBe(1);
});

it('drops results with unknown roster identities and exposes the recoverable fail path', async () => {
  const onResult = jest.fn();
  const onError = jest.fn();
  render(
    <GameHost game="dice" players={PLAYERS} onResult={onResult} onError={onError} />,
  );
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));

  const send = (data: unknown) =>
    act(() =>
      (mockWebProps?.onMessage as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { data: JSON.stringify(data) },
      }),
    );

  send({ v: 1, type: 'ready' });
  send({
    v: 1,
    type: 'result',
    scores: [{ playerId: 'me', score: 3 }, { playerId: 'ghost', score: 1 }],
    winnerId: null,
    payingId: null,
  });

  expect(onResult).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith('Hra se zastavila.');
  expect(screen.getByLabelText('Zkusit znovu')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Zkusit znovu'));
  await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
  send({ v: 1, type: 'ready' });
  send({
    v: 1,
    type: 'result',
    scores: [{ playerId: 'me', score: 3 }],
    winnerId: 'me',
    payingId: 'me',
  });

  expect(onResult).toHaveBeenCalledTimes(1);
});

it('accepts a result naming the init roster when the parent reuses and mutates its players array', async () => {
  const onResult = jest.fn();
  const onError = jest.fn();
  const mutableRoster = [...PLAYERS];
  const { rerender } = render(
    <GameHost game="dice" players={mutableRoster} onResult={onResult} onError={onError} />,
  );
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));

  const send = (data: unknown) =>
    act(() =>
      (mockWebProps?.onMessage as ((event: unknown) => void) | undefined)?.({
        nativeEvent: { data: JSON.stringify(data) },
      }),
    );

  send({ v: 1, type: 'ready' });

  mutableRoster.splice(0, mutableRoster.length, {
    id: 'someone-else',
    colour: '#333333',
    label: 'Ostatní',
  });
  rerender(
    <GameHost game="dice" players={mutableRoster} onResult={onResult} onError={onError} />,
  );

  send({
    v: 1,
    type: 'result',
    scores: [{ playerId: 'me', score: 3 }],
    winnerId: 'me',
    payingId: null,
  });

  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
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

it('removes the decorative canvas from the accessibility tree', async () => {
  render(<GameHost game="dice" players={PLAYERS} />);
  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));

  expect(mockWebProps?.accessible).toBe(false);
  expect(mockWebProps?.accessibilityElementsHidden).toBe(true);
  expect(mockWebProps?.importantForAccessibility).toBe('no-hide-descendants');
});

it('announces loading politely and errors assertively while Retry stays reachable', async () => {
  const onError = jest.fn();
  render(<GameHost game="dice" players={PLAYERS} onError={onError} />);

  // The live region sits on the status container above the message text.
  const liveRegionOf = (text: string) => {
    let node = screen.getByText(text);
    while (node && node.props.accessibilityLiveRegion === undefined) {
      node = node.parent as typeof node;
    }
    return node?.props.accessibilityLiveRegion;
  };
  expect(liveRegionOf('Načítám hru…')).toBe('polite');

  await waitFor(() => expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' }));
  act(() => (mockWebProps?.onError as (() => void) | undefined)?.());

  expect(liveRegionOf('Hru se nepodařilo načíst.')).toBe('assertive');
  expect(screen.getByLabelText('Zkusit znovu').props.accessibilityRole).toBe('button');
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
  expect(mockWebProps?.source).toEqual({ uri: 'file:///dice.html' });

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
