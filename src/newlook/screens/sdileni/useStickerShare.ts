import { useCallback, useRef, useState } from 'react';
import { Linking, Share, type LayoutChangeEvent, type ViewInstance } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { openSystemSettings } from '@/compass/permissions';
import { t } from '@/i18n';

import { dialog, toast } from '../../ui/store';

const INSTAGRAM_STORY_URL = 'instagram://story-camera';
const EXPORT_SCALE = 3;

/**
 * Turns the sticker under `ref` into a transparent PNG and hands it on:
 * clipboard for Instagram, the Photos library, or the system share sheet.
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

  const saveToPhotos = useCallback(
    () =>
      run(async () => {
        const permission = await MediaLibrary.requestPermissionsAsync(true);
        if (!permission.granted) {
          dialog({
            title: t.nv.sdileni.photosDeniedTitle,
            body: t.nv.sdileni.photosDeniedBody,
            actions: [{ label: t.nv.sdileni.photosDeniedBack }, { label: t.nv.sdileni.openSettings, kind: 'primary', onPress: () => void openSystemSettings() }],
          });
          return;
        }
        const uri = await capture('tmpfile');
        await MediaLibrary.Asset.create(uri.startsWith('file://') ? uri : `file://${uri}`);
        toast({ kind: 'saved', title: t.nv.sdileni.savedToPhotos, icon: 'download' });
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

  return { ref, onLayout, busy, toInstagram, shareImage, saveToPhotos, copyLink };
}
