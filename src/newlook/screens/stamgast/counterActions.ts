import { create } from 'zustand';

import { countDrink, isRapidDrink, type CountPlace, type CountableDrink } from '@/counter/countDrink';
import type { CommunityBeer } from '@/data/communityHours';
import { normalizeDrinkType } from '@/drinks/drinkTypes';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { sessionCount, useTallyStore } from '@/stores/tallyStore';
import { fireRigidImpactHaptic } from '@/utils/haptics';

import { dialog, toast } from '../../ui/store';
import { hasBeerBefore } from './eveningData';

/** The counter's one-off nudges; drinks logged from other sheets set them too. */
interface CounterNudges {
  /** Session whose 3rd beer offers the story sticker. */
  stickerFor: string | null;
  tourBanner: { stopId: string; index: number; beers: number } | null;
  newBeer: { name: string; pubName: string } | null;
  set: (patch: Partial<Omit<CounterNudges, 'set'>>) => void;
}

export const useCounterNudges = create<CounterNudges>((set) => ({
  stickerFor: null,
  tourBanner: null,
  newBeer: null,
  set: (patch) => set(patch),
}));

function lastAlcoholAt(): string | undefined {
  const drinks = useTallyStore.getState().current?.drinks ?? [];
  for (let i = drinks.length - 1; i >= 0; i--) {
    if (normalizeDrinkType(drinks[i].drinkType) !== 'soft_drink') return drinks[i].at;
  }
  return undefined;
}

function minutesAgo(at: string | undefined): number {
  return at ? Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000)) : 0;
}

function record(place: CountPlace, beer: CountableDrink, menu?: readonly CommunityBeer[]): void {
  const result = countDrink(place, beer, { menu });
  const settings = useSettingsStore.getState();
  if (settings.hapticEnabled) fireRigidImpactHaptic();
  if ((beer.drinkType ?? 'beer') !== 'beer' || !result.session) return;

  const state = useTallyStore.getState();
  const live = sessionCount(result.session);
  const all = state.current ? [state.current, ...state.history] : state.history;
  const patch: Partial<CounterNudges> = {};
  if (live === 3) patch.stickerFor = result.session.clientId;
  if (result.tourStop) patch.tourBanner = { stopId: result.tourStop.stop.id, index: result.tourStop.number - 1, beers: live };
  if (!hasBeerBefore(all, beer.name, result.id)) {
    patch.newBeer = { name: beer.name, pubName: result.session.pubName };
  }
  useCounterNudges.getState().set(patch);
  if (settings.waterNudgeEnabled && live > 0 && live % 4 === 0) {
    toast({ kind: 'info', title: t.counter.waterNudge(live), icon: 'beer' });
  }
}

/**
 * The only count path of the new look. A tap that lands suspiciously soon
 * after the last drink writes nothing until the drinker confirms it.
 */
export function logDrink(place: CountPlace, beer: CountableDrink, menu?: readonly CommunityBeer[]): void {
  const at = lastAlcoholAt();
  if (beer.drinkType === 'soft_drink' || !isRapidDrink(at)) {
    record(place, beer, menu);
    return;
  }
  const minutes = minutesAgo(at);
  dialog({
    title: t.nv.stamgast.rapidAgain(minutes),
    actions: [
      { label: t.counter.cancel, kind: 'raised' },
      { label: t.counter.rapidInlineConfirm, kind: 'primary', onPress: () => record(place, beer, menu) },
    ],
  });
}
