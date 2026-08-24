import type { ExpoConfig, ConfigContext } from 'expo/config';
import type { ConfigPlugin } from 'expo/config-plugins';
import { withGradleProperties, withInfoPlist } from 'expo/config-plugins.js';

const LOCATION_REASON =
  'Na pivo používá tvou polohu k nalezení hospod v okolí a namíření šipky. Aktuální nebo přibližná poloha se může poslat mému serveru; GPS trasu ani historii neukládám.';
const BACKGROUND_LOCATION_REASON =
  'Na pivo může večer občas zkontrolovat, jestli sedíš u hospody, a připomenout ti výběr hospody a počítání piv — i když je aplikace zavřená nebo ji zrovna nepoužíváš. GPS trasu ani historii neukládám.';

const LOCAL_BACKEND_MODES = new Set(['local', 'auto']);
const SPLASH_BACKGROUND = '#1f1007';
const SKIP_IOS_WIDGETS = process.env.NA_PIVO_SKIP_IOS_WIDGETS === '1';

// Reversed iOS OAuth client id for the native Google Sign-In redirect, e.g.
// "com.googleusercontent.apps.1234567890-abcdef". Set it via
// EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME. A placeholder keeps `expo prebuild` working
// before Google is configured (Google sign-in just won't function until set).
const GOOGLE_IOS_URL_SCHEME =
  (process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? '').trim() ||
  'com.googleusercontent.apps.PLACEHOLDER';
const GOOGLE_MAPS_ANDROID_API_KEY =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ?? '').trim();
const GOOGLE_MAPS_IOS_API_KEY =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ?? '').trim();

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

function isIosNativeBuild(): boolean {
  const lifecycle = (process.env.npm_lifecycle_event ?? '').trim();
  return (
    process.env.EAS_BUILD_PLATFORM === 'ios' ||
    lifecycle === 'ios' ||
    lifecycle === 'ios:local'
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

const withAndroidGradleMemory: ConfigPlugin = (config) =>
  withGradleProperties(config, (config) => {
    const key = 'org.gradle.jvmargs';
    const value = '-Xmx2048m -XX:MaxMetaspaceSize=1g';
    const property = config.modResults.find(
      (item) => item.type === 'property' && item.key === key,
    );

    if (property?.type === 'property') {
      property.value = value;
    } else {
      config.modResults.push({ type: 'property', key, value });
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
  if (isIosNativeBuild() && !GOOGLE_MAPS_IOS_API_KEY) {
    throw new Error(
      'iOS mapa vyžaduje EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY. ' +
        'Nastav ho lokálně nebo jako EAS environment secret.',
    );
  }
  const plugins: NonNullable<ExpoConfig['plugins']> = [
    'expo-router',
    'expo-font',
    'expo-asset',
    [
      'react-native-maps',
      {
        ...(GOOGLE_MAPS_ANDROID_API_KEY
          ? { androidGoogleMapsApiKey: GOOGLE_MAPS_ANDROID_API_KEY }
          : {}),
        ...(GOOGLE_MAPS_IOS_API_KEY
          ? { iosGoogleMapsApiKey: GOOGLE_MAPS_IOS_API_KEY }
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
        // No Android foreground service: geofence reminders must not require
        // FOREGROUND_SERVICE(_LOCATION) permissions.
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    'expo-notifications',
    // Camera stays on (menu OCR, beer photos) but never touches the
    // microphone: recordAudioAndroid:false keeps expo-camera from requesting
    // RECORD_AUDIO and microphonePermission:false drops NSMicrophoneUsageDescription.
    [
      'expo-camera',
      {
        cameraPermission:
          'Foťák potřebuju, abych ti z menu přečetl piva a abys mohl vyfotit pivo do deníčku.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Photo library picker for avatars/menu/beer photos; same rule — no mic.
    [
      'expo-image-picker',
      {
        photosPermission:
          'Otevřu ti galerii, ať si vybereš profilovku, fotku pivního menu nebo fotku piva do deníčku.',
        cameraPermission:
          'Foťák potřebuju, abych ti z menu přečetl piva a abys mohl vyfotit pivo do deníčku.',
        microphonePermission: false,
      },
    ],
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
    // Secure store never uses biometric auth (nothing passes
    // requireAuthentication), so drop the Face ID permission string the
    // plugin emits by default.
    [
      'expo-secure-store',
      {
        faceIDPermission: false,
      },
    ],
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
          deploymentTarget: '16.4',
        },
        android: {
          minSdkVersion: 24,
          targetSdkVersion: 36,
        },
      },
    ],
  ];

  if (!SKIP_IOS_WIDGETS) {
    // Generates the WidgetKit extension used by the beer-counter Live
    // Activity, adds NSSupportsLiveActivities and configures its shared app
    // group. Local `npm run dev` deliberately skips it to keep simulator builds
    // lightweight; release/native builds include it by default.
    // expo-widgets hard-codes the widget's marketing version; this parity
    // pass must wrap it (mods unwind in reverse) so App Store validation
    // sees matching versions.
    plugins.push(
      './plugins/with-widget-version-parity',
      [
        'expo-widgets',
        {
          bundleIdentifier: 'com.tomasmach.na-pivo.widgets',
          groupIdentifier: 'group.com.tomasmach.na-pivo',
          enablePushNotifications: false,
          frequentUpdates: false,
        },
      ],
    );
  }

  const expoConfig: ExpoConfig = {
    ...config,
    name: 'Na pivo',
    slug: 'na-pivo',
    owner: 'tomasmachs-organization',
    scheme: 'napivo',
    version: '3.0.0',
    runtimeVersion: { policy: 'appVersion' },
    updates: {
      url: 'https://u.expo.dev/1f785cbf-d168-4396-937a-463e1c3de2e8',
    },
    icon: './assets/images/icon.png',
    orientation: 'portrait',
    // DESIGN.md intentionally postpones light mode. Keep native surfaces such
    // as keyboards and anchored menus on the same dark stout canvas as the app.
    userInterfaceStyle: 'dark',
    assetBundlePatterns: ['**/*'],
    // Czech-only app: declare the native localization so the store and iOS
    // system permission dialogs render Czech instead of English. The locale
    // JSON reuses the exact strings from infoPlist below (parity is asserted
    // in app/__tests__/app-config.test.ts).
    locales: {
      cs: './locales/cs.json',
    },
    ios: {
      bundleIdentifier: 'com.tomasmach.na-pivo',
      icon: './assets/images/icon.png',
      supportsTablet: false,
      usesAppleSignIn: true,
      associatedDomains: ['applinks:na-pivo.cz'],
      // Apple privacy manifest. Collected-data mapping mirrors what the app
      // actually sends (see src/privacy/PrivacyScreen.tsx copy and the
      // telemetry whitelist in src/data/telemetryClient.ts). No tracking:
      // no ad SDKs, no cross-app identifiers, no third-party analytics.
      privacyManifests: {
        NSPrivacyTracking: false,
        NSPrivacyTrackingDomains: [],
        NSPrivacyCollectedDataTypes: [
          // fetchPubsNear sends current coordinates (with the device account's
          // bearer) to find nearby pubs; reminder geofences are evaluated
          // entirely on-device and never sent anywhere.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Anonymous random device identifier that owns the temporary account
          // (plus the push token when notifications are enabled).
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Public account identifiers (account/public UUIDs) sent with
          // signed-in requests.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Optional account registration and profile fields.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Beer photos and menu shots uploaded to the server.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Beer diary entries, ratings and other community/user content
          // synced to the server.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
          // Privacy-safe product/diagnostic telemetry (whitelisted events only);
          // stored with the account id whenever the event is sent signed-in.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeProductInteraction',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAnalytics',
            ],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAnalytics',
            ],
          },
          // Walked-distance batches counted on-device and synced to the account
          // (AccountUsageStats.walked_distance_m); never raw GPS points.
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeFitness',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeAppFunctionality',
            ],
          },
        ],
        NSPrivacyAccessedAPITypes: [
          // React Native / AsyncStorage read values only the app itself wrote.
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
          },
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
            NSPrivacyAccessedAPITypeReasons: ['C617.1'],
          },
        ],
      },
      infoPlist: {
        CFBundleDisplayName: 'Na pivo',
        // Czech is the only bundled localization; this lets the Czech
        // InfoPlist.strings apply even on devices with other system locales.
        CFBundleAllowMixedLocalizations: true,
        NSLocationWhenInUseUsageDescription: LOCATION_REASON,
        NSLocationAlwaysAndWhenInUseUsageDescription: BACKGROUND_LOCATION_REASON,
        NSMotionUsageDescription: 'Pomocí senzorů otáčíme šipku, když se otočíš.',
        NSPhotoLibraryUsageDescription:
          'Otevřu ti galerii, ať si vybereš profilovku, fotku pivního menu nebo fotku piva do deníčku.',
        NSCameraUsageDescription:
          'Foťák potřebuju, abych ti z menu přečetl piva a abys mohl vyfotit pivo do deníčku.',
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
      googleServicesFile: './google-services.json',
      package: 'com.tomasmach.na_pivo',
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: 'na-pivo.cz',
              pathPrefix: '/p/',
            },
            {
              scheme: 'https',
              host: 'na-pivo.cz',
              pathPrefix: '/party/',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      permissions: [
        // Geofence reminders run through the Play Services Geofencing API with
        // callbacks delivered while the app is in the background — there is no
        // Android foreground service (see blockedPermissions below).
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        // Snapping a pub's beer menu ("Vyfoť menu" OCR) and beer photos for the
        // photo diary ("FotoPivař").
        'android.permission.CAMERA',
      ],
      // Foreground-service location permissions are blocked outright: geofence
      // reminders no longer use an Android foreground service, and blocking
      // keeps transitive config plugins (expo-location) from re-adding them.
      // RECORD_AUDIO is blocked for the same reason: no plugin (expo-camera,
      // expo-image-picker, transitive deps) may re-add microphone access.
      // SYSTEM_ALERT_WINDOW ("draw over other apps") is blocked so no
      // transitive dependency can silently request an overlay prompt.
      blockedPermissions: [
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.RECORD_AUDIO',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ],
      adaptiveIcon: {
        foregroundImage: './assets/images/icon.png',
        backgroundColor: '#101010',
      },
    },
    plugins,
    experiments: {
      typedRoutes: true,
    },
    extra: {
      eas: {
        projectId: '1f785cbf-d168-4396-937a-463e1c3de2e8',
      },
    },
  };

  return withAndroidGradleMemory(withoutBackgroundAudio(expoConfig));
};
