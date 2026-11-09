import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import { fetchFriendsLive } from '@/data/friendsClient';
import { trackUiInteraction, type UiInteractionTarget } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { buildLivePubs } from '@/map/mapModel';
import { useSettingsStore } from '@/stores/settingsStore';

import { Sheet } from '../../components/overlays';
import { Icon, type IconName } from '../../components/Icon';
import { Card, Press, Row, T, Toggle } from '../../components/ui';
import { C, s, shadow } from '../../theme';
import { useKompasState, type MapView } from './state';

const VIEWS: { key: MapView; label: () => string; icon: IconName }[] = [
  { key: 'okoli', label: () => t.nv.kompas.viewNearby, icon: 'map-pin' },
  { key: 'stopy', label: () => t.nv.kompas.viewTraces, icon: 'footprints' },
  { key: 'parta', label: () => t.nv.kompas.viewParty, icon: 'users' },
];

/** How many friends sit at a pub right now, or null before the answer comes. */
function useLiveFriendCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchFriendsLive(controller.signal).then((live) => {
      if (controller.signal.aborted || !live) return;
      const people = new Set(buildLivePubs(live.activeFriends).flatMap((pub) => pub.activities.map((a) => a.account.id)));
      setCount(people.size);
    });
    return () => controller.abort();
  }, []);
  return count;
}

const LAYER_TARGETS: Record<MapView, UiInteractionTarget> = {
  okoli: 'map_layer_all',
  stopy: 'map_layer_visited',
  parta: 'map_layer_friends',
};

export function VrstvySheet() {
  const L = t.nv.kompas;
  const st = useKompasState();
  const showPubBeers = useSettingsStore((s) => s.showPubBeers);
  const setShowPubBeers = useSettingsStore((s) => s.setShowPubBeers);
  const live = useLiveFriendCount();
  return (
    <Sheet title={L.layersTitle} scroll={false}>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          {L.viewGroup}
        </T>
        <View style={[s.row, { gap: 8 }]}>
          {VIEWS.map((v) => {
            const on = st.mapView === v.key;
            return (
              <Press
                key={v.key}
                haptic
                onPress={() => {
                  if (!on) trackUiInteraction(LAYER_TARGETS[v.key], 'select');
                  st.set({ mapView: v.key });
                }}
                accessibilityState={{ selected: on }}
                style={{
                  flex: 1,
                  height: 92,
                  padding: 14,
                  borderRadius: 20,
                  justifyContent: 'space-between',
                  backgroundColor: on ? C.yellowTint : C.card,
                  borderWidth: 1,
                  borderColor: on ? C.yellowLine : C.hairline,
                }}
              >
                <Icon name={v.icon} size={22} color={on ? C.yellow : C.white} />
                <T s={15} w={700} c={on ? C.yellow : C.white}>
                  {v.label()}
                </T>
                {v.key === 'parta' && live ? (
                  <View style={[{ position: 'absolute', right: 12, top: 12, width: 22, height: 22, borderRadius: 11, backgroundColor: C.yellow }, s.center]}>
                    <T s={12} w={800} c={C.black}>
                      {live}
                    </T>
                  </View>
                ) : null}
              </Press>
            );
          })}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          {L.pinsGroup}
        </T>
        <Card>
          <Row title={L.pinCount} trailing={<Toggle value={showPubBeers} onChange={setShowPubBeers} />} />
          <Row last title={L.onlyDrunk} trailing={<Toggle value={st.onlyDrunk} onChange={(v) => st.set({ onlyDrunk: v })} />} />
        </Card>
      </View>
    </Sheet>
  );
}
