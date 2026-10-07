import buildAppConfig from '../../app.config';

jest.mock('expo/config-plugins.js', () => ({ withInfoPlist: (config: unknown) => config }));

const original = process.env;
afterEach(() => { process.env = original; });

function localEnvironment() {
  process.env = {
    ...original, NODE_ENV: 'development', NA_PIVO_E2E_NATIVE: '1',
    EXPO_PUBLIC_BACKEND_MODE: 'local', EXPO_PUBLIC_BACKEND_URL: 'local',
  };
  delete process.env.EAS_BUILD;
  delete process.env.EAS_BUILD_PLATFORM;
}

it('omits real Firebase configuration only for explicit local E2E development', () => {
  localEnvironment();
  expect(buildAppConfig({ config: {} } as never).android?.googleServicesFile).toBeUndefined();
  delete process.env.NA_PIVO_E2E_NATIVE;
  expect(buildAppConfig({ config: {} } as never).android?.googleServicesFile).toBe('./google-services.json');
});

it.each([
  ['NODE_ENV', 'production'], ['EAS_BUILD', 'true'], ['EAS_BUILD_PLATFORM', 'android'],
  ['EXPO_PUBLIC_BACKEND_MODE', 'production'], ['EXPO_PUBLIC_BACKEND_URL', 'https://example.test'],
])('rejects the E2E override when %s is %s', (key, value) => {
  localEnvironment();
  process.env[key] = value;
  expect(() => buildAppConfig({ config: {} } as never)).toThrow('local development build outside EAS');
});
