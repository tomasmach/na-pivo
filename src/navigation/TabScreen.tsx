import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from 'react';
import { Platform, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
  type EdgeInsets,
} from 'react-native-safe-area-context';

const DeviceInsetsContext = createContext<EdgeInsets | null>(null);
const TabBarInsetContext = createContext<number | null>(null);

/** Wraps the tab navigator to remember the device insets above the tabs. */
export function TabsInsetsRoot({ children }: PropsWithChildren) {
  return (
    <DeviceInsetsContext.Provider value={useSafeAreaInsets()}>{children}</DeviceInsetsContext.Provider>
  );
}

/**
 * Screens do not pad their sides, so a screen is narrowed by its side insets:
 * the iPhone Duo's camera and status bar column and its side tab rail.
 * Descendants see no side insets, so nothing pads twice.
 */
function SideInsets({
  insets,
  left,
  right,
  children,
}: PropsWithChildren<{ insets: EdgeInsets; left: number; right: number }>) {
  const { top, bottom } = insets;
  const inner = useMemo(() => ({ top, bottom, left: 0, right: 0 }), [top, bottom]);
  return (
    <SafeAreaInsetsContext.Provider value={inner}>
      <View style={{ flex: 1, marginLeft: left, marginRight: right }}>{children}</View>
    </SafeAreaInsetsContext.Provider>
  );
}

/**
 * Wraps one tab screen. On iOS every tab gets a safe area that includes the
 * system tab bar, and every sheet or modal opened from the screen would inherit
 * it. Descendants keep the device's top and bottom insets; the bar is read via
 * useBottomInset(). On Android the tabs already end the screen above the bar.
 *
 * A tab that is not on screen reports no insets until it is shown, so the
 * device insets count on the sides too.
 */
export function TabScreen({ children }: PropsWithChildren) {
  const tabInsets = useSafeAreaInsets();
  const deviceInsets = useContext(DeviceInsetsContext) ?? tabInsets;
  return (
    <TabBarInsetContext.Provider value={Platform.OS === 'ios' ? tabInsets.bottom : 0}>
      <SideInsets
        insets={deviceInsets}
        left={Math.max(tabInsets.left, deviceInsets.left)}
        right={Math.max(tabInsets.right, deviceInsets.right)}
      >
        {children}
      </SideInsets>
    </TabBarInsetContext.Provider>
  );
}

/** Wraps a route outside the tabs. */
export function RouteScreen({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return (
    <SideInsets insets={insets} left={insets.left} right={insets.right}>
      {children}
    </SideInsets>
  );
}

/** How much of the screen's bottom edge the tab bar covers; 0 outside tabs. */
export function useTabBarInset(): number {
  return useContext(TabBarInsetContext) ?? 0;
}

/**
 * Bottom padding that keeps `gap` clear above what covers the bottom edge: the
 * tab bar inside a tab, the device inset elsewhere (which the gap may overlap).
 */
export function useBottomInset(gap = 0): number {
  const tabBarInset = useContext(TabBarInsetContext);
  const { bottom } = useSafeAreaInsets();
  return tabBarInset === null ? Math.max(bottom, gap) : tabBarInset + gap;
}

/**
 * False until the screen is first on screen. Tabs mount with the app, so server
 * fetches that used to run on mount wait for this instead.
 */
export function useFirstFocus(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => setFocused(true), []));
  return focused;
}
