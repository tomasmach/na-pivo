import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getBackendEndpoint, getBackendUrl } from '../backendConfig';

const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const ORIGINAL_MODE = process.env.EXPO_PUBLIC_BACKEND_MODE;
const ORIGINAL_HOST = process.env.EXPO_PUBLIC_BACKEND_HOST;
const ORIGINAL_PORT = process.env.EXPO_PUBLIC_BACKEND_PORT;
const ORIGINAL_PLATFORM = Platform.OS;

const constants = Constants as unknown as {
  expoConfig: { hostUri?: string; version?: string; extra?: Record<string, unknown> } | null;
  expoGoConfig?: { debuggerHost?: string } | null;
  manifest?: { debuggerHost?: string; hostUri?: string } | null;
};

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  setEnv('EXPO_PUBLIC_BACKEND_URL', undefined);
  setEnv('EXPO_PUBLIC_BACKEND_MODE', undefined);
  setEnv('EXPO_PUBLIC_BACKEND_HOST', undefined);
  setEnv('EXPO_PUBLIC_BACKEND_PORT', undefined);
  constants.expoConfig = { version: '1.1.2', extra: { mapyApiKey: 'test-key' } };
  constants.expoGoConfig = null;
  constants.manifest = null;
  (Platform as { OS: string }).OS = 'ios';
});

afterEach(() => {
  setEnv('EXPO_PUBLIC_BACKEND_URL', ORIGINAL_URL);
  setEnv('EXPO_PUBLIC_BACKEND_MODE', ORIGINAL_MODE);
  setEnv('EXPO_PUBLIC_BACKEND_HOST', ORIGINAL_HOST);
  setEnv('EXPO_PUBLIC_BACKEND_PORT', ORIGINAL_PORT);
  (Platform as { OS: string }).OS = ORIGINAL_PLATFORM;
});

describe('backendConfig', () => {
  it('uses the configured backend URL by default', () => {
    setEnv('EXPO_PUBLIC_BACKEND_URL', 'https://api.example.com/');

    expect(getBackendUrl()).toBe('https://api.example.com');
    expect(getBackendEndpoint('v1/health')).toBe('https://api.example.com/v1/health');
  });

  it('keeps the backend dormant when no URL or mode is configured', () => {
    expect(getBackendUrl()).toBe('');
    expect(getBackendEndpoint('/v1/health')).toBeNull();
  });

  it('derives a local backend URL from Expo hostUri in local mode', () => {
    setEnv('EXPO_PUBLIC_BACKEND_URL', 'https://api.na-pivo.cz');
    setEnv('EXPO_PUBLIC_BACKEND_MODE', 'local');
    constants.expoConfig = { hostUri: '192.168.1.42:8081' };

    expect(getBackendUrl()).toBe('http://192.168.1.42:8000');
    expect(getBackendEndpoint('/v1/health')).toBe('http://192.168.1.42:8000/v1/health');
  });

  it('supports custom local backend ports', () => {
    setEnv('EXPO_PUBLIC_BACKEND_MODE', 'local');
    setEnv('EXPO_PUBLIC_BACKEND_PORT', '8765');
    constants.expoConfig = { hostUri: '192.168.1.42:8081' };

    expect(getBackendUrl()).toBe('http://192.168.1.42:8765');
  });

  it('lets a local backend host override Expo hostUri', () => {
    setEnv('EXPO_PUBLIC_BACKEND_MODE', 'local');
    setEnv('EXPO_PUBLIC_BACKEND_HOST', '192.168.1.33');
    constants.expoConfig = { hostUri: 'localhost:8081' };

    expect(getBackendUrl()).toBe('http://192.168.1.33:8000');
  });

  it('maps Android loopback to the host machine address', () => {
    setEnv('EXPO_PUBLIC_BACKEND_MODE', 'local');
    constants.expoConfig = { hostUri: 'localhost:8081' };
    (Platform as { OS: string }).OS = 'android';

    expect(getBackendUrl()).toBe('http://10.0.2.2:8000');
  });

  it('lets remote mode force the configured URL even in dev', () => {
    setEnv('EXPO_PUBLIC_BACKEND_URL', 'https://api.na-pivo.cz/');
    setEnv('EXPO_PUBLIC_BACKEND_MODE', 'remote');
    constants.expoConfig = { hostUri: '192.168.1.42:8081' };

    expect(getBackendUrl()).toBe('https://api.na-pivo.cz');
  });
});
