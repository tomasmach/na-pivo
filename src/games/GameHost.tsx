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
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { createGameCommandQueue } from '@/games/commandQueue';
import { cs } from '@/i18n/cs';
import { MockColors } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/**
 * Every playable page, by catalogue key.
 *
 * `require` needs a literal, so this map is the one place a game's file is
 * named. Adding a game is a line here plus an entry in `scripts/build-games.mjs`.
 */
const GAME_PAGES: Record<string, number> = {
  dice: require('../../assets/games/dice.html'),
  bottle: require('../../assets/games/bottle.html'),
  wheel: require('../../assets/games/wheel.html'),
};

const WebView: typeof WebViewType | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webview').WebView;
  } catch {
    return null;
  }
})();

/**
 * How long a sent command may wait for the page before the queue gives up.
 * Deliberately longer than the load timeout below: a slow cold start must
 * surface as "Načítám" with a Retry, never as the queue silently eating a
 * turn while the game is still coming up.
 */
const HOST_READY_GRACE_MS = 12_000;

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
  const [attempt, setAttempt] = React.useState(0);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = React.useState<string>(cs.gameHost.loading);
  const errorRef = React.useRef(onError);
  errorRef.current = onError;

  const fail = React.useCallback((next: string) => {
    setStatus('error');
    setMessage(next);
    errorRef.current?.(next);
  }, []);

  React.useEffect(() => {
    let alive = true;
    setUri(null);
    setStatus('loading');
    setMessage(cs.gameHost.loading);
    if (!WebView) {
      fail(cs.gameHost.unavailable);
      return () => {
        alive = false;
      };
    }
    const page = GAME_PAGES[game];
    if (!page) {
      fail(cs.gameHost.unavailable);
      return () => {
        alive = false;
      };
    }
    Asset.fromModule(page)
      .downloadAsync()
      .then((asset) => {
        if (!alive) return;
        if (asset.localUri) setUri(asset.localUri);
        else fail(cs.gameHost.loadFailed);
      })
      .catch(() => {
        if (alive) fail(cs.gameHost.loadFailed);
      });
    return () => {
      alive = false;
    };
  }, [attempt, fail, game]);

  React.useEffect(() => {
    // Start at the beginning of the attempt, not only after Expo has resolved
    // the bundled HTML. Asset.downloadAsync can hang too, and otherwise this
    // screen would stay on "Načítám" forever without exposing Retry.
    if (status !== 'loading') return undefined;
    const timer = setTimeout(() => fail(cs.gameHost.timeout), 8000);
    return () => clearTimeout(timer);
  }, [fail, status]);

  const post = React.useCallback((message: ToGame) => {
    webRef.current?.injectJavaScript(
      `window.napivoGame && window.napivoGame(${JSON.stringify(JSON.stringify(message))});true;`,
    );
  }, []);

  // Every handle message that has not actually left for the page yet. The
  // command queue drops its own buffer when its timer expires, so this is the
  // durable copy: a late `ready` after a slow cold load re-delivers whatever
  // was stranded instead of leaving a game waiting for a turn forever.
  const outboxRef = React.useRef<ToGame[]>([]);
  const postTracked = React.useCallback(
    (message: ToGame) => {
      outboxRef.current = outboxRef.current.filter((sent) => sent !== message);
      post(message);
    },
    [post],
  );

  // Outlives the host-level load timeout so the queue itself never falsely
  // fails a game that is merely loading slowly — buffering is our job here.
  const queue = React.useMemo(
    () =>
      createGameCommandQueue(postTracked, () => fail(cs.gameHost.timeout), HOST_READY_GRACE_MS),
    // A changed asset is a new bridge even though the writer function is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt, fail, game, postTracked],
  );
  React.useEffect(() => {
    outboxRef.current = [];
    return () => queue.dispose();
  }, [queue]);

  React.useImperativeHandle(ref, () => ({
    command: (name, payload) => {
      const message: ToGame = { v: GAME_PROTOCOL_VERSION, type: 'command', name, payload };
      outboxRef.current.push(message);
      queue.send(message);
    },
    turn: (playerId) => {
      const message: ToGame = { v: GAME_PROTOCOL_VERSION, type: 'turn', playerId };
      outboxRef.current.push(message);
      queue.send(message);
    },
  }), [queue]);

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
        queue.ready();
        // A ready that arrives after the queue gave up still gets every
        // buffered command — late success is success.
        for (const pending of outboxRef.current.splice(0)) post(pending);
        setStatus('ready');
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
        fail(message.message);
        break;
    }
  };

  return (
    <View style={styles.wrap}>
      {WebView && uri ? (
        <WebView
          key={`${game}:${attempt}`}
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
          onError={() => fail(cs.gameHost.loadFailed)}
          onContentProcessDidTerminate={() => fail(cs.gameHost.stopped)}
          androidLayerType="hardware"
        />
      ) : null}
      {status !== 'ready' ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          <Text style={styles.statusText} maxFontSizeMultiplier={FontScaleCap.body}>
            {message}
          </Text>
          {status === 'error' ? (
            <Pressable
              onPress={() => setAttempt((value) => value + 1)}
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.gameHost.retry}
            >
              <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.gameHost.retry}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
  status: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    backgroundColor: MockColors.bg,
  },
  statusText: { fontSize: 15, fontWeight: '600', color: Colors.mutedText, textAlign: 'center' },
  retry: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  retryText: { fontSize: 15, fontWeight: '800', color: Colors.stout },
  pressed: { opacity: 0.8 },
});
