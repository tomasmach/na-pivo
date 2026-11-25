import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { trackUiInteraction, type UiInteractionTarget } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useActiveTourRun } from '@/tours/activeRun';
import { runGlance } from '@/tours/glance';

import { enterTiming, fadeInTiming, fadeOutTiming } from '../motion';
import { useTourSegment } from '../screens/tour/tourSegment';
import { useDetailStore } from '../duo/detailStore';
import { useBook, useRailSide, useWindowInsets } from '../duo/layout';
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

const MAP_SIDE = { label: () => t.nv.common.tabMapa, icon: 'map' as IconName };

/** The standing bar fits the Duo's 84 pt column with 10 pt to spare on each side. */
export const RAIL_WIDTH = 64;
const RAIL_TAB_HEIGHT = 58;
const BAR_MAX_WIDTH = 440;

// Výčep and Piva had no tab before the new look, so they send nothing.
const TAB_TELEMETRY_TARGETS: Record<string, UiInteractionTarget> = {
  kompas: 'tab_compass',
  stamgast: 'tab_beer',
  parta: 'tab_friends',
};

/** Waiting friend requests as a number (9+ from ten), otherwise an empty dot for news or a friend out now. */
export function partaBadge(pendingRequests: number, unread: number, liveNow: boolean): string | null {
  if (pendingRequests > 0) return pendingRequests > 9 ? '9+' : String(pendingRequests);
  return unread > 0 || liveNow ? '' : null;
}

/** Two glass pills with the Štamgast circle between them. */
export function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useWindowInsets();
  const rail = useRailSide();
  const { book, foldX, width } = useBook();
  const current = state.routes[state.index]?.name;
  const pendingRequests = usePartaSignalStore((st) => st.pendingRequests);
  const kompasView = useSettingsStore((st) => st.kompasView);
  const partaBadgeText = usePartaSignalStore((st) => partaBadge(st.pendingRequests, st.unread, st.liveNow));

  const go = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (route && current !== name) navigateToTab(route.key);
  };

  const press = (name: string) => {
    const target = TAB_TELEMETRY_TARGETS[name];
    if (target && current !== name) trackUiInteraction(target, 'select');
    // Tapping the open tab again goes back to its own screen, as iOS does with a navigation stack.
    if (current === name) useDetailStore.getState().popToRoot(name);
    go(name);
  };

  const tab = (name: string, vertical = false) => {
    const side = name === 'kompas' && kompasView === 'map' ? MAP_SIDE : SIDE[name];
    const label = side.label();
    const on = current === name;
    const badge = name === 'parta' ? partaBadgeText : null;
    return (
      <Press
        key={name}
        haptic
        onPress={() => press(name)}
        accessibilityRole="tab"
        accessibilityLabel={name === 'parta' && pendingRequests > 0 ? t.nv.parta.tabBadgeA11y(pendingRequests) : label}
        accessibilityState={{ selected: on }}
        style={[s.fill, s.center, { borderRadius: 27, gap: 3, alignSelf: 'stretch' }, vertical && { paddingHorizontal: 2 }]}
      >
        <View>
          <Icon name={side.icon} size={21} color={on ? C.yellow : C.glassText} />
          {badge === null ? null : <TabBadge text={badge} />}
        </View>
        <T s={10} w={700} c={on ? C.yellow : C.glassText} numberOfLines={1} maxFontSizeMultiplier={1.2}>
          {label}
        </T>
      </Press>
    );
  };

  const stamgastOn = current === 'stamgast';
  const stamgast = (
    <Press haptic onPress={() => press('stamgast')} accessibilityRole="tab" accessibilityLabel={t.nv.common.tabStamgast} accessibilityState={{ selected: stamgastOn }}>
      <Glass style={[{ width: 64, height: 64, borderRadius: 32 }, s.center]}>
        <Icon name="beer" size={28} color={C.yellow} />
      </Glass>
      <FadeLayer on={stamgastOn} style={[StyleSheet.absoluteFill, s.center, { borderRadius: 32, backgroundColor: C.yellow }]}>
        <Icon name="beer" size={28} color={C.black} />
      </FadeLayer>
    </Press>
  );
  const tourStrip = (bottom: number, side: { left: number; right: number }) =>
    current !== 'stamgast' && current !== 'kompas' ? (
      <TourStrip
        bottom={bottom}
        side={side}
        onOpen={() => {
          useTourSegment.getState().open();
          go('stamgast');
        }}
      />
    ) : null;

  if (rail) {
    // The folded or open iPhone Duo: the bar stands in the side column under the clock, like the system's.
    const column = rail === 'right' ? insets.right : insets.left;
    const edge = (column - RAIL_WIDTH) / 2;
    const bottom = tabBarBottom(insets.bottom);
    return (
      <>
        {/* On the open book the strip stays in the left half, off the fold. */}
        {tourStrip(bottom, { left: insets.left + 16, right: book ? width - foldX + 16 : insets.right + 16 })}
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', [rail]: edge, bottom, width: RAIL_WIDTH, alignItems: 'center', gap: 8 }}
        >
          <Glass style={{ width: RAIL_WIDTH, borderRadius: 32, padding: 5 }}>
            <Pill vertical slot={slotIn(['kompas', 'vycep'], current)}>
              {tab('kompas', true)}
              {tab('vycep', true)}
            </Pill>
          </Glass>
          {stamgast}
          <Glass style={{ width: RAIL_WIDTH, borderRadius: 32, padding: 5 }}>
            <Pill vertical slot={slotIn(['piva', 'parta'], current)}>
              {tab('piva', true)}
              {tab('parta', true)}
            </Pill>
          </Glass>
        </View>
      </>
    );
  }

  const bottom = tabBarBottom(insets.bottom);

  return (
    <>
      {tourStrip(bottom + TAB_BAR_HEIGHT + 8, { left: 16, right: 16 })}
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom, alignItems: 'center' }}>
        {/* The open iPhone Duo upright is wide enough to stretch the bar; it keeps a phone's width. */}
        <View pointerEvents="box-none" style={{ width: '100%', maxWidth: BAR_MAX_WIDTH, height: TAB_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Glass style={[s.fill, s.row, { height: TAB_BAR_HEIGHT, borderRadius: 32, padding: 5 }]}>
            <Pill slot={slotIn(['kompas', 'vycep'], current)}>
              {tab('kompas')}
              {tab('vycep')}
            </Pill>
          </Glass>
          {stamgast}
          <Glass style={[s.fill, s.row, { height: TAB_BAR_HEIGHT, borderRadius: 32, padding: 5 }]}>
            <Pill slot={slotIn(['piva', 'parta'], current)}>
              {tab('piva')}
              {tab('parta')}
            </Pill>
          </Glass>
        </View>
      </View>
    </>
  );
}

function TabBadge({ text }: { text: string }) {
  if (!text) {
    return <View testID="tab-parta-dot" style={{ position: 'absolute', top: -1, right: -4, width: 8, height: 8, borderRadius: 4, backgroundColor: C.yellow }} />;
  }
  return (
    <View
      testID="tab-parta-badge"
      style={[{ position: 'absolute', top: -6, left: 13, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: C.yellow }, s.center]}
    >
      <T s={11} w={800} c={C.black} maxFontSizeMultiplier={1.1}>
        {text}
      </T>
    </View>
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
function Pill({ slot, vertical = false, children }: { slot: number | null; vertical?: boolean; children: React.ReactNode }) {
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
    transform: vertical ? [{ translateY: x.value * half.value }] : [{ translateX: x.value * half.value }],
  }));

  return (
    <View
      style={vertical ? { height: RAIL_TAB_HEIGHT * 2, alignSelf: 'stretch' } : [s.fill, s.row, { alignSelf: 'stretch' }]}
      onLayout={(e) => (half.value = (vertical ? e.nativeEvent.layout.height : e.nativeEvent.layout.width) / 2)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          vertical
            ? { position: 'absolute', left: 0, right: 0, height: '50%', borderRadius: 27, backgroundColor: C.ring }
            : { position: 'absolute', top: 0, bottom: 0, width: '50%', borderRadius: 27, backgroundColor: C.ring },
          highlight,
        ]}
      />
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
function TourStrip({ bottom, side, onOpen }: { bottom: number; side: { left: number; right: number }; onOpen: () => void }) {
  const run = useActiveTourRun();
  // A run forgotten for half a day stops following the walker around.
  const glance = runGlance(run);
  if (!run || !glance?.next) return null;
  const i = run.snapshot.stops.indexOf(glance.next);
  const done = Object.keys(run.statuses).length;
  return (
    <View style={{ position: 'absolute', ...side, bottom }}>
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
