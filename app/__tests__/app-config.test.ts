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

  it('bumps the marketing version to 3.0.0 in both package.json and the expo config', () => {
    expect(config.version).toBe('3.0.0');
    expect(pkgJson.version).toBe('3.0.0');
  });

  it('blocks RECORD_AUDIO outright so transitive plugins cannot re-add it', () => {
    expect(config.android?.blockedPermissions ?? []).toContain(
      'android.permission.RECORD_AUDIO',
    );
    expect(config.android?.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
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
