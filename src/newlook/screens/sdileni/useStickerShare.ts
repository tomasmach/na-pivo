import { useCallback, useRef, useState } from 'react';
import { Linking, Share, type LayoutChangeEvent, type ViewInstance } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { t } from '@/i18n';

import { toast } from '../../ui/store';

const INSTAGRAM_STORY_URL = 'instagram://story-camera';
const EXPORT_SCALE = 3;

/**
 * Turns the sticker under `ref` into a transparent PNG and hands it on, the
 * same path as the old story card: clipboard for Instagram, the system share
 * sheet for everything else (it also offers saving to Photos).
 */
export function useStickerShare() {
  const ref = useRef<ViewInstance>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    size.current = { width: width * EXPORT_SCALE, height: height * EXPORT_SCALE };
  }, []);

  const capture = useCallback(
    (result: 'base64' | 'tmpfile') =>
      captureRef(ref, { format: 'png', quality: 1, result, ...(size.current ?? {}) }),
    [],
  );

  const run = useCallback(
    (job: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      job()
        .catch(() => toast({ kind: 'error', title: t.nv.sdileni.shareError, icon: 'info' }))
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const toInstagram = useCallback(
    () =>
      run(async () => {
        await Clipboard.setImageAsync(await capture('base64'));
        try {
          await Linking.openURL(INSTAGRAM_STORY_URL);
          toast({ kind: 'saved', title: t.nv.sdileni.inInstagram, icon: 'send' });
        } catch {
          toast({ kind: 'saved', title: t.nv.sdileni.copied, icon: 'send' });
        }
      }),
    [capture, run],
  );

  const shareImage = useCallback(
    () =>
      run(async () => {
        const uri = await capture('tmpfile');
        const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: 'image/png', UTI: 'public.png' });
        } else {
          await Share.share({ url: fileUri, message: '' });
        }
      }),
    [capture, run],
  );

  const copyLink = useCallback(
    (url: string) =>
      run(async () => {
        await Clipboard.setStringAsync(url);
        toast({ kind: 'saved', title: t.nv.sdileni.linkCopied, icon: 'link' });
      }),
    [run],
  );

  return { ref, onLayout, busy, toInstagram, shareImage, copyLink };
}
