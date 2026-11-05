import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

import {
  clearActivityResponse,
  endFriendPubActivity,
  respondToActivity,
  type ActivityResponseKind,
  type FriendProfile,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { pingFriend, type PartaPlan } from '@/data/partaPlansClient';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildNavigationUrl } from '@/utils/maps';

import { dialog, toast } from '../../ui/store';
import { personName, planTime, planTitle } from './partaModel';
import { usePartaStore } from './partaStore';

const EVENING_HOURS = 4;

/** Route to the plan's place: coordinates when known, else the typed address. */
export function navigationUrl(plan: PartaPlan): string | null {
  const provider = useSettingsStore.getState().navigationProvider;
  if (plan.lat != null && plan.lng != null) return buildNavigationUrl({ lat: plan.lat, lng: plan.lng }, provider);
  const query = plan.address.trim();
  if (!query) return null;
  if (provider === 'mapy') return `https://mapy.com/fnc/v1/search?${new URLSearchParams({ query }).toString()}`;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: query }).toString()}`;
}

export async function openNavigation(plan: PartaPlan): Promise<boolean> {
  const url = navigationUrl(plan);
  if (!url) return false;
  await Linking.openURL(url);
  return true;
}

/**
 * Opens the system "new event" form prefilled with the plan, so nothing is
 * written without the user confirming it. iOS 17+ and Android need no calendar
 * permission for that form; older iOS asks once. Native module: needs a new build.
 */
export async function addPlanToCalendar(plan: PartaPlan): Promise<'saved' | 'closed' | 'failed'> {
  try {
    const Calendar = await import('expo-calendar/legacy');
    const start = new Date(planTime(plan));
    const event = {
      title: planTitle(plan),
      startDate: start,
      endDate: new Date(start.getTime() + EVENING_HOURS * 60 * 60 * 1000),
      location: plan.address || plan.name,
      notes: plan.message || undefined,
    };
    let result;
    try {
      result = await Calendar.createEventInCalendarAsync(event);
    } catch (error) {
      if (Platform.OS !== 'ios') throw error;
      const permission = await Calendar.requestCalendarPermissionsAsync();
      if (!permission.granted) return 'failed';
      result = await Calendar.createEventInCalendarAsync(event);
    }
    // Android only ever reports "done"; iOS tells a save from a close.
    return result.action === 'saved' ? 'saved' : 'closed';
  } catch {
    return 'failed';
  }
}

/** RSVP with the old app's offline contract: optimistic, queued when there is no signal. */
export async function respondToPlan(plan: PartaPlan, response: ActivityResponseKind | null): Promise<boolean> {
  const store = usePartaStore.getState();
  const previous = plan.myResponse;
  store.setMyResponse(plan.id, response);
  const result = response ? await respondToActivity(plan.id, response) : await clearActivityResponse(plan.id);
  if (result.ok) return true;
  if (isRetriableFriendError(result)) {
    await enqueueFriendOp(response ? { op: 'rsvp', activityId: plan.id, response } : { op: 'rsvp-clear', activityId: plan.id });
    return true;
  }
  store.setMyResponse(plan.id, previous);
  toast({ kind: 'error', title: result.detail, icon: 'circle-alert' });
  return false;
}

/** Direct cinknutí. Resolves to whether it went out. */
export async function pingPerson(profile: FriendProfile): Promise<boolean> {
  const result = await pingFriend(profile.id);
  if (result.ok) {
    toast({ kind: 'saved', title: t.nv.parta.pingedToast, sub: t.nv.parta.pingedSub(personName(profile)), icon: 'beer' });
    return true;
  }
  toast({ kind: 'error', title: result.code === 'network' || result.code === 'offline' ? t.clientErrors.offline : result.detail, icon: 'circle-alert' });
  return false;
}

/** Ends my own pub ping after a confirm; without signal the end waits in the friends queue. */
export function endPing(plan: PartaPlan, onEnded?: () => void): void {
  dialog({
    title: t.nv.parta.endPingTitle,
    body: t.nv.parta.endPingBody,
    actions: [
      { label: t.nv.parta.back },
      {
        label: t.nv.parta.endPingConfirm,
        kind: 'danger',
        onPress: () =>
          void endFriendPubActivity(plan.id).then(async (result) => {
            if (!result.ok && !isRetriableFriendError(result)) {
              toast({ kind: 'error', title: result.detail, icon: 'circle-alert' });
              return;
            }
            if (!result.ok) await enqueueFriendOp({ op: 'end', clientId: plan.id, activityId: plan.id });
            usePartaStore.getState().removePlan(plan.id);
            toast(result.ok ? { kind: 'info', title: t.nv.parta.pingEnded, icon: 'beer' } : { kind: 'offline', title: t.nv.parta.pingEndQueued, icon: 'cloud-off' });
            onEnded?.();
          }),
      },
    ],
  });
}
