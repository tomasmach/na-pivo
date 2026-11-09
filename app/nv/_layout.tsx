import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { FullWindowOverlay } from 'react-native-screens';

import { DialogHost, ToastHost } from '@/newlook/components/overlays';
import { BesideColumn, BookColumn } from '@/newlook/duo/pane';
import { C, FontFiles } from '@/newlook/theme';
import { bridgeAppToasts } from '@/newlook/ui/store';

const SHEET = { presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } } as const;

// Routes that open as a bottom sheet over the current screen.
const SHEETS = [
  'filtry',
  'kraj',
  'stupen',
  'vrstvy',
  'nesedi',
  'opravit-nazev',
  'opravit-pivo',
  'oteviracka-den',
  'zapis',
  'pridat-pivo',
  'zmenit-misto',
  'dopsat',
  'odhad',
  'hodnoceni',
  'palec',
  'pripominky',
  'do-denicku',
  'vyvesit',
  'prihlasit-fotku',
  'tour-kdy',
  'tour-akce',
  'tour-vyzva',
  'tour-zastavka',
  'tour-prizvat',
  'tour-cinknout',
  'cinknout',
  'tour-ukoncit',
  'odznak',
  'novy-level',
  'dokoncit-ucet',
  'prihlasovani',
  'pozvanka-do-party',
  'sdilet-hospodu',
  'tour-pozvat',
  'nalepky',
  'sdileni-souhlas',
];

const SHEET_ROUTES = new Set(SHEETS);
// Full-screen maps and the camera fill the window on the open book too.
const WIDE_ROUTES = new Set(['tour-mapa', 'vyfot']);

// Sheets are native modals on iOS; only a window-level overlay keeps dialogs and toasts above them.
const Overlay = Platform.OS === 'ios' ? FullWindowOverlay : React.Fragment;

export default function NewLookLayout() {
  const [loaded, error] = useFonts(FontFiles);
  useEffect(() => bridgeAppToasts(), []);
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      <Stack
        // A screen over the tabs lies beside the iPhone Duo's side column; a sheet covers it and keeps its card off it.
        screenLayout={({ route, children }) =>
          route.name === '(tabs)' || SHEET_ROUTES.has(route.name) ? (
            children
          ) : (
            <BesideColumn>{WIDE_ROUTES.has(route.name) ? children : <BookColumn>{children}</BookColumn>}</BesideColumn>
          )
        }
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }}
      >
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen
          name="hospoda/[id]"
          options={({ route }) => ({ animation: (route.params as { via?: string } | undefined)?.via === 'card' ? 'slide_from_bottom' : 'slide_from_right' })}
        />
        <Stack.Screen name="prichod" options={{ animation: 'fade' }} />
        <Stack.Screen name="hledani" options={{ animation: 'fade' }} />
        <Stack.Screen name="hledat-pivo" options={{ animation: 'fade' }} />
        <Stack.Screen name="vyfot" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notifikace" options={{ animation: 'fade' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="verejne-noci" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="prihlaseni" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tour-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tour-mapa" options={{ presentation: 'fullScreenModal', animation: 'fade', statusBarStyle: 'light' }} />
        <Stack.Screen name="nova-pozvanka" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="uctenka" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        {SHEETS.map((name) => (
          <Stack.Screen key={name} name={name} options={SHEET} />
        ))}
      </Stack>
      <Overlay>
        <DialogHost />
        <ToastHost />
      </Overlay>
    </View>
  );
}
