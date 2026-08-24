/**
 * Focused tests for menu/beer photo picker preprocessing: asset dimensions must
 * drive resizing, never upscale, and long-edge + total-pixel caps must apply
 * before manipulateAsync. Permission/cancel/error semantics stay untouched.
 */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { pickAndPrepareMenuPhoto } from '../menuPhotoPicker';
import { pickAndPrepareBeerPhoto } from '../beerPhotoPicker';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

const mockedManipulate = manipulateAsync as jest.Mock;
const mockedLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;

/** Default granted permission + library launch returning one asset. */
function grantedAsset(width: number | undefined, height: number | undefined) {
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: true,
    canAskAgain: true,
  });
  mockedLaunchLibrary.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://picked.jpg', width, height }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedManipulate.mockResolvedValue({ uri: 'file://prepared.jpg' });
});

describe('shared preprocessing', () => {
  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: landscape asset resizes width to the long-edge cap', async (_n, pick) => {
    grantedAsset(4000, 3000);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: portrait asset resizes by height so the long edge hits the cap', async (_n, pick) => {
    grantedAsset(1200, 3600);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { height: 1600 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: extreme panorama gets its long edge capped', async (_n, pick) => {
    grantedAsset(12000, 400);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: extreme portrait gets its long edge capped', async (_n, pick) => {
    grantedAsset(500, 14000);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { height: 1600 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: small photo is never upscaled (no resize op, re-encode only)', async (_n, pick) => {
    grantedAsset(800, 600);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: total pixel cap shrinks further than the long-edge cap alone', async (_n, pick) => {
    // Long-edge cap alone would yield 1600x1400 = 2.24M pixels.
    grantedAsset(4000, 3500);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { width: 1511 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
    // Derived check: the asserted literal keeps total pixels under the cap.
    expect(1511 * Math.floor((3500 / 4000) * 1511)).toBeLessThanOrEqual(2_000_000);
  });

  test.each([
    ['menu', pickAndPrepareMenuPhoto],
    ['beer', pickAndPrepareBeerPhoto],
  ])('%s: square photo under the long-edge cap still resizes when over the pixel cap', async (_n, pick) => {
    // 1500x1500 passes the long-edge cap but is 2.25M pixels in total.
    grantedAsset(1500, 1500);

    await pick('library');

    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [{ resize: { width: 1414 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
    expect(1414 * Math.floor((1500 / 1500) * 1414)).toBeLessThanOrEqual(2_000_000);
  });
});

describe('missing / invalid dimensions', () => {
  test.each([undefined, 0, NaN, Infinity])(
    'beer flow rejects unsafe dimensions (%s) instead of passing through the original',
    async (dim) => {
      grantedAsset(dim, dim);

      const result = await pickAndPrepareBeerPhoto('library');

      expect(result).toEqual({ status: 'error' });
      expect(mockedManipulate).not.toHaveBeenCalled();
    },
  );

  test('menu flow stays compatible: unsafe dimensions degrade to re-encode, never upscale', async () => {
    grantedAsset(undefined, undefined);

    const result = await pickAndPrepareMenuPhoto('library');

    expect(result).toEqual({ status: 'picked', uri: 'file://prepared.jpg' });
    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://picked.jpg',
      [],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });
});

describe('manipulator failure', () => {
  beforeEach(() => {
    mockedManipulate.mockRejectedValue(new Error('manipulator exploded'));
  });

  test('menu scan keeps compatibility and returns the original URI', async () => {
    grantedAsset(4000, 3000);

    const result = await pickAndPrepareMenuPhoto('library');

    expect(result).toEqual({ status: 'picked', uri: 'file://picked.jpg' });
  });

  test('beer flow must NOT return the potentially huge original', async () => {
    grantedAsset(4000, 3000);

    const result = await pickAndPrepareBeerPhoto('library');

    expect(result).toEqual({ status: 'error' });
  });
});

describe('preserved picker semantics', () => {
  test('permission refused maps to denied', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });

    expect(await pickAndPrepareBeerPhoto('library')).toEqual({ status: 'denied' });
    expect(await pickAndPrepareMenuPhoto('library')).toEqual({ status: 'denied' });
    expect(mockedManipulate).not.toHaveBeenCalled();
  });

  test('permanent refusal maps to denied-permanent', async () => {
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });

    expect(await pickAndPrepareBeerPhoto('library')).toEqual({ status: 'denied-permanent' });
  });

  test('user cancel maps to cancelled', async () => {
    grantedAsset(4000, 3000);
    mockedLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });

    expect(await pickAndPrepareMenuPhoto('library')).toEqual({ status: 'cancelled' });
    expect(await pickAndPrepareBeerPhoto('library')).toEqual({ status: 'cancelled' });
    expect(mockedManipulate).not.toHaveBeenCalled();
  });

  test('camera path requests camera permission and launches camera', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://shot.jpg', width: 4000, height: 3000 }],
    });

    const result = await pickAndPrepareBeerPhoto('camera');

    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    expect(result).toEqual({ status: 'picked', uri: 'file://prepared.jpg' });
    expect(mockedManipulate).toHaveBeenCalledWith(
      'file://shot.jpg',
      [{ resize: { width: 1600 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
  });
});
