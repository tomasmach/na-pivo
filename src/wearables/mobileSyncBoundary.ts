/**
 * Synchronous account-boundary gate shared by auth cleanup and the wearable
 * coordinator. Private-account cleanup starts before AccountStore publishes the
 * replacement session, so checking AccountStore alone leaves a window where an
 * old watch command could repopulate freshly-cleared stores.
 */

export const MOBILE_WEARABLE_SHADOW_STORAGE_KEY =
  'na-pivo-wearable-phone-shadow-v1';
export const MOBILE_WEARABLE_TARGET_STORAGE_KEY =
  'na-pivo-wearable-target-v1';

export interface MobileWearableSyncBoundary {
  generation: number;
  suspended: boolean;
}

let generation = 0;
let suspended = false;
let activeOperations = 0;
const idleWaiters = new Set<() => void>();

/** Stop accepting/acknowledging commands for the outgoing private account. */
export function beginMobileWearableAccountBoundary(): number {
  generation += 1;
  suspended = true;
  return generation;
}

/** Re-enable processing only after AccountStore exposes the replacement account. */
export function resumeMobileWearableAccountBoundary(): number {
  suspended = false;
  return generation;
}

export function getMobileWearableSyncBoundary(): MobileWearableSyncBoundary {
  return { generation, suspended };
}

/**
 * Mark one durable coordinator write as active. Cleanup uses this lease to wait
 * out a command that crossed the synchronous account boundary while it was
 * already persisting a queue fact or its phone shadow.
 */
export function beginMobileWearableSyncOperation(): () => void {
  activeOperations += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    activeOperations = Math.max(0, activeOperations - 1);
    if (activeOperations !== 0) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };
}

/** Resolve after every durable coordinator write currently in flight settles. */
export function waitForMobileWearableSyncIdle(): Promise<void> {
  if (activeOperations === 0) return Promise.resolve();
  return new Promise((resolve) => {
    idleWaiters.add(resolve);
  });
}
