import { ExpoConfig, ConfigContext } from 'expo/config';
import { ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

const LOCATION_REASON =
  'Na pivo používá tvou polohu k nalezení hospod v okolí a namíření šipky. Aktuální nebo přibližná poloha se může poslat našemu serveru, který pro vyhledávání využívá Mapy.cz; GPS trasu ani historii neukládáme.';
const BACKGROUND_LOCATION_REASON =
  'Na pivo může večer občas zkontrolovat, jestli sedíš u hospody, a připomenout ti výběr hospody a počítání piv. GPS trasu ani historii neukládáme.';

const LOCAL_BACKEND_MODES = new Set(['local', 'auto']);
const SPLASH_BACKGROUND = '#1f1007';

// Reversed iOS OAuth client id for the native Google Sign-In redirect, e.g.
// "com.googleusercontent.apps.1234567890-abcdef". Set it via
// EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME. A placeholder keeps `expo prebuild` working
// before Google is configured (Google sign-in just won't function until set).
const GOOGLE_IOS_URL_SCHEME =
  (process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? '').trim() ||
  'com.googleusercontent.apps.PLACEHOLDER';
const GOOGLE_MAPS_ANDROID_API_KEY =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ?? '').trim();

function usesLocalBackend(): boolean {
  const mode = (process.env.EXPO_PUBLIC_BACKEND_MODE ?? '').trim().toLowerCase();
  const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().toLowerCase();
  return LOCAL_BACKEND_MODES.has(mode) || LOCAL_BACKEND_MODES.has(backendUrl);
}

function isAndroidNativeBuild(): boolean {
  const lifecycle = (process.env.npm_lifecycle_event ?? '').trim();
  return (
    process.env.EAS_BUILD_PLATFORM === 'android' ||
    lifecycle === 'android' ||
    lifecycle === 'android:local'
  );
}

const withoutBackgroundAudio: ConfigPlugin = (config) =>
  withInfoPlist(config, (config) => {
    const modes = config.modResults.UIBackgroundModes;

    if (Array.isArray(modes)) {
      const filteredModes = modes.filter((mode) => mode !== 'audio');

      if (filteredModes.length === 0) {
        delete config.modResults.UIBackgroundModes;
      } else {
        config.modResults.UIBackgroundModes = filteredModes;
      }
    }

    return config;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  if (isAndroidNativeBuild() && !GOOGLE_MAPS_ANDROID_API_KEY) {
    throw new Error(
      'Android mapa vyžaduje EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY. ' +
        'Nastav ho lokálně nebo jako EAS environment secret.',
    );
  }
  const expoConfig: ExpoConfig = {
    ...config,
    name: 'Na pivo',
    slug: 'na-pivo',
    owner: 'tomasmachs-organization',
    scheme: 'napivo',
    version: '1.3.2',
    icon: './assets/images/icon.png',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.tomasmach.na-pivo',
      buildNumber: '4',
      icon: './assets/images/icon.png',
      supportsTablet: false,
      usesAppleSignIn: true,
      associatedDomains: ['applinks:napivo.app'],
      infoPlist: {
        CFBundleDisplayName: 'Na pivo',
        NSLocationWhenInUseUsageDescription: LOCATION_REASON,
        NSLocationAlwaysAndWhenInUseUsageDescription: BACKGROUND_LOCATION_REASON,
        NSMotionUsageDescription: 'Pomocí senzorů otáčíme šipku, když se otočíš.',
        NSMicrophoneUsageDescription:
          'Mikrofon se použije jen pro zvukové funkce aplikace a nikdy bez tvého souhlasu.',
        NSPhotoLibraryUsageDescription:
          'Otevřu ti galerii, ať si vybereš profilovku nebo fotku pivního menu.',
        NSCameraUsageDescription:
          'Foťák potřebuju, abych ti z menu přečetl piva.',
        ITSAppUsesNonExemptEncryption: false,
        ...(usesLocalBackend()
          ? {
              NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
              },
            }
          : {}),
      },
    },
    android: {
      package: 'com.tomasmach.na_pivo',
      versionCode: 1,
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'napivo.app',
              pathPrefix: '/p',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      permissions: [
        // Geofencing (Android Geofencing API) wakes the app via a broadcast
        // receiver — no foreground service, so no permanent "tracking" notice.
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        // Snapping a pub's beer menu for the "Vyfoť menu" OCR helper.
        'android.permission.CAMERA',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/images/icon.png',
        backgroundColor: '#101010',
      },
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-asset',
      [
        'react-native-maps',
        {
          ...(GOOGLE_MAPS_ANDROID_API_KEY
            ? { androidGoogleMapsApiKey: GOOGLE_MAPS_ANDROID_API_KEY }
            : {}),
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission: LOCATION_REASON,
          locationAlwaysAndWhenInUsePermission: BACKGROUND_LOCATION_REASON,
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      'expo-notifications',
      [
        'expo-audio',
        {
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
          microphonePermission: false,
          recordAudioAndroid: false,
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/icon.png',
          imageWidth: 140,
          resizeMode: 'contain',
          backgroundColor: SPLASH_BACKGROUND,
        },
      ],
      'expo-secure-store',
      // Sign in with Apple (iOS). Adds the com.apple.developer.applesignin
      // entitlement; requires enabling the capability on the App ID in the
      // Apple Developer portal and a dev-client rebuild.
      'expo-apple-authentication',
      // Native Google Sign-In. iosUrlScheme is the reversed iOS OAuth client id;
      // requires a dev-client rebuild. webClientId is supplied at runtime in
      // src/data/socialAuth.ts via EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
      [
        '@react-native-google-signin/google-signin',
        {
          iosUrlScheme: GOOGLE_IOS_URL_SCHEME,
        },
      ],
      // google-signin pulls in AppCheckCore/GoogleUtilities, which can't be
      // integrated as static *libraries* (no module maps). Building iOS pods as
      // static *frameworks* gives them module maps so Swift can import them —
      // the documented fix for google-signin on Expo.
      [
        'expo-build-properties',
        {
          ios: {
            useFrameworks: 'static',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: '1f785cbf-d168-4396-937a-463e1c3de2e8',
      },
    },
  };

  return withoutBackgroundAudio(expoConfig);
};
