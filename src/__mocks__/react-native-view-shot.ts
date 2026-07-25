/**
 * Test mock for react-native-view-shot (native module, untranspiled ESM
 * source). ShareNightModal rasterizes the sticker view through captureRef;
 * under test it resolves to a fake tmpfile URI (or empty base64).
 */

interface CaptureOptions {
  result?: 'tmpfile' | 'base64' | 'data-uri';
  [key: string]: unknown;
}

export async function captureRef(_ref: unknown, options?: CaptureOptions): Promise<string> {
  return options?.result === 'base64' ? '' : 'file:///mock-capture.png';
}
