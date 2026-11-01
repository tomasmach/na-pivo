import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { fetchPlanDetail, type HomeEveningState } from '@/data/partaPlansClient';
import { enqueueFriendOp } from '@/data/friendsQueue';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';

import { Icon } from '../../components/Icon';
import { Stack, T } from '../../components/ui';
import { C, s } from '../../theme';
import { clock, joinNames, personInitial } from './partaModel';
import { useHomeEveningStore, type HomeEvening } from './partaStore';

const REFRESH_MS = 60_000;

/**
 * The friend's home I said I am at, or null. Štamgast uses it for the place
 * pill ("U Kláry doma") and logs drinks there with `placeContext: 'private'`.
 */
export function useFriendHomeEvening(): HomeEvening | null {
  return useHomeEveningStore((st) => st.evening);
}

/** Leaving the friend's home: works offline, the queue tells the server later. */
export function leaveFriendHome(): void {
  const evening = useHomeEveningStore.getState().evening;
  if (!evening) return;
  useHomeEveningStore.getState().setEvening(null);
  void enqueueFriendOp({ op: 'home-leave', activityId: evening.activityId });
}

/** "Večer u Kláry": who is here and who is coming. Renders nothing outside one. */
export function FriendEveningCard() {
  const evening = useFriendHomeEvening();
  const myId = useAccountStore((st) => st.profile?.id);
  const [state, setState] = useState<HomeEveningState | null>(null);

  useEffect(() => {
    if (!evening) return;
    let alive = true;
    const refresh = () =>
      void fetchPlanDetail(evening.activityId).then((detail) => {
        if (!alive) return;
        // The evening ended or is not mine to see any more.
        if (detail === 'gone') useHomeEveningStore.getState().setEvening(null);
        else if (detail?.home) setState(detail.home);
      });
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [evening]);

  if (!evening) return null;
  const present = state?.present ?? [];
  const company = present.filter((p) => p.id !== myId);
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="house" size={18} color={C.yellow} />
        <T s={17} w={700} style={s.fill}>
          {t.nv.parta.eveningAt(evening.hostName)}
        </T>
        <T s={13} w={600} c={C.muted}>
          {t.nv.parta.since(clock(evening.startedAt))}
        </T>
      </View>
      {state ? (
        <View style={[s.row, { gap: 12 }]}>
          <Stack initials={present.slice(0, 4).map(personInitial)} />
          <T s={14} c={C.text2} style={s.fill}>
            {[company.length ? t.nv.parta.hereWith(joinNames(company)) : t.nv.parta.nobodyElse, state.coming.length ? t.nv.parta.coming(joinNames(state.coming)) : '']
              .filter(Boolean)
              .join(' ')}
          </T>
        </View>
      ) : null}
      <View style={[s.row, { gap: 8, borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }]}>
        <Icon name="lock" size={13} color={C.muted} />
        <T s={12} c={C.muted}>
          {t.nv.parta.homeLock}
        </T>
      </View>
    </View>
  );
}
