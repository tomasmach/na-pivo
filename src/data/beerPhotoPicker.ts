/**
 * Beer photo picker — lets the user snap their beer with the camera or pick an
 * existing photo from the library for the photo diary ("FotoPivař").
 *
 * The capture pipeline mirrors the menu-scan picker: source-appropriate
 * permission, no forced aspect (a glass on a table composes freely), then a
 * never-upscaling downscale capped at a 1600px long edge / 2M total pixels,
 * re-encoded as JPEG 0.7 to keep the multipart upload small. The shared resize
 * math lives in planPreprocessActions (menuPhotoPicker); the flow itself is
 * forked here because the failure semantics diverge: unlike the menu scan, a
 * beer photo must NEVER fall back to the picked original — an unprocessed shot
 * can be huge, so any preprocessing failure returns {status:'error'}.
 *
 * Returns the same discriminated result shape so callers never need try/catch:
 *   - {status:'picked', uri}      → got a downscaled JPEG, ready to persist+upload.
 *   - {status:'cancelled'}        → user backed out (no toast).
 *   - {status:'denied'}           → permission refused but can be re-prompted.
 *   - {status:'denied-permanent'} → permission refused for good (canAskAgain=false).
 *   - {status:'error'}            → anything else went wrong.
 */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { planPreprocessActions } from './menuPhotoPicker';

/** Which capture path the caller's action sheet picked. */
export type BeerPhotoSource = 'camera' | 'library';

export type BeerPhotoPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'denied-permanent' }
  | { status: 'error' };

/** JPEG quality for the pre-upload downscale. */
const JPEG_QUALITY = 0.7;

/**
 * Ask for the source-appropriate permission (no-op if already granted), launch
 * the camera or library without a forced aspect, then downscale to at most a
 * 1600px long-edge / 2MP JPEG (quality 0.7). Never throws; preprocessing
 * failures surface as {status:'error'}, not as the raw original.
 */
export async function pickAndPrepareBeerPhoto(
  source: BeerPhotoSource,
): Promise<BeerPhotoPickResult> {
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

    if (result.canceled || result.assets.length === 0) {
      return { status: 'cancelled' };
    }

    const asset = result.assets[0];
    const plan = planPreprocessActions(asset.width, asset.height);
    if (!plan.safe) {
      // Untrustworthy dimensions mean we cannot bound the output — refuse
      // rather than hand through a potentially enormous original.
      return { status: 'error' };
    }
    try {
      const out = await manipulateAsync(asset.uri, plan.actions, {
        compress: JPEG_QUALITY,
        format: SaveFormat.JPEG,
      });
      return { status: 'picked', uri: out.uri };
    } catch {
      return { status: 'error' };
    }
  } catch {
    return { status: 'error' };
  }
}
