import React from 'react';
import { Easing } from 'react-native';
import { Tabs } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

import { TabAvatar } from '@/newlook/components/chrome';
import { TabBar } from '@/newlook/components/TabBar';
import { registerDetailScreens } from '@/newlook/duo/details';
import { BesideColumn } from '@/newlook/duo/pane';
import { DURATION } from '@/newlook/motion';
import { PubScreen } from '@/newlook/screens/kompas/PubScreen';
import { KamosScreen, PivoUNekohoScreen, PlanScreen, ZebrickyScreen } from '@/newlook/screens/parta/PartaFlows';
import { BeerScreen } from '@/newlook/screens/piva/BeerScreen';
import { MojeHospodyScreen } from '@/newlook/screens/kompas/AddPubScreens';
import { HlidanaPivaScreen } from '@/newlook/screens/piva/HlidanaPivaScreen';
import { NastaveniScreen, OdznakyScreen, ProfilScreen } from '@/newlook/screens/profil/ProfilScreens';
import { PivniFotkyScreen } from '@/newlook/screens/vycep/PhotoScreens';
import { EveningDetailScreen } from '@/newlook/screens/stamgast/EveningSheets';
import { C } from '@/newlook/theme';
import { FotoPivarScreen } from '@/newlook/screens/vycep/FotoPivar';
import { TourListScreen } from '@/newlook/screens/tour/TourScreens';
import { StatsScreen } from '@/newlook/screens/stamgast/StatsScreen';
import { MojeSetkaniScreen } from '@/newlook/screens/kompas/PubFlows';

export const unstable_settings = { initialRouteName: 'kompas' };

registerDetailScreens({
  hospoda: PubScreen,
  pivo: BeerScreen,
  kamos: KamosScreen,
  plan: PlanScreen,
  vecer: EveningDetailScreen,
  profil: ProfilScreen,
  nastaveni: NastaveniScreen,
  odznaky: OdznakyScreen,
  'pivni-fotky': PivniFotkyScreen,
  'moje-hospody': MojeHospodyScreen,
  'hlidana-piva': HlidanaPivaScreen,
  fotopivar: FotoPivarScreen,
  tour: TourListScreen,
  cisla: StatsScreen,
  'pivo-u-nekoho': PivoUNekohoScreen,
  'moje-setkani': MojeSetkaniScreen,
  zebricky: ZebrickyScreen,
});

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
      // A tab lies beside the iPhone Duo's side column, where its tab bar stands up.
      screenLayout={({ route, children }) => <BesideColumn tab={route.name}>{children}</BesideColumn>}
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
