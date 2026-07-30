/**
 * Hand-rolled bottom tab bar — matches the stout/amber pub theme instead of the
 * default react-navigation look. Four items (Kompas / Štamgast / Parta / Profil),
 * each an IconGlyph + Baloo2 label. Active = amber with a subtle glow; inactive =
 * muted. A light haptic fires on press when the user has haptics enabled.
 *
 * The Parta item carries an amber signal badge fed by `usePartaSignalStore`
 * (Parta 3.0 §D1): a numeric pill when friend requests wait, else an ambient dot
 * when the feed has unread items or a friend is live now. The dot is static:
 * this bar sits on every screen, so any looping motion here would be ambient
 * animation across the whole app (§10), and the active tab carries no glow —
 * the one glow on a screen belongs to its one amber button (§6.1).
 *
 * Driven by expo-router's <Tabs> via `tabBar={(props) => <TabBar {...props} />}`.
 */

import React, { memo, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { CompassIcon, BeerIcon, UserIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePartaSignalStore } from '@/stores/partaSignalStore';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { cs } from '@/i18n/cs';
import { trackUiInteraction, type UiInteractionTarget } from '@/data/uxTelemetry';

/**
 * The narrow slice of expo-router's bottom-tab `tabBar` callback props this
 * component actually reads. Declared locally because the full `BottomTabBarProps`
 * lives in the vendored react-navigation types that aren't resolvable as a
 * standalone package — and we only need `state` + `navigation`.
 */
interface TabBarRoute {
  key: string;
  name: string;
}
interface TabBarNavigation {
  emit: (event: {
    type: 'tabPress';
    target: string;
    canPreventDefault: true;
  }) => { defaultPrevented: boolean };
  navigate: (name: string) => void;
}
export interface TabBarProps {
  state: { index: number; routes: TabBarRoute[] };
  navigation: TabBarNavigation;
}

/** Maps a route name to its icon + label + a11y label. */
const TAB_META: Record<
  string,
  {
    Icon: typeof CompassIcon;
    label: string;
    a11yLabel: string;
    telemetryTarget: UiInteractionTarget;
  }
> = {
  index: {
    Icon: CompassIcon,
    label: cs.tabs.compass,
    a11yLabel: cs.a11y.tabCompass,
    telemetryTarget: 'tab_compass',
  },
  beer: {
    Icon: BeerIcon,
    label: cs.tabs.beer,
    a11yLabel: cs.a11y.tabBeer,
    telemetryTarget: 'tab_beer',
  },
  friends: {
    Icon: UsersIcon,
    label: cs.tabs.friends,
    a11yLabel: cs.a11y.tabFriends,
    telemetryTarget: 'tab_friends',
  },
  profile: {
    Icon: UserIcon,
    label: cs.tabs.profile,
    a11yLabel: cs.a11y.tabProfile,
    telemetryTarget: 'tab_profile',
  },
};

/** What the Parta item's badge should render, if anything. */
interface TabBadgeState {
  /** Numeric pill (pending requests, capped "9+") — highest intent. */
  count: number;
  /** Ambient dot (unread feed or a friend live now) when no numeric pill. */
  dot: boolean;
  /** A friend is live now. Kept for callers; the dot no longer animates. */
  live: boolean;
}

/**
 * The amber signal badge on the Parta item. A numeric pill wins over the ambient
 * dot; the dot only breathes while a friend is live (reduce-motion → static).
 * Both fade+scale in on appear.
 */
const TabBadge = memo(function TabBadge({ count, dot, live }: TabBadgeState) {
  const reduceMotion = useReduceMotion();
  const appear = useSharedValue(0);

  useEffect(() => {
    appear.value = reduceMotion
      ? withTiming(1, { duration: 0 })
      : withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
    return () => cancelAnimation(appear);
  }, [appear, reduceMotion]);

  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ scale: 0.6 + 0.4 * appear.value }],
  }));

  if (count > 0) {
    return (
      <Animated.View style={[styles.badgePill, appearStyle]} pointerEvents="none">
        <Text style={styles.badgeCount} allowFontScaling={false}>
          {count > 9 ? '9+' : String(count)}
        </Text>
      </Animated.View>
    );
  }
  if (!dot) return null;
  return (
    <Animated.View style={[styles.badgeDotWrap, appearStyle]} pointerEvents="none">
      {/* Static, never breathing: this badge rides the tab bar, so a looping
          dot would put permanent ambient motion on every rebuilt screen (§10).
          A dot versus a numbered pill is already signal enough. */}
      <View style={styles.badgeDotStatic} />
    </Animated.View>
  );
});

interface TabItemProps {
  routeKey: string;
  routeName: string;
  focused: boolean;
  onPress: () => void;
  badge: TabBadgeState | null;
}

const TabItem = memo(function TabItem({ routeName, focused, onPress, badge }: TabItemProps) {
  const meta = TAB_META[routeName];
  if (!meta) return null;
  const color = focused ? Colors.amber : Colors.mutedText;
  const { Icon } = meta;

  // Fold the badge count into the tab's own a11y label so VoiceOver announces
  // "Parta, N nových" instead of leaving the badge silent.
  const accessibilityLabel =
    badge && badge.count > 0 ? cs.a11y.tabFriendsBadge(badge.count) : meta.a11yLabel;

  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
    >
      {/* No glow here. The tab bar is on every screen, so a lit active icon
          would be a second permanent glow next to each screen's one amber
          button (§6.1). Amber on the icon and the label already says "active". */}
      <View style={styles.iconWrap}>
        <Icon size={24} color={color} />
        {badge ? <TabBadge count={badge.count} dot={badge.dot} live={badge.live} /> : null}
      </View>
      <Text
        style={[styles.label, { color }]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {meta.label}
      </Text>
    </Pressable>
  );
});

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const pendingRequests = usePartaSignalStore((s) => s.pendingRequests);
  const unread = usePartaSignalStore((s) => s.unread);
  const liveNow = usePartaSignalStore((s) => s.liveNow);

  const partaBadge: TabBadgeState | null =
    pendingRequests > 0
      ? { count: pendingRequests, dot: false, live: liveNow }
      : unread > 0 || liveNow
        ? { count: 0, dot: true, live: liveNow }
        : null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;

        const onPress = () => {
          const meta = TAB_META[route.name];
          if (meta) trackUiInteraction(meta.telemetryTarget, 'select');
          if (hapticEnabled) {
            fireLightImpactHaptic();
          }
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TabItem
            key={route.key}
            routeKey={route.key}
            routeName={route.name}
            focused={focused}
            onPress={onPress}
            badge={route.name === 'friends' ? partaBadge : null}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.stout2,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: HitArea.min,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    letterSpacing: 0.2,
  },
  // — Parta signal badge —
  badgePill: {
    position: 'absolute',
    top: -6,
    right: -12,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: Colors.stout2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: {
    fontFamily: Fonts.display.bold,
    fontSize: 11,
    lineHeight: 13,
    color: Colors.stout,
    includeFontPadding: false,
  },
  badgeDotWrap: {
    position: 'absolute',
    top: -3,
    right: -5,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.stout2,
  },
  badgeDotStatic: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: Colors.amber,
  },
});
