/**
 * Avatar picker — opens the system photo library, lets the user square-crop,
 * then pre-downscales to ~512px JPEG before handing the local URI to the
 * uploader. The backend re-encodes to a 256px webp regardless, but shrinking
 * client-side keeps the multipart upload small (and well under the 5 MB cap).
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

/** Longest edge we downscale to before upload — comfortably above the 256px the backend keeps. */
const MAX_EDGE = 512;
/** JPEG quality for the pre-upload downscale. */
const JPEG_QUALITY = 0.85;

export type AvatarPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'denied-permanent' }
  | { status: 'error' };

/**
 * Prompt for library permission (no-op if already granted), launch the picker
 * with a square crop, then downscale. Never throws.
 */
export async function pickAndPrepareAvatar(): Promise<AvatarPickResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // canAskAgain=false (common on iOS after "Don't Allow") means re-prompting
      // is futile — the only path back is the system Settings app.
      return { status: permission.canAskAgain ? 'denied' : 'denied-permanent' };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      selectionLimit: 1,
    });

    if (result.canceled || result.assets.length === 0) {
      return { status: 'cancelled' };
    }

    const asset = result.assets[0];
    const uri = await downscale(asset.uri);
    return { status: 'picked', uri };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Resize the longest edge to MAX_EDGE (preserving aspect) and re-encode to JPEG.
 * Falls back to the original URI if manipulation fails — the backend can still
 * accept and re-encode it.
 */
async function downscale(uri: string): Promise<string> {
  try {
    const out = await manipulateAsync(uri, [{ resize: { width: MAX_EDGE } }], {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    return uri;
  }
}
