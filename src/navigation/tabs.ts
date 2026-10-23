import { trackUiInteraction, type UiInteractionTarget } from '@/data/uxTelemetry';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';

const TAB_TELEMETRY_TARGETS: Record<string, UiInteractionTarget> = {
  index: 'tab_compass',
  beer: 'tab_beer',
  friends: 'tab_friends',
  profile: 'tab_profile',
};

/** Every tap on the bar gets the haptic; only a switch to another tab is counted. */
export function handleTabPress(routeName: string, alreadyFocused: boolean): void {
  if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
  if (alreadyFocused) return;
  const target = TAB_TELEMETRY_TARGETS[routeName];
  if (target) trackUiInteraction(target, 'select');
}

/**
 * The Parta badge: pending friend requests as a count (capped "9+"), else an
 * empty badge (a dot) for unread feed items or a friend live now, else none.
 */
export function partaBadge(pendingRequests: number, unread: number, liveNow: boolean): string | null {
  if (pendingRequests > 0) return pendingRequests > 9 ? '9+' : String(pendingRequests);
  return unread > 0 || liveNow ? '' : null;
}
