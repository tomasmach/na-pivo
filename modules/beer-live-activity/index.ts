import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type BeerLiveActivityPayload = {
  /** Stable ID for one evening. A new ID clears a previous user dismissal. */
  sessionId: string;
  pubName: string;
  beerCount: number;
  /** User-facing, already localized value. An empty string hides the total. */
  totalPrice: string;
  /** An empty string falls back to the app name. */
  latestBeerName: string;
  repeatBeerName: string;
  repeatBeerPriceCzk?: number;
  repeatBeerVolumeMl?: number;
  repeatBeerServingType?: string;
};

export type BeerLiveActivityPresentation = 'live-update' | 'notification' | 'none';

export type BeerLiveActivityStatus = {
  active: boolean;
  dismissed: boolean;
  sessionId: string | null;
  notificationsEnabled: boolean;
  /** Android 16+ can render the progress-centric notification style. */
  liveUpdatesSupported: boolean;
  /** The OS and user settings currently allow promoted ongoing notifications. */
  liveUpdatesAllowed: boolean;
  /** Actual presentation of the currently posted notification. */
  presentation: BeerLiveActivityPresentation;
};

export type BeerLiveActivityPendingAdd = {
  id: string;
  sessionId: string;
  createdAt: number;
  beerName?: string;
  priceCzk?: number;
  volumeMl?: number;
  servingType?: string;
};

type BeerLiveActivityNativeModule = {
  startOrUpdate?(payload: BeerLiveActivityPayload): Promise<BeerLiveActivityStatus>;
  end?(): Promise<BeerLiveActivityStatus>;
  getStatus?(): Promise<BeerLiveActivityStatus>;
  getPendingAdds?(): Promise<BeerLiveActivityPendingAdd[]>;
  ackPendingAdds?(ids: string[]): Promise<void>;
};

const nativeModule =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? requireOptionalNativeModule<BeerLiveActivityNativeModule>('BeerLiveActivity')
    : null;

const unsupportedStatus: BeerLiveActivityStatus = {
  active: false,
  dismissed: false,
  sessionId: null,
  notificationsEnabled: false,
  liveUpdatesSupported: false,
  liveUpdatesAllowed: false,
  presentation: 'none',
};

/** Starts the Android notification or updates the existing evening in place. */
export async function startOrUpdate(
  payload: BeerLiveActivityPayload,
): Promise<BeerLiveActivityStatus> {
  return nativeModule?.startOrUpdate?.(payload) ?? unsupportedStatus;
}

/** Removes the Android notification and clears its native session state. */
export async function end(): Promise<BeerLiveActivityStatus> {
  return nativeModule?.end?.() ?? unsupportedStatus;
}

/** Reads the notification's real system state, including promotion and dismissal. */
export async function getStatus(): Promise<BeerLiveActivityStatus> {
  return nativeModule?.getStatus?.() ?? unsupportedStatus;
}

/** Returns unacknowledged `+ pivo` taps without deleting them. */
export async function getPendingAdds(): Promise<BeerLiveActivityPendingAdd[]> {
  return nativeModule?.getPendingAdds?.() ?? [];
}

/** Removes only events that JS has already committed to the tally and queue. */
export async function ackPendingAdds(ids: string[]): Promise<void> {
  await nativeModule?.ackPendingAdds?.(ids);
}
