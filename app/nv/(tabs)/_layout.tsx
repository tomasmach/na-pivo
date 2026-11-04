import React from 'react';
import { Tabs } from 'expo-router';

import { TabBar } from '@/newlook/components/TabBar';
import { C } from '@/newlook/theme';

export const unstable_settings = { initialRouteName: 'kompas' };

export default function NewLookTabs() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg }, animation: 'fade' }}
    >
      <Tabs.Screen name="kompas" />
      <Tabs.Screen name="vycep" />
      <Tabs.Screen name="stamgast" />
      <Tabs.Screen name="piva" />
      <Tabs.Screen name="parta" />
    </Tabs>
  );
}
