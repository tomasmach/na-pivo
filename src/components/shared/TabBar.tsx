/**
 * Hand-rolled bottom tab bar — matches the stout/amber pub theme instead of the
 * default react-navigation look. Three items (Kompas / Pivo / Profil), each an
 * IconGlyph + Baloo2 label. Active = amber with a subtle glow; inactive =
 * muted. A light haptic fires on press when the user has haptics enabled.
 *
 * Driven by expo-router's <Tabs> via `tabBar={(props) => <TabBar {...props} />}`.
 */

import React, { memo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { CompassIcon, BeerIcon, UserIcon } from '@/components/shared/IconGlyph';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useSettingsStore } from '@/stores/settingsStore';
import { cs } from '@/i18n/cs';

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
  { Icon: typeof CompassIcon; label: string; a11yLabel: string }
> = {
  index: { Icon: CompassIcon, label: cs.tabs.compass, a11yLabel: cs.a11y.tabCompass },
  beer: { Icon: BeerIcon, label: cs.tabs.beer, a11yLabel: cs.a11y.tabBeer },
  profile: { Icon: UserIcon, label: cs.tabs.profile, a11yLabel: cs.a11y.tabProfile },
};

interface TabItemProps {
  routeKey: string;
  routeName: string;
  focused: boolean;
  onPress: () => void;
}

const TabItem = memo(function TabItem({ routeName, focused, onPress }: TabItemProps) {
  const meta = TAB_META[routeName];
  if (!meta) return null;
  const color = focused ? Colors.amber : Colors.mutedText;
  const { Icon } = meta;

  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.a11yLabel}
    >
      <View style={[styles.iconWrap, focused && amberGlow(10)]}>
        <Icon size={24} color={color} />
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

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
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
});
