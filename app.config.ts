import fs from 'fs';
import path from 'path';
import { ExpoConfig, ConfigContext } from 'expo/config';
import {
  ConfigPlugin,
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
} from 'expo/config-plugins';

const LOCATION_REASON =
  'Na pivo používá tvou polohu, aby šipka mířila na nejbližší hospodu. Tvoje poloha nikdy neopouští tento telefon.';

const MAPY_USER_AGENT = 'napivo-ios/1.0';
const REQUIRED_EAS_ENV = ['EXPO_PUBLIC_MAPY_API_KEY'] as const;
const RCT_HTTP_HANDLER_IMPORT = '#import <React/RCTHTTPRequestHandler.h>';

function assertRequiredEasEnv(): void {
  if (process.env.EAS_BUILD !== 'true') return;

  const missing = REQUIRED_EAS_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required EAS env: ${missing.join(', ')}`);
  }
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

const withMapyUserAgent: ConfigPlugin = (config) => {
  config = withAppDelegate(config, (config) => {
    const appDelegate = config.modResults;
    if (appDelegate.language !== 'swift') return config;

    if (!appDelegate.contents.includes('private let mapyUserAgent')) {
      appDelegate.contents = appDelegate.contents.replace(
        'class AppDelegate: ExpoAppDelegate {\n',
        `class AppDelegate: ExpoAppDelegate {\n  private let mapyUserAgent = "${MAPY_USER_AGENT}"\n\n`,
      );
    }

    if (!appDelegate.contents.includes('RCTSetCustomNSURLSessionConfigurationProvider')) {
      appDelegate.contents = appDelegate.contents.replace(
        '  ) -> Bool {\n',
        `  ) -> Bool {\n    RCTSetCustomNSURLSessionConfigurationProvider { [mapyUserAgent] in\n      let configuration = URLSessionConfiguration.default\n      configuration.httpAdditionalHeaders = ["User-Agent": mapyUserAgent]\n      return configuration\n    }\n\n`,
      );
    }

    return config;
  });

  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const sourceRoot = IOSConfig.Paths.getSourceRoot(config.modRequest.projectRoot);
      const bridgingHeaderPath = path.join(
        sourceRoot,
        `${path.basename(sourceRoot)}-Bridging-Header.h`,
      );

      if (fs.existsSync(bridgingHeaderPath)) {
        const contents = fs.readFileSync(bridgingHeaderPath, 'utf8');
        if (!contents.includes(RCT_HTTP_HANDLER_IMPORT)) {
          fs.writeFileSync(bridgingHeaderPath, `${contents.trimEnd()}\n${RCT_HTTP_HANDLER_IMPORT}\n`);
        }
      }

      return config;
    },
  ]);
};

export default ({ config }: ConfigContext): ExpoConfig => {
  assertRequiredEasEnv();

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

  return withMapyUserAgent(withoutBackgroundAudio(expoConfig));
};
