/**
 * Menu photo picker — lets the user EITHER snap the pub's beer menu with the
 * camera OR pick an existing photo from the library, then pre-downscales it to a
 * tall-friendly ~1600px-wide JPEG before handing the local URI to the scan
 * uploader. The wider edge (vs the 512px avatar) keeps small menu text legible
 * for OCR, while the 0.7 JPEG compression keeps the multipart upload small.
 *
 * A menu is TALL, so unlike the avatar picker we never force a square crop /
 * aspect — that would chop off half the beers.
 *
 * Returns a small discriminated result so callers never need try/catch:
 *   - {status:'picked', uri}      → got an image, ready to upload.
 *   - {status:'cancelled'}        → user backed out (no toast).
 *   - {status:'denied'}           → permission refused but can be re-prompted.
 *   - {status:'denied-permanent'} → permission refused for good (canAskAgain=false);
 *                                   only the system Settings app can re-grant it.
 *   - {status:'error'}            → anything else went wrong.
 *
 * Both native modules (expo-image-picker / expo-image-manipulator) need a dev
 * client rebuild to be present at runtime; this module only imports their JS.
 */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Which capture path the caller's action sheet picked. */
export type MenuPhotoSource = 'camera' | 'library';

/** Target width we downscale to before upload — wide enough for OCR detail. */
const MAX_WIDTH = 1600;
/** JPEG quality for the pre-upload downscale (smaller than avatar; OCR-friendly). */
const JPEG_QUALITY = 0.7;

export type MenuPhotoPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'denied-permanent' }
  | { status: 'error' };

/**
 * Ask for the source-appropriate permission (no-op if already granted), launch
 * the camera or library WITHOUT a forced aspect (a menu is tall), then downscale.
 * Never throws.
 */
export async function pickAndPrepareMenuPhoto(
  source: MenuPhotoSource,
): Promise<MenuPhotoPickResult> {
  try {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // canAskAgain=false (common on iOS after "Don't Allow") means re-prompting
      // is futile — the only path back is the system Settings app.
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

    if (result.canceled || result.assets.length === 0) {
      return { status: 'cancelled' };
    }

    const uri = await downscale(result.assets[0].uri);
    return { status: 'picked', uri };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Resize the width to MAX_WIDTH (preserving aspect, so tall menus stay tall) and
 * re-encode to JPEG. Falls back to the original URI if manipulation fails — the
 * backend can still accept and re-encode it.
 */
async function downscale(uri: string): Promise<string> {
  try {
    const out = await manipulateAsync(uri, [{ resize: { width: MAX_WIDTH } }], {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    return uri;
  }
}
