import { ExpoConfig, ConfigContext } from 'expo/config';
import { ConfigPlugin, withInfoPlist } from 'expo/config-plugins';

const LOCATION_REASON =
  'Na pivo používá tvou polohu, aby šipka mířila na nejbližší hospodu. Tvoje poloha nikdy neopouští tento telefon.';

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
    owner: 'tomasmach',
    scheme: 'napivo',
    version: '1.0.0',
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
      'expo-splash-screen',
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
