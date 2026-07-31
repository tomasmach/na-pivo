/**
 * Hand-rolled bottom tab bar — the stout/amber pub theme, not the default
 * react-navigation look. Five items (Feed / Hospody / Party / Community /
 * Profil), each an IconGlyph + Baloo2 label.
 *
 * The five labels sit on the FOUR original routes plus `community`; the routes
 * themselves were deliberately not renamed. `napivo://beer` is the Live Activity
 * deep link running on people's lock screens, and `/beer` / `/friends` are still
 * named in telemetry, `appReviewPolicy` and a dozen `router.replace` calls. The
 * bar's copy moved; the URLs did not.
 *
 * Party is the centre and inverted: a filled amber disc with a stout glyph on
 * it, amber whether or not it is focused. That is a deliberate exception to
 * §2.2 ("one full amber surface per screen") — the bar rides every screen, so
 * §17.2 needs amending to record the exception rather than leaving the doc and
 * the code disagreeing. Nothing here glows; the disc is the emphasis.
 *
 * The bar's surface is liquid glass where the OS has it (§15.1) and the exact
 * solid `stout2` it has always been where it does not (§15.2) — iOS 26+ only,
 * and never on Android.
 *
 * The Feed item carries an amber signal badge fed by `usePartaSignalStore`
 * (Parta 3.0 §D1): a numeric pill when friend requests wait, else an ambient dot
 * when the feed has unread items or a friend is live now. The dot is static:
 * this bar sits on every screen, so any looping motion here would be ambient
 * animation across the whole app (§10).
 *
 * Driven by expo-router's <Tabs> via `tabBar={(props) => <TabBar {...props} />}`.
 */

import React, { memo, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import {
  CompassIcon,
  BeerIcon,
  UserIcon,
  UsersIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
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

/** Maps a route name to its icon + label + a11y label.
 *  Keys are ROUTE names (unchanged since 2.x); labels are the 3.0 copy. */
const TAB_META: Record<
  string,
  {
    Icon: typeof CompassIcon;
    label: string;
    a11yLabel: string;
    telemetryTarget: UiInteractionTarget;
    /** The centre item: amber even when inactive (§17.2). Exactly one. */
    accent?: boolean;
  }
> = {
  friends: {
    Icon: UsersIcon,
    label: cs.tabs.feed,
    a11yLabel: cs.a11y.tabFeed,
    telemetryTarget: 'tab_friends',
  },
  '(pubs)': {
    Icon: CompassIcon,
    label: cs.tabs.pubs,
    a11yLabel: cs.a11y.tabPubs,
    telemetryTarget: 'tab_compass',
  },
  beer: {
    Icon: BeerIcon,
    label: cs.tabs.party,
    a11yLabel: cs.a11y.tabParty,
    telemetryTarget: 'tab_beer',
    accent: true,
  },
  community: {
    Icon: TrophyIcon,
    label: cs.tabs.community,
    a11yLabel: cs.a11y.tabCommunity,
    telemetryTarget: 'tab_community',
  },
  profile: {
    Icon: UserIcon,
    label: cs.tabs.profile,
    a11yLabel: cs.a11y.tabProfile,
    telemetryTarget: 'tab_profile',
  },
};

/** Whether the OS can draw liquid glass. Constant for the process, so it is
 *  resolved once rather than on every render (iOS 26+; false everywhere else). */
const GLASS = isLiquidGlassAvailable();

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
  // Party inverts: the glyph sits ON the amber disc, so it is stout. The LABEL
  // is not on the disc — it sits under it on the dark bar, so giving it the
  // same stout made it invisible. Icon and label need separate colours here.
  const iconColor = meta.accent
    ? Colors.stout
    : focused
      ? Colors.amber
      : Colors.mutedText;
  const labelColor = meta.accent || focused ? Colors.amber : Colors.mutedText;
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
          button (§6.1). Amber on the icon and the label already says "active".
          Party adds the 12 % medallion §2.2 allows for an icon in a row — never
          a filled amber circle, which would be a full amber surface on top of
          every screen's own primary button. */}
      <View
        style={[styles.iconWrap, meta.accent && styles.accentWrap]}
      >
        <Icon size={24} color={iconColor} />
        {badge ? <TabBadge count={badge.count} dot={badge.dot} live={badge.live} /> : null}
      </View>
      <Text
        style={[styles.label, { color: labelColor }]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {meta.label}
      </Text>
    </Pressable>
  );
});

/** The party is a fullscreen mode, not a page with chrome: while it is open the
 *  bar steps out of the way entirely and the screen carries its own minimise.
 *  Route name, not label — `beer` is the party's route (see TAB_META). */
const FULLSCREEN_ROUTES = new Set(['beer']);

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const activeRoute = state.routes[state.index]?.name;
  const hidden = !!activeRoute && FULLSCREEN_ROUTES.has(activeRoute);
  const hapticEnabled = useSettingsStore((s) => s.hapticEnabled);
  const pendingRequests = usePartaSignalStore((s) => s.pendingRequests);
  const unread = usePartaSignalStore((s) => s.unread);
  const liveNow = usePartaSignalStore((s) => s.liveNow);

  // After every hook, never before — an early return above them would change
  // the hook order between renders (rules-of-hooks).
  if (hidden) return null;

  const partaBadge: TabBadgeState | null =
    pendingRequests > 0
      ? { count: pendingRequests, dot: false, live: liveNow }
      : unread > 0 || liveNow
        ? { count: 0, dot: true, live: liveNow }
        : null;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {/* §15.1: the bar is chrome, so it is the glass. §15.2: below iOS 26 and
          on Android this is exactly the solid stout2 the bar always had. The
          surface sits behind the items, never over them — nothing you read
          shows through. */}
      {GLASS ? (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          tintColor={withAlpha(Colors.stout2, 0.6)}
          colorScheme="dark"
          pointerEvents="none"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.barSolid]} pointerEvents="none" />
      )}
      {state.routes.map((route, index) => {
        const focused = state.index === index;

        const onPress = () => {
          if (hapticEnabled) {
            fireLightImpactHaptic();
          }
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          const meta = TAB_META[route.name];

          // Party is a door, not a destination: it opens the fullscreen night
          // as a modal so it slides up, and dismissing it slides back down.
          if (meta?.accent) {
            trackUiInteraction(meta.telemetryTarget, 'select');
            router.push('/party-live' as Href);
            return;
          }

          if (!focused && !event.defaultPrevented) {
            if (meta) trackUiInteraction(meta.telemetryTarget, 'select');
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
    // No backgroundColor: the surface is the glass / solid layer underneath.
    // No top hairline either — on glass a hard line reads as a seam, and the
    // material already separates the bar from what scrolls behind it.
    paddingTop: 8,
    // Glass needs the layer to clip to the bar, not bleed past the hairline.
    overflow: 'hidden',
  },
  /** The pre-3.0 surface, kept verbatim as the no-glass fallback (§15.2). */
  barSolid: {
    backgroundColor: Colors.stout2,
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
  /** Party, inverted: a filled amber disc with a stout glyph on it. This is a
   *  deliberate exception to §2.2's "one full amber surface per screen" — the
   *  bar rides every screen, so §17.2 in the design system needs updating to
   *  say so rather than leaving code and doc disagreeing. */
  accentWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.amber,
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
