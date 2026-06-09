import Constants from 'expo-constants';

import { getAppVersionLabel } from '../appVersion';

describe('getAppVersionLabel', () => {
  const constants = Constants as unknown as {
    nativeAppVersion?: string;
    nativeBuildVersion?: string | null;
    expoConfig?: {
      version?: string;
    };
  };

  const original = {
    nativeAppVersion: constants.nativeAppVersion,
    nativeBuildVersion: constants.nativeBuildVersion,
    expoConfig: constants.expoConfig,
  };

  afterEach(() => {
    constants.nativeAppVersion = original.nativeAppVersion;
    constants.nativeBuildVersion = original.nativeBuildVersion;
    constants.expoConfig = original.expoConfig;
  });

  it('uses the Expo app version and native build version when both exist', () => {
    constants.expoConfig = { version: '1.2.3' };
    constants.nativeBuildVersion = '8';

    expect(getAppVersionLabel()).toBe('v1.2.3 (8)');
  });

  it('falls back to the native app version without a build number', () => {
    constants.expoConfig = {};
    constants.nativeAppVersion = '1.2.0';
    constants.nativeBuildVersion = null;

    expect(getAppVersionLabel()).toBe('v1.2.0');
  });
});
