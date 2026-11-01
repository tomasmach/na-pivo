import React from 'react';
import { View } from 'react-native';

import { Sheet } from '../../components/overlays';
import { Icon, type IconName } from '../../components/Icon';
import { Card, Press, Row, T, Toggle } from '../../components/ui';
import { FRIENDS } from '../../mock/data';
import { useMock } from '../../mock/store';
import { C, s, shadow } from '../../theme';

const VIEWS: { key: 'okoli' | 'stopy' | 'parta'; label: string; icon: IconName }[] = [
  { key: 'okoli', label: 'V okolí', icon: 'map-pin' },
  { key: 'stopy', label: 'Moje stopy', icon: 'footprints' },
  { key: 'parta', label: 'Parta teď', icon: 'users' },
];

export function VrstvySheet() {
  const st = useMock();
  const live = FRIENDS.filter((f) => f.live).length + 1;
  return (
    <Sheet title="Mapa ukazuje" scroll={false}>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          Pohled
        </T>
        <View style={[s.row, { gap: 8 }]}>
          {VIEWS.map((v) => {
            const on = st.mapView === v.key;
            return (
              <Press
                key={v.key}
                haptic
                onPress={() => st.set({ mapView: v.key })}
                accessibilityState={{ selected: on }}
                style={{
                  flex: 1,
                  height: 92,
                  padding: 14,
                  borderRadius: 20,
                  justifyContent: 'space-between',
                  backgroundColor: on ? '#FFC40029' : C.card,
                  borderWidth: 1,
                  borderColor: on ? '#FFC40080' : C.hairline,
                }}
              >
                <Icon name={v.icon} size={22} color={on ? C.yellow : C.white} />
                <T s={15} w={700} c={on ? C.yellow : C.white}>
                  {v.label}
                </T>
                {v.key === 'parta' ? (
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
          Na pinech
        </T>
        <View style={[s.row, { height: 42, borderRadius: 21, padding: 3, backgroundColor: '#FFFFFF12' }]}>
          {(
            [
              ['price', 'Cena piva', 'banknote'],
              ['count', 'Počty piv za týden', 'beer'],
            ] as const
          ).map(([k, label, icon]) => {
            const on = st.pinMode === k;
            return (
              <Press
                key={k}
                haptic
                onPress={() => st.set({ pinMode: k })}
                style={[s.fill, s.row, { justifyContent: 'center', alignSelf: 'stretch', gap: 6, borderRadius: 18 }, on && { backgroundColor: C.white, ...shadow.soft }]}
              >
                <Icon name={icon} size={15} color={on ? C.black : C.text2} />
                <T s={14} w={on ? 800 : 600} c={on ? C.black : C.text2}>
                  {label}
                </T>
              </Press>
            );
          })}
        </View>
        <Card>
          <Row last title="Jen kde se minulý týden pilo" trailing={<Toggle value={st.onlyDrunk} onChange={(v) => st.set({ onlyDrunk: v })} />} />
        </Card>
      </View>
    </Sheet>
  );
}
