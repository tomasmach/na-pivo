import React from 'react';
import { View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TOUR, nextStopIndex } from '../mock/tour';
import { useMock } from '../mock/store';
import { C, TAB_BAR_HEIGHT, s } from '../theme';
import { Glass, tabBarBottom } from './chrome';
import { Icon, type IconName } from './Icon';
import { D, Press, T } from './ui';

const SIDE: Record<string, { label: string; icon: IconName }> = {
  kompas: { label: 'Kompas', icon: 'compass' },
  vycep: { label: 'Výčep', icon: 'hop' },
  piva: { label: 'Piva', icon: 'star' },
  parta: { label: 'Parta', icon: 'users' },
};

/** Two glass pills with the Štamgast circle between them. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route && current !== name) navigateToTab(route.key);
  };

  const tab = (name: string) => {
    const t = SIDE[name];
    const on = current === name;
    return (
      <Press
        key={name}
        haptic
        onPress={() => go(name)}
        accessibilityRole="tab"
        accessibilityLabel={t.label}
        accessibilityState={{ selected: on }}
        style={[s.fill, s.center, { borderRadius: 27, gap: 3, alignSelf: 'stretch' }, on && { backgroundColor: '#FFFFFF24' }]}
      >
        <Icon name={t.icon} size={21} color={on ? C.yellow : C.glassText} />
        <T s={10} w={700} c={on ? C.yellow : C.glassText}>
          {t.label}
        </T>
      </Press>
    );
  };

  const stamgastOn = current === 'stamgast';
  const bottom = tabBarBottom(insets.bottom);

  return (
    <>
      {current !== 'stamgast' && current !== 'kompas' ? (
        <TourStrip
          bottom={bottom + TAB_BAR_HEIGHT + 8}
          onOpen={() => {
            useMock.getState().set({ stamgastMode: 'tour' });
            go('stamgast');
          }}
        />
      ) : null}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 16, right: 16, bottom, height: TAB_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Glass style={[s.fill, s.row, { height: TAB_BAR_HEIGHT, borderRadius: 32, padding: 5 }]}>
          {tab('kompas')}
          {tab('vycep')}
        </Glass>
        <Press haptic onPress={() => go('stamgast')} accessibilityRole="tab" accessibilityLabel="Štamgast" accessibilityState={{ selected: stamgastOn }}>
          {stamgastOn ? (
            <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.yellow }, s.center]}>
              <Icon name="beer" size={28} color={C.black} />
            </View>
          ) : (
            <Glass style={[{ width: 64, height: 64, borderRadius: 32 }, s.center]}>
              <Icon name="beer" size={28} color={C.yellow} />
            </Glass>
          )}
        </Press>
        <Glass style={[s.fill, s.row, { height: TAB_BAR_HEIGHT, borderRadius: 32, padding: 5 }]}>
          {tab('piva')}
          {tab('parta')}
        </Glass>
      </View>
    </>
  );
}

/** During a tour every other tab shows the next stop above the tab bar. */
function TourStrip({ bottom, onOpen }: { bottom: number; onOpen: () => void }) {
  const active = useMock((st) => st.tourActive);
  const stops = useMock((st) => st.tourStops);
  if (!active) return null;
  const i = nextStopIndex(stops);
  if (i < 0) return null;
  const done = stops.filter((x) => x !== 'todo').length;
  return (
    <View style={{ position: 'absolute', left: 16, right: 16, bottom }}>
      <Press haptic onPress={onOpen}>
        <Glass style={[s.row, { height: 56, borderRadius: 22, paddingHorizontal: 10, gap: 12 }]} tint="#151515E6">
          <View style={[{ width: 34, height: 34, borderRadius: 10, borderWidth: 1.5, borderColor: C.yellow }, s.center]}>
            <D s={18} c={C.yellow}>
              {String(i + 1)}
            </D>
          </View>
          <View style={[s.fill, { gap: 1 }]}>
            <T s={15} w={700}>{`Další ${TOUR.stops[i].name}`}</T>
            <T s={12} c={C.muted}>{`${TOUR.name} · ${done} z ${TOUR.stops.length} za vámi · ${TOUR.stops[i].walkShort}`}</T>
          </View>
          <Icon name="chevron-right" size={16} color={C.muted} />
        </Glass>
      </Press>
    </View>
  );
}
