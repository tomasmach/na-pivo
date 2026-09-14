/**
 * Menu photo picker — lets the user EITHER snap the pub's beer menu with the
 * camera OR pick an existing photo from the library, then pre-downscales it to
 * a tall-friendly JPEG whose longer edge is at most 1600px (never upscaled,
 * total pixels capped) before handing the local URI to the scan uploader. The
 * wider edge (vs the 512px avatar) keeps small menu text legible for OCR, while
 * the 0.7 JPEG compression keeps the multipart upload small.
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
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';

/** Which capture path the caller's action sheet picked. */
export type MenuPhotoSource = 'camera' | 'library';

/** Long-edge cap we downscale to before upload — wide enough for OCR detail. */
const MAX_LONG_EDGE = 1600;
/** Total-pixel cap so near-square shots can't stay huge even under 1600 long edge. */
const MAX_PIXELS = 2_000_000;
/** JPEG quality for the pre-upload downscale (smaller than avatar; OCR-friendly). */
const JPEG_QUALITY = 0.7;

function isSafeDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compute the resize actions for a picked asset from its real dimensions.
 * Never upscales (scale is capped at 1), caps the longer edge at MAX_LONG_EDGE
 * and the total pixel count at MAX_PIXELS. Dimensions that are missing, zero
 * or non-finite are reported as unsafe with re-encode-only actions, so callers
 * can decide between degrading gracefully and failing explicitly.
 */
export function planPreprocessActions(
  width: unknown,
  height: unknown,
): { safe: boolean; actions: Action[] } {
  if (!isSafeDimension(width) || !isSafeDimension(height)) {
    return { safe: false, actions: [] };
  }
  const longEdge = Math.max(width, height);
  let scale = Math.min(1, MAX_LONG_EDGE / longEdge);
  const pixels = width * height;
  if (pixels * scale * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / pixels);
  }
  if (scale >= 1) {
    return { safe: true, actions: [] };
  }
  // Floor, not round, so integer rounding can never push past either cap.
  const action =
    width >= height
      ? { resize: { width: Math.floor(width * scale) } }
      : { resize: { height: Math.floor(height * scale) } };
  return { safe: true, actions: [action] };
}

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

    const asset = result.assets[0];
    const uri = await downscale(asset);
    return { status: 'picked', uri };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Resize per planPreprocessActions (never upscales) and re-encode to JPEG.
 * Falls back to the original URI if manipulation fails — the backend can still
 * accept and re-encode it.
 */
async function downscale(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  try {
    const plan = planPreprocessActions(asset.width, asset.height);
    const out = await manipulateAsync(asset.uri, plan.actions, {
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return out.uri;
  } catch {
    return asset.uri;
  }
}
