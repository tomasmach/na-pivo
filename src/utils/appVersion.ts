import Constants from 'expo-constants';

export function getAppVersionLabel(): string {
  const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion;
  const buildVersion = Constants.nativeBuildVersion;

  if (!appVersion) return '';

  return buildVersion ? `v${appVersion} (${buildVersion})` : `v${appVersion}`;
}
