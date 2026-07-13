/** Pick one support screenshot/photo and compress it before it enters the queue. */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type FeedbackAttachmentSource = 'camera' | 'library';

export type FeedbackAttachmentPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'denied-permanent' }
  | { status: 'error' };

const MAX_EDGE = 1440;
const JPEG_QUALITY = 0.72;

export async function pickFeedbackAttachment(
  source: FeedbackAttachmentSource,
): Promise<FeedbackAttachmentPickResult> {
  try {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return { status: permission.canAskAgain ? 'denied' : 'denied-permanent' };
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
            selectionLimit: 1,
          });
    if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };

    const asset = result.assets[0];
    const resize =
      asset.width >= asset.height
        ? { resize: { width: MAX_EDGE } }
        : { resize: { height: MAX_EDGE } };
    const prepared = await manipulateAsync(asset.uri, [resize], {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { status: 'picked', uri: prepared.uri };
  } catch {
    return { status: 'error' };
  }
}
