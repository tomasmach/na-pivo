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
 *               Default recommended value for compass heading: 0.2.
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

/** Default alpha for compass heading smoothing. */
export const DEFAULT_HEADING_ALPHA = 0.2;
