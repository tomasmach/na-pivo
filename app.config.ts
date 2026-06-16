import { ExpoConfig, ConfigContext } from 'expo/config';
import { ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

const LOCATION_REASON =
  'Na pivo používá tvou polohu k nalezení hospod v okolí a namíření šipky. Aktuální nebo přibližná poloha se může poslat našemu serveru, který pro vyhledávání využívá Mapy.cz; GPS trasu ani historii neukládáme.';

const LOCAL_BACKEND_MODES = new Set(['local', 'auto']);
const SPLASH_BACKGROUND = '#1f1007';

function usesLocalBackend(): boolean {
  const mode = (process.env.EXPO_PUBLIC_BACKEND_MODE ?? '').trim().toLowerCase();
  const backendUrl = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().toLowerCase();
  return LOCAL_BACKEND_MODES.has(mode) || LOCAL_BACKEND_MODES.has(backendUrl);
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
  const expoConfig: ExpoConfig = {
    ...config,
    name: 'Na pivo',
    slug: 'na-pivo',
    owner: 'tomasmachs-organization',
    scheme: 'napivo',
    version: '1.1.5',
    icon: './assets/images/icon.png',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    assetBundlePatterns: ['**/*'],
    ios: {
      bundleIdentifier: 'com.tomasmach.na-pivo',
      buildNumber: '4',
      icon: './assets/images/icon.png',
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: LOCATION_REASON,
        NSMotionUsageDescription: 'Pomocí senzorů otáčíme šipku, když se otočíš.',
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
        'expo-location',
        {
          locationWhenInUsePermission: LOCATION_REASON,
          isIosBackgroundLocationEnabled: false,
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
      'expo-secure-store',
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
