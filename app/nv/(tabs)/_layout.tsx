import React from 'react';
import { Easing } from 'react-native';
import { Tabs } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { TabAvatar } from '@/newlook/components/chrome';
import { TabBar } from '@/newlook/components/TabBar';
import { DURATION } from '@/newlook/motion';
import { C } from '@/newlook/theme';

export const unstable_settings = { initialRouteName: 'kompas' };

// The navigator animates scenes with React Native's Animated, so the new look's tokens are restated here.
const SHIFT = 12;
const transitionSpec = {
  animation: 'timing',
  config: { duration: DURATION.base, easing: Easing.bezier(0.2, 0, 0, 1) },
} as const;

export default function NewLookTabs() {
  const reducedMotion = useReducedMotion();
  const shift = reducedMotion ? 0 : SHIFT;
  return (
    <Tabs
      tabBar={(props) => (
        <>
          <TabBar {...props} />
          <TabAvatar tab={props.state.routes[props.state.index]?.name ?? ''} />
        </>
      )}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
        transitionSpec,
        // The next tab comes in from the side it sits on in the bar.
        sceneStyleInterpolator: ({ current }) => ({
          sceneStyle: {
            opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0], extrapolate: 'clamp' }),
            transform: [
              {
                translateX: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [-shift, 0, shift], extrapolate: 'clamp' }),
              },
            ],
          },
        }),
      }}
    >
      <Tabs.Screen name="kompas" />
      <Tabs.Screen name="vycep" />
      <Tabs.Screen name="stamgast" />
      <Tabs.Screen name="piva" />
      <Tabs.Screen name="parta" />
    </Tabs>
  );
}
