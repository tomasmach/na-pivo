import { Tabs } from 'expo-router';

import { Colors } from '@/theme/colors';
import { TabBar } from '@/components/shared/TabBar';

/**
 * Tab group: the compass (index), the merged "Pivo" tab (beer — counter +
 * personal history behind a segment), and Profil (profile — the beer-social
 * identity), behind a custom hand-rolled tab bar that matches the pub theme.
 * Screen chrome stays headerless and on the stout background, exactly like the
 * previous flat stack.
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
      <Tabs.Screen name="beer" />
      <Tabs.Screen name="friends" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
