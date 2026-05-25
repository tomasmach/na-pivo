import { ExpoConfig, ConfigContext } from 'expo/config';

const LOCATION_REASON =
  'Na pivo používá tvou polohu, aby šipka mířila na nejbližší hospodu. Tvoje poloha nikdy neopouští tento telefon.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Na pivo',
  slug: 'na-pivo',
  scheme: 'napivo',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.tomasmach.napivo',
    buildNumber: '1',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_REASON,
      NSMotionUsageDescription: 'Pomocí senzorů otáčíme šipku, když se otočíš.',
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: [],
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
    'expo-audio',
    'expo-splash-screen',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    stripeDonateUrl:
      process.env.STRIPE_DONATE_URL ??
      'https://donate.stripe.com/eVqcN5fAwgdP5qr9wmdfG00',
    eas: {
      projectId: '1f785cbf-d168-4396-937a-463e1c3de2e8',
    },
  },
});
