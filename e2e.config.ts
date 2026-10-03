import type { E2EConfig } from 'e2e';
import { chatgpt } from 'e2e/oauth/chatgpt';
import { mobile } from '@e2e-dev/mobile';
import { resetCode } from './e2e/helpers/mail';

process.env.E2E_TELEMETRY_DISABLED = '1';
const runDir = process.env.NA_PIVO_E2E_RUN_DIR ?? '';
const metroPort = process.env.NA_PIVO_E2E_METRO_PORT ?? '18221';
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key.startsWith('NA_PIVO_E2E_') && value !== undefined)) as Record<string, string>;

export default {
  projectId: 'na-pivo-local-mobile',
  tests: ['e2e/tests/**/*.e2e.ts'],
  workers: 1,
  retries: 0,
  timeout: 240_000,
  launchTimeout: 90_000,
  actionTimeout: 20_000,
  assertionTimeout: 15_000,
  cleanupTimeout: 30_000,
  trace: 'off',
  video: 'off',
  cache: { mode: 'read-write', dir: '.e2e/cache' },
  agents: {
    default: {
      model: chatgpt('gpt-6.1-sol'),
      context: 'Na Pivo is a Czech mobile app. Only synthetic fixtures and a local API are used. Do not open external websites or OAuth providers. Never enable notifications. Use the visible Czech controls.',
      maxSteps: 25,
      maxModelCalls: 25,
    },
  },
  secrets: {
    email: process.env.NA_PIVO_E2E_EMAIL ?? 'unconfigured@example.test',
    password: process.env.NA_PIVO_E2E_PASSWORD ?? 'unconfigured-password',
    secondEmail: `second-${process.env.NA_PIVO_E2E_EMAIL ?? 'unconfigured@example.test'}`,
    outsiderEmail: `outsider-${process.env.NA_PIVO_E2E_EMAIL ?? 'unconfigured@example.test'}`,
    newPassword: process.env.NA_PIVO_E2E_NEW_PASSWORD ?? 'unconfigured-new-password',
    resetCode,
  },
  targets: [{
    name: 'iphone-17',
    engine: mobile({
      platform: 'ios', device: process.env.NA_PIVO_E2E_DEVICE ?? 'Na Pivo E2E unconfigured',
      session: `napivo-${process.env.NA_PIVO_E2E_DEVICE ?? 'unconfigured'}`,
      // Expo keyboard/modal transitions can outlive the engine's 500 ms default.
      settle: 350, transition: 1000,
    }),
    app: {
      identity: 'na-pivo-expo-local-v1',
      bundleId: 'com.tomasmach.na-pivo',
      appPath: process.env.NA_PIVO_E2E_APP_PATH ?? '.e2e/build/Napivo.app',
      launchArguments: [
        '--initialUrl', `http://127.0.0.1:${metroPort}`,
        '-EXDevMenuShowsAtLaunch', 'NO',
        '-EXDevMenuIsOnboardingFinished', 'YES',
        '-EXDevMenuShowFloatingActionButton', 'NO',
      ],
      // iOS 26.5 cannot set notification permission through simctl privacy.
      // Tests never grant it; the local push adapter also prevents registration.
      permissions: { location: 'grant', camera: 'deny', photos: 'grant' },
      command: {
        executable: 'node', args: ['e2e/runtime/serve.mjs'],
        env: { ...env, E2E_TELEMETRY_DISABLED: '1', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
        log: runDir ? `${runDir}/services.log` : '.e2e/services.log',
        startupTimeout: 90_000,
      },
      readyUrl: `http://127.0.0.1:${metroPort}/status`,
    },
  }],
} satisfies E2EConfig;
