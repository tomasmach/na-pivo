import type { GameDefinition } from '@/games/web/sdk';

interface HarnessWindow {
  ReactNativeWebView?: { postMessage(message: string): void };
  napivoGame?(raw: string): void;
}

const THEME = { bg: '#15120F', surface: '#1C1815', accent: '#E8A317', ink: '#FBF6EA' };

function loadSdk(postMessage: jest.Mock): { connect: typeof import('@/games/web/sdk').connect } {
  (global as unknown as { window: HarnessWindow }).window = {
    ReactNativeWebView: { postMessage },
  };
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/games/web/sdk');
}

const initFrame = JSON.stringify({
  v: 1,
  type: 'init',
  players: [{ id: 'a', colour: '#E8A317' }],
  theme: THEME,
});

const definition = (): GameDefinition => ({ commands: [], start: jest.fn(() => () => undefined) });

describe('sdk', () => {
  it('answers ready and runs start on the first init', () => {
    const postMessage = jest.fn();
    const { connect } = loadSdk(postMessage);
    const def = definition();

    connect(def);

    expect(postMessage).toHaveBeenCalledWith(expect.stringContaining('"type":"ready"'));
    (global as unknown as { window: HarnessWindow }).window.napivoGame?.(initFrame);
    expect(def.start).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated init frames so start runs exactly once per page lifetime', () => {
    const postMessage = jest.fn();
    const { connect } = loadSdk(postMessage);
    const def = definition();

    connect(def);

    (global as unknown as { window: HarnessWindow }).window.napivoGame?.(initFrame);
    (global as unknown as { window: HarnessWindow }).window.napivoGame?.(initFrame);

    expect(def.start).toHaveBeenCalledTimes(1);
  });
});
