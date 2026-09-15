/**
 * Android push never worked on 1.x: the build had no `google-services.json`, so
 * `getExpoPushTokenAsync` failed silently and no Android device ever registered
 * a token (production had zero Android push devices before 2.0.0). Keep the FCM
 * file wired into the Android config.
 */
import fs from 'node:fs';
import path from 'node:path';

import buildAppConfig from '../../app.config';

jest.mock('expo/config-plugins.js', () => ({
  withInfoPlist: (config: unknown) => config,
}));

const config = buildAppConfig({ config: {} } as never);

describe('app.config Android push', () => {
  it('ships the Firebase config so Android can register an Expo push token', () => {
    const file = config.android?.googleServicesFile;
    expect(file).toBe('./google-services.json');
    const parsed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../..', file!), 'utf8'));
    expect(parsed.client?.[0]?.client_info?.android_client_info?.package_name).toBe(
      config.android?.package,
    );
  });

  it('keeps the notifications plugin', () => {
    expect(config.plugins).toContain('expo-notifications');
  });
});
