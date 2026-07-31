import { Tabs } from 'expo-router';

import { Colors } from '@/theme/colors';
import { TabBar } from '@/components/shared/TabBar';

/**
 * Tab group — the five 3.0 sections (§17.1), behind a custom hand-rolled tab bar
 * that matches the pub theme. Screen chrome stays headerless and on the stout
 * background, exactly like the previous flat stack.
 *
 * Declaration order IS bar order, so Party lands in the middle. The route names
 * are the 2.x ones on purpose — `napivo://beer` is the Live Activity deep link
 * and `/beer` / `/friends` are still named in telemetry, `appReviewPolicy` and a
 * dozen `router.replace` calls. Renaming them is its own change, with redirects.
 *
 *   friends → Feed        index → Hospody      beer → Party
 *   community → Community profile → Profil
 *
 * `initialRouteName` keeps the app opening on the compass, exactly as before —
 * moving the landing screen is a product decision, not a side effect of
 * reordering the bar.
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Colors.stout },
      }}
    >
      <Tabs.Screen name="friends" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="beer" />
      <Tabs.Screen name="community" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
