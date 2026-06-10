/**
 * Wrap-aware exponential moving average for compass headings.
 */

export interface AngleEMAFn {
  (next: number): number;
  reset(): void;
}

/**
 * Creates a stateful angle EMA updater.
 *
 * @param alpha  Smoothing factor in (0, 1]. Higher = more responsive, lower = smoother.
 *               Default recommended value for compass heading: 0.65.
 *
 * On first call: returns `next` unchanged.
 * On subsequent calls: wrap-aware EMA:
 *   diff = ((next − prev + 540) % 360) − 180
 *   smoothed = (prev + alpha * diff + 360) % 360
 *
 * `.reset()` clears internal state so the next call is treated as first.
 */
export function createAngleEMA(alpha: number): AngleEMAFn {
  let prev: number | null = null;

  const update = (next: number): number => {
    if (prev === null) {
      prev = next;
      return next;
    }
    const diff = ((next - prev + 540) % 360) - 180;
    const smoothed = (prev + alpha * diff + 360) % 360;
    prev = smoothed;
    return smoothed;
  };

  update.reset = (): void => {
    prev = null;
  };

  return update;
}

/** Default alpha for compass heading smoothing (iOS). */
export const DEFAULT_HEADING_ALPHA = 0.65;

/**
 * Heavier smoothing for Android. Its native heading stream is sparse and
 * quantized: expo-location reads raw, unfiltered magnetometer/accelerometer
 * values and only emits when the azimuth moves > ~2° (and ≥ 50 ms passed), so
 * sensor noise arrives as discrete multi-degree jumps rather than the dense,
 * pre-fused stream CoreLocation provides on iOS.
 */
export const ANDROID_HEADING_ALPHA = 0.3;

/** Pick the heading EMA alpha for the given `Platform.OS`. */
export function headingAlphaForPlatform(os: string): number {
  return os === 'android' ? ANDROID_HEADING_ALPHA : DEFAULT_HEADING_ALPHA;
}
