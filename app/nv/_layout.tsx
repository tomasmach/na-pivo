import React, { useEffect } from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

import { DialogHost, ToastHost } from '@/newlook/components/overlays';
import { isBook, railSideFor } from '@/newlook/duo/layout';
import { BesideColumn, BookPanel } from '@/newlook/duo/pane';
import { C, FontFiles } from '@/newlook/theme';
import { bridgeAppToasts } from '@/newlook/ui/store';

// The clock stays light over a sheet's dark scrim; on the iPhone Duo it is the whole side column.
const SHEET = { presentation: 'transparentModal', animation: 'none', statusBarStyle: 'light', contentStyle: { backgroundColor: 'transparent' } } as const;

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
  'stamgasti',
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
// Full-screen maps, the camera and the onboarding (laid out in two halves itself) keep the whole
// window on the open book.
const WIDE_ROUTES = new Set(['tour-mapa', 'vyfot', 'onboarding']);
// One-way screens: a tap beside their panel does not leave them.
const ONE_WAY_ROUTES = new Set(['prichod', 'verejne-noci', 'viditelnost']);

// On the iPhone Duo a screen pushed over the tabs is a panel: the whole window beside the side
// column when folded, the right half over the still visible tabs on the open book, like a split
// view's second column. It is a transparent modal in either pose, so folding or unfolding with it
// open only changes its frame. Decided once per route when it is pushed: changing a presented
// screen's presentation later is not supported.
const duoPushes = new Map<string, { panel: boolean; book: boolean }>();
function duoPush(key: string | undefined, name: string, insets: EdgeInsets) {
  if (!key) return { panel: false, book: false };
  let push = duoPushes.get(key);
  if (!push) {
    const { width, height } = Dimensions.get('window');
    const book = isBook(width, height);
    const duo = book || railSideFor(insets) !== null;
    push = { panel: duo && !SHEET_ROUTES.has(name) && !WIDE_ROUTES.has(name) && name !== '(tabs)', book };
    duoPushes.set(key, push);
  }
  return push;
}
const PANEL = { presentation: 'transparentModal', statusBarStyle: 'light', contentStyle: { backgroundColor: 'transparent' } } as const;
const panelOptions = (book: boolean) => ({ ...PANEL, animation: book ? 'fade' : 'slide_from_right' }) as const;

// Sheets are native modals on iOS; only a window-level overlay keeps dialogs and toasts above them.
const Overlay = Platform.OS === 'ios' ? FullWindowOverlay : React.Fragment;

export default function NewLookLayout() {
  const [loaded, error] = useFonts(FontFiles);
  const insets = useSafeAreaInsets();
  const panel = (key: string | undefined, name: string) => {
    const push = duoPush(key, name, insets);
    return push.panel ? panelOptions(push.book) : null;
  };
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
            <BesideColumn>
              {WIDE_ROUTES.has(route.name) ? children : <BookPanel dismissable={!ONE_WAY_ROUTES.has(route.name)}>{children}</BookPanel>}
            </BesideColumn>
          )
        }
        screenOptions={({ route }) => ({
          headerShown: false,
          ...(panel(route.key, route.name) ?? { contentStyle: { backgroundColor: C.bg }, animation: 'slide_from_right' }),
        })}
      >
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen
          name="hospoda/[id]"
          options={({ route }) =>
            panel(route.key, route.name) ?? { animation: (route.params as { via?: string } | undefined)?.via === 'card' ? 'slide_from_bottom' : 'slide_from_right' }
          }
        />
        <Stack.Screen name="prichod" options={{ animation: 'fade' }} />
        <Stack.Screen name="hledani" options={{ animation: 'fade' }} />
        <Stack.Screen name="hledat-pivo" options={{ animation: 'fade' }} />
        <Stack.Screen name="vyfot" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notifikace" options={{ animation: 'fade' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="verejne-noci" options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="viditelnost" options={({ route }) => ({ ...panel(route.key, route.name), animation: 'fade', gestureEnabled: false })} />
        <Stack.Screen
          name="prihlaseni"
          options={({ route }) => panel(route.key, route.name) ?? { presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        {/* A page sheet on the Duo's open book would sit centred across the fold, so it is a panel there. */}
        <Stack.Screen name="tour-editor" options={({ route }) => panel(route.key, route.name) ?? { presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="tour-mapa" options={{ presentation: 'fullScreenModal', animation: 'fade', statusBarStyle: 'light' }} />
        <Stack.Screen name="nova-pozvanka" options={({ route }) => panel(route.key, route.name) ?? { presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen
          name="uctenka"
          options={({ route }) => panel(route.key, route.name) ?? { presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
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
