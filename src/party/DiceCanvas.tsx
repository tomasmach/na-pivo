/**
 * The dice table, as a WebView.
 *
 * A thin wrapper over `assets/games/dice.html` — three.js and cannon-es, built
 * by `npm run build:games`. Everything interesting is in that page; this file
 * only carries two messages across the bridge, which is the whole reason a
 * WebView is acceptable here: a game is a self-contained thing, so it does not
 * need to share components with the app, and its surface stays two lines wide.
 *
 *   in    `napivoRoll()` — throw them
 *   out   `{ type: 'settled', dice }` — what actually landed
 *
 * The numbers come OUT, they do not go in. The simulation is the randomness, so
 * the roll is genuinely fair rather than an animation played towards a value
 * somebody picked. `diceDuel.ts` stays the rules and stays testable; it just
 * receives its dice from here instead of `Math.random()`.
 *
 * The theme travels in the query string so the canvas cannot drift from the app.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { WebView as WebViewType, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';

import { MockColors } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PAGE = require('../../assets/games/dice.html');

/**
 * Loaded defensively, because a missing native module must not take a screen
 * down with it.
 *
 * `react-native-webview` is a native dependency: an app binary built before it
 * was added — an older TestFlight build, a colleague who has not rebuilt, a
 * stale simulator install — throws on import and, because this component sits
 * inside a route, expo-router reports the whole route as having no default
 * export. A game that cannot draw its table should fall back to a plain roll,
 * not white-screen the evening.
 */
const WebView: typeof WebViewType | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-webview').WebView;
  } catch {
    return null;
  }
})();

export interface DiceCanvasHandle {
  roll: () => void;
}

/** Whether this build can draw the table at all. */
export const DICE_CANVAS_AVAILABLE = WebView !== null;

export const DiceCanvas = React.forwardRef<
  DiceCanvasHandle,
  {
    count?: number;
    onSettled: (dice: number[]) => void;
    onReady?: () => void;
  }
>(function DiceCanvas({ count = 2, onSettled, onReady }, ref) {
  const webRef = React.useRef<WebViewType>(null);
  const [uri, setUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    // Bundled, not fetched: the page has to work with no signal at all.
    Asset.fromModule(PAGE)
      .downloadAsync()
      .then((asset) => {
        if (alive && asset.localUri) setUri(asset.localUri);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  React.useImperativeHandle(ref, () => ({
    roll: () => webRef.current?.injectJavaScript('window.napivoRoll && window.napivoRoll();true;'),
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'settled' && Array.isArray(message.dice)) onSettled(message.dice);
      else if (message.type === 'ready') onReady?.();
    } catch {
      // A malformed frame is not worth taking the game down for.
    }
  };

  if (!WebView || !uri) return <View style={styles.wrap} />;

  const query =
    `?count=${count}` +
    `&bg=${encodeURIComponent(MockColors.bg)}` +
    `&face=${encodeURIComponent('#FBF6EA')}` +
    `&pip=${encodeURIComponent(Colors.stout)}`;

  return (
    <View style={styles.wrap}>
      <WebView
        ref={webRef}
        source={{ uri: `${uri}${query}` }}
        style={styles.web}
        // The page is ours and local; nothing here may navigate anywhere.
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
        // Transparent so the table sits on the app's own ground rather than on a
        // white page that flashes while it loads.
        androidLayerType="hardware"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
