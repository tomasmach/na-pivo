import fs from 'node:fs';
import path from 'node:path';

import buildAppConfig from '../../app.config';
import pkgJson from '../../package.json';

jest.mock('expo/config-plugins.js', () => ({
  withInfoPlist: (config: unknown) => config,
  withGradleProperties: (config: unknown) => config,
}));

interface CollectedDataType {
  NSPrivacyCollectedDataType: string;
  NSPrivacyCollectedDataTypeLinked: boolean;
  NSPrivacyCollectedDataTypeTracking: boolean;
  NSPrivacyCollectedDataTypePurposes: string[];
}

const config = buildAppConfig({ config: {} } as never);

const findPluginOptions = (name: string): Record<string, unknown> | undefined => {
  const plugins =
    (config as { plugins?: [string, Record<string, unknown>?][] } | undefined)?.plugins ?? [];
  return plugins.find(([pluginName]) => pluginName === name)?.[1];
};

describe('app.config store-policy surface', () => {
  const collected =
    (config.ios?.privacyManifests?.NSPrivacyCollectedDataTypes as CollectedDataType[]) ?? [];

  it('declares no tracking', () => {
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
    expect(config.ios?.privacyManifests?.NSPrivacyTrackingDomains).toEqual([]);
  });

  it('maps only data types the app actually sends, with official identifiers', () => {
    const types = collected.map((entry) => entry.NSPrivacyCollectedDataType).sort();

    expect(types).toEqual(
      [
        'NSPrivacyCollectedDataTypeCrashData',
        'NSPrivacyCollectedDataTypeDeviceID',
        'NSPrivacyCollectedDataTypeEmailAddress',
        'NSPrivacyCollectedDataTypeFitness',
        'NSPrivacyCollectedDataTypeName',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypePhotosorVideos',
        'NSPrivacyCollectedDataTypePreciseLocation',
        'NSPrivacyCollectedDataTypeProductInteraction',
        'NSPrivacyCollectedDataTypeUserID',
      ].sort(),
    );

    for (const entry of collected) {
      expect(entry.NSPrivacyCollectedDataTypeTracking).toBe(false);
      for (const purpose of entry.NSPrivacyCollectedDataTypePurposes) {
        expect([
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
          'NSPrivacyCollectedDataTypePurposeAnalytics',
        ]).toContain(purpose);
      }
    }
  });

  it('marks account-bound data as linked, including the temporary device account', () => {
    const linked = (type: string) =>
      collected.find((entry) => entry.NSPrivacyCollectedDataType === type)
        ?.NSPrivacyCollectedDataTypeLinked;

    // Nearby-pub requests and walked-distance batches carry the bearer of a
    // real or temporary account server-side.
    expect(linked('NSPrivacyCollectedDataTypePreciseLocation')).toBe(true);
    expect(linked('NSPrivacyCollectedDataTypeDeviceID')).toBe(true);
    expect(linked('NSPrivacyCollectedDataTypeFitness')).toBe(true);
    expect(linked('NSPrivacyCollectedDataTypeEmailAddress')).toBe(true);
    expect(linked('NSPrivacyCollectedDataTypeProductInteraction')).toBe(true);
    expect(linked('NSPrivacyCollectedDataTypeCrashData')).toBe(true);
  });

  it('does not declare audio collection anywhere', () => {
    expect(
      collected.map((entry) => entry.NSPrivacyCollectedDataType),
    ).not.toContain('NSPrivacyCollectedDataTypeAudio');
  });

  it('removed the unused iOS microphone permission', () => {
    expect(config.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
  });

  it('sets the marketing version to 2.0.0 in both package.json and the expo config', () => {
    expect(config.version).toBe('2.0.0');
    expect(pkgJson.version).toBe('2.0.0');
  });

  it('blocks RECORD_AUDIO outright so transitive plugins cannot re-add it', () => {
    expect(config.android?.blockedPermissions ?? []).toContain(
      'android.permission.RECORD_AUDIO',
    );
    expect(config.android?.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
  });

  it('ships the Firebase client config required for Android push tokens', () => {
    expect(config.android?.googleServicesFile).toBe('./google-services.json');
    const googleServices = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'google-services.json'), 'utf8'),
    ) as {
      project_info?: { project_id?: string };
      client?: {
        client_info?: { android_client_info?: { package_name?: string } };
      }[];
    };

    expect(googleServices.project_info?.project_id).toBe('na-pivo-499010');
    expect(
      googleServices.client?.some(
        (client) =>
          client.client_info?.android_client_info?.package_name === 'com.tomasmach.na_pivo',
      ),
    ).toBe(true);
  });

  it('configures expo-camera with microphone and Android audio recording disabled', () => {
    const options = findPluginOptions('expo-camera');
    expect(options?.recordAudioAndroid).toBe(false);
    expect(options?.microphonePermission).toBe(false);
  });

  it('configures expo-image-picker with the microphone permission disabled', () => {
    const options = findPluginOptions('expo-image-picker');
    expect(options?.microphonePermission).toBe(false);
  });

  it('configures expo-secure-store without the unused Face ID permission', () => {
    expect(findPluginOptions('expo-secure-store')?.faceIDPermission).toBe(false);
  });

  it('does not declare the unused iOS Face ID permission', () => {
    expect(config.ios?.infoPlist?.NSFaceIDUsageDescription).toBeUndefined();
  });

  it('keeps camera access enabled: CAMERA is requested and not blocked', () => {
    expect(config.android?.permissions ?? []).toContain('android.permission.CAMERA');
    expect(config.android?.blockedPermissions ?? []).not.toContain('android.permission.CAMERA');
    expect(config.ios?.infoPlist?.NSCameraUsageDescription).toBeTruthy();
    const cameraPlugin = findPluginOptions('expo-camera');
    expect(cameraPlugin?.cameraPermission).not.toBe(false);
    const pickerPlugin = findPluginOptions('expo-image-picker');
    expect(pickerPlugin?.cameraPermission).not.toBe(false);
  });

  it('blocks foreground-service permissions and keeps the expo-location plugin opt-out', () => {
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
      ]),
    );
    expect(config.android?.permissions ?? []).not.toContain(
      'android.permission.FOREGROUND_SERVICE',
    );
    expect(config.android?.permissions ?? []).not.toContain(
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    );
    const plugins =
      (config as { plugins?: [string, Record<string, unknown>?][] } | undefined)?.plugins ?? [];
    expect(
      plugins.some(
        ([name, options]) =>
          name === 'expo-location' &&
          options?.isAndroidForegroundServiceEnabled === false,
      ),
    ).toBe(true);
  });

  it('keeps Android app links auto-verified on both invite routes', () => {
    const filter = config.android?.intentFilters?.[0];
    expect(filter?.autoVerify).toBe(true);
    expect(filter?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ host: 'na-pivo.cz', pathPrefix: '/p/' }),
        expect.objectContaining({ host: 'na-pivo.cz', pathPrefix: '/party/' }),
      ]),
    );
  });
});

describe('release config surface (app.json vs app.config.ts)', () => {
  const appJsonPath = path.join(__dirname, '..', '..', 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')) as Record<string, unknown>;

  const buildPropertiesOptions = findPluginOptions('expo-build-properties');

  it('isolates SDK 57 OTA updates from older 2.0.0 test builds', () => {
    expect(config.runtimeVersion).toBe('2.0.0-sdk57');
    expect(config.updates?.url).toBe(
      'https://u.expo.dev/1f785cbf-d168-4396-937a-463e1c3de2e8',
    );
  });

  it('keeps app.json minimal so runtime/updates live only in app.config.ts', () => {
    expect(appJson).toEqual({ expo: {} });
  });

  it('pins native deployment targets through expo-build-properties', () => {
    const ios = buildPropertiesOptions?.ios as Record<string, unknown> | undefined;
    const android = buildPropertiesOptions?.android as Record<string, unknown> | undefined;
    expect(ios?.deploymentTarget).toBe('16.4');
    expect(android?.minSdkVersion).toBe(24);
    expect(android?.targetSdkVersion).toBe(36);
  });

  it('blocks SYSTEM_ALERT_WINDOW so no transitive dependency can request overlays', () => {
    expect(config.android?.blockedPermissions ?? []).toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
    expect(config.android?.permissions ?? []).not.toContain(
      'android.permission.SYSTEM_ALERT_WINDOW',
    );
  });
});

describe('app.config native Czech localization', () => {
  const csLocalePath = path.join(__dirname, '..', '..', 'locales', 'cs.json');
  const csLocale: {
    ios?: Record<string, unknown>;
    android?: Record<string, unknown>;
  } = JSON.parse(fs.readFileSync(csLocalePath, 'utf8'));

  const localizedIosKeys = [
    'CFBundleDisplayName',
    'NSLocationWhenInUseUsageDescription',
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSMotionUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSCameraUsageDescription',
  ] as const;

  it('maps the native locales to Czech only', () => {
    expect(config.locales).toEqual({ cs: './locales/cs.json' });
  });

  it('enables mixed localizations so Czech strings apply on any device locale', () => {
    expect(config.ios?.infoPlist?.CFBundleAllowMixedLocalizations).toBe(true);
  });

  it('localizes exactly the display name and permission strings declared in infoPlist', () => {
    const infoPlist = config.ios?.infoPlist ?? {};
    for (const key of localizedIosKeys) {
      expect(csLocale.ios?.[key]).toBe(infoPlist[key]);
    }
    expect(Object.keys(csLocale.ios ?? {}).sort()).toEqual([...localizedIosKeys].sort());
  });

  it('never localizes a microphone permission (it is intentionally absent)', () => {
    expect(csLocale.ios).not.toHaveProperty('NSMicrophoneUsageDescription');
  });

  it('never localizes a Face ID permission (it is intentionally absent)', () => {
    expect(csLocale.ios).not.toHaveProperty('NSFaceIDUsageDescription');
  });

  it('localizes the Android launcher app name', () => {
    expect(csLocale.android).toEqual({ app_name: 'Na pivo' });
  });
});
