import buildAppConfig from '../../app.config';

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

  it('removed the unused microphone permission after the playback-only audio audit', () => {
    expect(config.ios?.infoPlist?.NSMicrophoneUsageDescription).toBeUndefined();
    expect(config.android?.permissions ?? []).not.toContain('android.permission.RECORD_AUDIO');
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
