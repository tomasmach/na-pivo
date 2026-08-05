/**
 * The app side of the bridge — one host for every WebView game.
 *
 * It knows the protocol and nothing else: no dice, no cards, no rules. Give it a
 * game key, the players and their colours, and it hands back `ready`, `event`
 * and `result` as typed callbacks. The tenth game is a new HTML file and a new
 * entry in `GAME_PAGES`, not a new component.
 *
 * The page is a bundled asset, so it works with no signal — a pub is exactly
 * where there is none.
 *
 * `react-native-webview` is loaded defensively. It is a native dependency, and
 * a binary built before it existed — an older TestFlight build, a colleague who
 * has not rebuilt — would otherwise throw on import and, because this sits
 * inside a route, take the whole screen down. A game that cannot draw should
 * cost the table, not the evening: `GAME_HOST_AVAILABLE` lets a caller fall
 * back to playing without a canvas.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WebView as WebViewType, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';

import {
  GAME_PROTOCOL_VERSION,
  parseFromGame,
  type FromGame,
  type GamePlayer,
  type GameScore,
  type ToGame,
} from '@/games/protocol';
import { MockColors } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';

/**
 * Every playable page, by catalogue key.
 *
 * `require` needs a literal, so this map is the one place a game's file is
 * named. Adding a game is a line here plus an entry in `scripts/build-games.mjs`.
 */
const GAME_PAGES: Record<string, number> = {
  dice: require('../../assets/games/dice.html'),
};

const WebView: typeof WebViewType | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webview').WebView;
  } catch {
    return null;
  }
})();

/** Whether this build can show a canvas game at all. */
export const GAME_HOST_AVAILABLE = WebView !== null;

export interface GameHostHandle {
  /** A verb the game declares — "roll", "spin", "draw". */
  command: (name: string, payload?: unknown) => void;
  /** Whose turn it is now. Sent before every turn; never assumed by the game. */
  turn: (playerId: string) => void;
}

export const GameHost = React.forwardRef<
  GameHostHandle,
  {
    /** Catalogue key; must exist in `GAME_PAGES`. */
    game: string;
    players: GamePlayer[];
    options?: Record<string, unknown>;
    /** The game's full state, after every change. Cast it to the game's shape. */
    onState?: (state: unknown) => void;
    onEvent?: (name: string, payload?: unknown) => void;
    onResult?: (result: {
      scores: GameScore[];
      winnerId: string | null;
      payingId?: string | null;
    }) => void;
    onError?: (message: string) => void;
  }
>(function GameHost({ game, players, options, onState, onEvent, onResult, onError }, ref) {
  const webRef = React.useRef<WebViewType>(null);
  const [uri, setUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    const page = GAME_PAGES[game];
    if (!page) {
      onError?.(`Hra "${game}" v této verzi aplikace není.`);
      return undefined;
    }
    Asset.fromModule(page)
      .downloadAsync()
      .then((asset) => {
        if (alive && asset.localUri) setUri(asset.localUri);
      })
      .catch(() => onError?.('Hru se nepodařilo načíst.'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const post = React.useCallback((message: ToGame) => {
    webRef.current?.injectJavaScript(
      `window.napivoGame && window.napivoGame(${JSON.stringify(JSON.stringify(message))});true;`,
    );
  }, []);

  React.useImperativeHandle(ref, () => ({
    command: (name, payload) => post({ v: GAME_PROTOCOL_VERSION, type: 'command', name, payload }),
    turn: (playerId) => post({ v: GAME_PROTOCOL_VERSION, type: 'turn', playerId }),
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    const message: FromGame | null = parseFromGame(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        // Init only after the page says it is listening: sent earlier it lands
        // before the SDK has hooked itself up and is silently lost.
        post({
          v: GAME_PROTOCOL_VERSION,
          type: 'init',
          players,
          theme: {
            bg: MockColors.bg,
            surface: MockColors.surfaceHigh,
            accent: Colors.amber,
            ink: Colors.foam,
          },
          options,
        });
        break;
      case 'state':
        onState?.(message.state);
        break;
      case 'event':
        onEvent?.(message.name, message.payload);
        break;
      case 'result':
        onResult?.({
          scores: message.scores,
          winnerId: message.winnerId,
          payingId: message.payingId,
        });
        break;
      case 'error':
        onError?.(message.message);
        break;
    }
  };

  if (!WebView || !uri) return <View style={styles.wrap} />;

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ uri }}
        style={styles.web}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        javaScriptEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        androidLayerType="hardware"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
