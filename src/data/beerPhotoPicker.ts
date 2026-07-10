/**
 * Beer photo picker — lets the user snap their beer with the camera or pick an
 * existing photo from the library for the photo diary ("FotoPivař").
 *
 * The capture pipeline is IDENTICAL to the menu-scan picker: source-appropriate
 * permission, no forced aspect (a glass on a table composes freely), downscale
 * the long edge to ~1600px and re-encode as JPEG 0.7 to keep the multipart
 * upload small. So instead of forking ~90 lines we delegate to
 * pickAndPrepareMenuPhoto and only own the beer-diary names/types here. If the
 * beer pipeline ever diverges (different size, cropping, EXIF), fork the
 * implementation into this module — do NOT push beer-specific knobs into the
 * menu picker.
 *
 * Returns the same discriminated result shape so callers never need try/catch:
 *   - {status:'picked', uri}      → got a downscaled JPEG, ready to persist+upload.
 *   - {status:'cancelled'}        → user backed out (no toast).
 *   - {status:'denied'}           → permission refused but can be re-prompted.
 *   - {status:'denied-permanent'} → permission refused for good (canAskAgain=false).
 *   - {status:'error'}            → anything else went wrong.
 */

import { pickAndPrepareMenuPhoto } from './menuPhotoPicker';

/** Which capture path the caller's action sheet picked. */
export type BeerPhotoSource = 'camera' | 'library';

export type BeerPhotoPickResult =
  | { status: 'picked'; uri: string }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'denied-permanent' }
  | { status: 'error' };

/**
 * Ask for the source-appropriate permission (no-op if already granted), launch
 * the camera or library without a forced aspect, then downscale to a ~1600px
 * long-edge JPEG (quality 0.7). Never throws.
 */
export async function pickAndPrepareBeerPhoto(
  source: BeerPhotoSource,
): Promise<BeerPhotoPickResult> {
  return pickAndPrepareMenuPhoto(source);
}
