import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
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
 * Wraps one tab screen. On iOS every tab gets a safe area that includes the
 * system tab bar, and every sheet or modal opened from the screen would inherit
 * it. Descendants keep the device insets; the bar is read via useBottomInset().
 * On Android the tabs already end the screen above the bar.
 */
export function TabScreen({ children }: PropsWithChildren) {
  const tabInsets = useSafeAreaInsets();
  const deviceInsets = useContext(DeviceInsetsContext) ?? tabInsets;
  return (
    <TabBarInsetContext.Provider value={Platform.OS === 'ios' ? tabInsets.bottom : 0}>
      <SafeAreaInsetsContext.Provider value={deviceInsets}>{children}</SafeAreaInsetsContext.Provider>
    </TabBarInsetContext.Provider>
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
