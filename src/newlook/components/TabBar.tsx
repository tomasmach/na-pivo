import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { trackUiInteraction, type UiInteractionTarget } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { useActiveTourRun } from '@/tours/activeRun';
import { runGlance } from '@/tours/glance';

import { enterTiming, fadeInTiming, fadeOutTiming } from '../motion';
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

// Výčep and Piva had no tab before the new look, so they send nothing.
const TAB_TELEMETRY_TARGETS: Record<string, UiInteractionTarget> = {
  kompas: 'tab_compass',
  stamgast: 'tab_beer',
  parta: 'tab_friends',
};

/** Two glass pills with the Štamgast circle between them. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;

  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route && current !== name) navigateToTab(route.key);
  };

  const press = (name: string) => {
    const target = TAB_TELEMETRY_TARGETS[name];
    if (target && current !== name) trackUiInteraction(target, 'select');
    go(name);
  };

  const tab = (name: string) => {
    const side = SIDE[name];
    const label = side.label();
    const on = current === name;
    return (
      <Press
        key={name}
        haptic
        onPress={() => press(name)}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: on }}
        style={[s.fill, s.center, { borderRadius: 27, gap: 3, alignSelf: 'stretch' }]}
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
          <Pill slot={slotIn(['kompas', 'vycep'], current)}>
            {tab('kompas')}
            {tab('vycep')}
          </Pill>
        </Glass>
        <Press haptic onPress={() => press('stamgast')} accessibilityRole="tab" accessibilityLabel={t.nv.common.tabStamgast} accessibilityState={{ selected: stamgastOn }}>
          <Glass style={[{ width: 64, height: 64, borderRadius: 32 }, s.center]}>
            <Icon name="beer" size={28} color={C.yellow} />
          </Glass>
          <FadeLayer on={stamgastOn} style={[StyleSheet.absoluteFill, s.center, { borderRadius: 32, backgroundColor: C.yellow }]}>
            <Icon name="beer" size={28} color={C.black} />
          </FadeLayer>
        </Press>
        <Glass style={[s.fill, s.row, { height: TAB_BAR_HEIGHT, borderRadius: 32, padding: 5 }]}>
          <Pill slot={slotIn(['piva', 'parta'], current)}>
            {tab('piva')}
            {tab('parta')}
          </Pill>
        </Glass>
      </View>
    </>
  );
}

const slotIn = (names: string[], current: string | undefined) => {
  const i = current ? names.indexOf(current) : -1;
  return i < 0 ? null : i;
};

/**
 * Two tabs over a highlight that slides to the selected one. A selection
 * coming from the other side of the bar fades in on its tab instead.
 */
function Pill({ slot, children }: { slot: number | null; children: React.ReactNode }) {
  const half = useSharedValue(0);
  const x = useSharedValue(slot ?? 0);
  const shown = useSharedValue(slot === null ? 0 : 1);
  const prev = useRef(slot);

  useEffect(() => {
    const was = prev.current;
    prev.current = slot;
    if (slot === was) return;
    if (slot === null) {
      shown.value = withTiming(0, fadeOutTiming());
      return;
    }
    // A highlight still fading out from a quick tap away slides back instead of jumping.
    x.value = was === null && shown.value < 0.05 ? slot : withTiming(slot, enterTiming());
    shown.value = withTiming(1, fadeInTiming());
  }, [slot, shown, x]);

  const highlight = useAnimatedStyle(() => ({
    // Hidden until the pill is measured, so a cold start on the second tab does not flash it on the first.
    opacity: half.value ? shown.value : 0,
    transform: [{ translateX: x.value * half.value }],
  }));

  return (
    <View style={[s.fill, s.row, { alignSelf: 'stretch' }]} onLayout={(e) => (half.value = e.nativeEvent.layout.width / 2)}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, width: '50%', borderRadius: 27, backgroundColor: C.ring }, highlight]} />
      {children}
    </View>
  );
}

function FadeLayer({ on, style, children }: { on: boolean; style: React.ComponentProps<typeof View>['style']; children: React.ReactNode }) {
  const shown = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(on ? 1 : 0, on ? fadeInTiming() : fadeOutTiming());
  }, [on, shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View pointerEvents="none" style={[style, fade]}>
      {children}
    </Animated.View>
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
