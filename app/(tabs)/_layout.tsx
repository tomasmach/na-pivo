import { Tabs } from 'expo-router';

import { Colors } from '@/theme/colors';
import { TabBar } from '@/components/shared/TabBar';

/**
 * Tab group: the compass (index), the beer counter (counter), and Moje piva
 * (my-beers — the personal beer history), behind a custom hand-rolled tab bar
 * that matches the pub theme. Screen chrome stays headerless and on the stout
 * background, exactly like the previous flat stack.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="counter" />
      <Tabs.Screen name="my-beers" />
    </Tabs>
  );
}
