import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test as mobileTest } from '@e2e-dev/mobile';
import { backendAvailability, readState, resetBackend } from './backend';

export const test = mobileTest.extend<{ local: {
  reset: typeof resetBackend; state: typeof readState; offline: () => Promise<void>; online: () => Promise<void>;
  screenshot: (name: string) => void;
} }>({
  local: async ({ device, app }, use) => {
    await backendAvailability('online');
    await device.installApp();
    // Bind the daemon session to the explicitly configured device before
    // session-scoped commands; two booted iPhones otherwise make close ambiguous.
    await app.open();
    await device.clearKeychain();
    await device.setAppearance('dark');
    // Keep the daemon bound while stopping only this simulator's app. closeApp()
    // ends that binding, but clearState() in mobile 0.9.1 still needs it.
    execFileSync('xcrun', ['simctl', 'terminate', process.env.NA_PIVO_E2E_DEVICE!, 'com.tomasmach.na-pivo'], { stdio: 'ignore' });
    await resetBackend();
    // Keep even synthetic coordinates out of runner reports and model observations.
    execFileSync('xcrun', ['simctl', 'location', process.env.NA_PIVO_E2E_DEVICE!, 'set', '50.08759,14.42108'], { stdio: 'ignore' });
    await app.clearState();
    await use({
      reset: resetBackend, state: readState,
      offline: () => backendAvailability('offline'), online: () => backendAvailability('online'),
      screenshot(name) {
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Use a non-sensitive screenshot name.');
        // Call only on a verified final screen without credentials or coordinates.
        const destination = path.join(process.env.NA_PIVO_E2E_RUN_DIR!, 'screenshots');
        fs.mkdirSync(destination, { recursive: true });
        execFileSync('xcrun', ['simctl', 'io', process.env.NA_PIVO_E2E_DEVICE!, 'screenshot', path.join(destination, `${name}.png`)], { stdio: 'ignore' });
      },
    });
    await backendAvailability('online');
  },
});
