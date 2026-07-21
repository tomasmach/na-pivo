import { Platform } from 'react-native';

/**
 * Stages the pre-scaled app icon into the widgets app-group container so the
 * Live Activity extension can render it. The widget process cannot read the
 * main app bundle, and `uiImage` performs a synchronous read, which is why a
 * small 128px asset is copied instead of the 1024px app icon.
 *
 * Returns a `file://` URI, or an empty string when unavailable (Expo Go, tests,
 * Android, missing app group). The result is cached for the process lifetime.
 */
let cachedIconUri: Promise<string> | undefined;

export function ensureLiveActivityIconUri(): Promise<string> {
  if (Platform.OS !== 'ios') return Promise.resolve('');
  cachedIconUri ??= stageIcon().catch(() => '');
  return cachedIconUri;
}

async function stageIcon(): Promise<string> {
  // Lazy requires keep Expo Go and the jest harness free of native modules.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { widgetsDirectory } = require('expo-widgets') as { widgetsDirectory?: string };
  if (!widgetsDirectory) return '';
  const { Asset } = require('expo-asset') as typeof import('expo-asset');
  const FileSystem =
    require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  const iconModule = require('../../assets/images/live-activity-icon.png');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const asset = Asset.fromModule(iconModule);
  await asset.downloadAsync();
  const source = asset.localUri ?? asset.uri;
  if (!source) return '';

  const target = `${widgetsDirectory.replace(/\/?$/, '/')}live-activity-icon.png`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    await FileSystem.copyAsync({ from: source, to: target });
  }
  return target;
}
