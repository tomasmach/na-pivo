/**
 * Tap on a "watched beer is on tap nearby" push: opens the pub page, both while
 * the app runs and from a cold start, once per notification.
 */

import type * as ExpoNotifications from 'expo-notifications';

type NotificationsModule = typeof ExpoNotifications;
type NotificationResponse = ExpoNotifications.NotificationResponse;
type Subscription = ExpoNotifications.Subscription;

function loadNotifications(): NotificationsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

const Notifications = loadNotifications();

export interface BeerOnTapPub {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

/** The pub a beer_on_tap push points at; anything else (or a malformed payload) is not ours. */
export function beerOnTapPub(response: NotificationResponse | null): BeerOnTapPub | null {
  const data = response?.notification.request.content.data;
  if (data?.kind !== 'beer_on_tap') return null;
  const { key, name, lat, lng } = data as Record<string, unknown>;
  const latNum = typeof lat === 'string' ? Number(lat) : lat;
  const lngNum = typeof lng === 'string' ? Number(lng) : lng;
  if (typeof key !== 'string' || !/^[0-9a-z]{1,12}$/.test(key)) return null;
  if (typeof latNum !== 'number' || !Number.isFinite(latNum) || Math.abs(latNum) > 90) return null;
  if (typeof lngNum !== 'number' || !Number.isFinite(lngNum) || Math.abs(lngNum) > 180) return null;
  return { key, name: typeof name === 'string' ? name : '', lat: latNum, lng: lngNum };
}

// A launch tap can surface through both the cold-start read and the live event.
const handledTaps = new Set<string>();
function claimTap(response: NotificationResponse): boolean {
  const id = response.notification.request.identifier;
  if (handledTaps.has(id)) return false;
  if (handledTaps.size >= 32) handledTaps.clear();
  handledTaps.add(id);
  return true;
}

export function subscribeBeerOnTapTap(onTap: (pub: BeerOnTapPub) => void): Subscription {
  if (!Notifications) return { remove: () => undefined };
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const pub = beerOnTapPub(response);
    if (pub && claimTap(response)) onTap(pub);
  });
}

export async function consumeInitialBeerOnTapTap(onTap: (pub: BeerOnTapPub) => void): Promise<void> {
  if (!Notifications) return;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const pub = beerOnTapPub(response);
    if (!pub || !response) return;
    await Notifications.clearLastNotificationResponseAsync();
    if (claimTap(response)) onTap(pub);
  } catch {
    // No launch notification, or the API is unavailable.
  }
}

/** True only after the user said no; "not asked yet" is not denied, the first watch asks. Never prompts. */
export async function notificationsDenied(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    return (await Notifications.getPermissionsAsync()).status === 'denied';
  } catch {
    return false;
  }
}
