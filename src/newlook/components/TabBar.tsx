import React from 'react';
import { View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { useActiveTourRun } from '@/tours/activeRun';
import { runGlance } from '@/tours/glance';

import { useTourSegment } from '../screens/tour/tourSegment';
import { C, TAB_BAR_HEIGHT, s } from '../theme';
import { Glass, tabBarBottom } from './chrome';
import { Icon, type IconName } from './Icon';
import { D, Press, T } from './ui';

const SIDE: Record<string, { label: () => string; icon: IconName }> = {
  kompas: { label: () => t.nv.common.tabKompas, icon: 'compass' },
  vycep: { label: () => t.nv.common.tabVycep, icon: 'hop' },
  piva: { label: () => t.nv.common.tabPiva, icon: 'star' },
  parta: { label: () => t.nv.common.tabParta, icon: 'users' },
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
    const side = SIDE[name];
    const label = side.label();
    const on = current === name;
    return (
      <Press
        key={name}
        haptic
        onPress={() => go(name)}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        style={[s.fill, s.center, { borderRadius: 27, gap: 3, alignSelf: 'stretch' }, on && { backgroundColor: C.ring }]}
      >
        <Icon name={side.icon} size={21} color={on ? C.yellow : C.glassText} />
        <T s={10} w={700} c={on ? C.yellow : C.glassText}>
          {label}
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
            useTourSegment.getState().open();
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
        <Press haptic onPress={() => go('stamgast')} accessibilityRole="tab" accessibilityLabel={t.nv.common.tabStamgast} accessibilityState={{ selected: stamgastOn }}>
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
  const run = useActiveTourRun();
  // A run forgotten for half a day stops following the walker around.
  const glance = runGlance(run);
  if (!run || !glance?.next) return null;
  const i = run.snapshot.stops.indexOf(glance.next);
  const done = Object.keys(run.statuses).length;
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
            <T s={15} w={700} numberOfLines={1}>
              {t.nv.tour.stripNext(glance.next.name)}
            </T>
            <T s={12} c={C.muted} numberOfLines={1}>
              {t.nv.tour.stripSub(glance.title, done, glance.total, glance.minutes)}
            </T>
          </View>
          <Icon name="chevron-right" size={16} color={C.muted} />
        </Glass>
      </Press>
    </View>
  );
}
