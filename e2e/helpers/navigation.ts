import type { Device } from '@e2e-dev/mobile';
import { expect, secrets, type TestFixtures } from 'e2e';
import { setTimeout as delay } from 'node:timers/promises';

type MobileUI = Pick<TestFixtures, 'app' | 'screen'> & { device: Device };

/** The once-per-version reminder appears after the first process restart. */
export async function dismissPubReminder({ screen }: Pick<MobileUI, 'screen'>, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    for (const label of ['Teď ne, nech mě pít v klidu', 'Not now, let me drink in peace']) {
      const skip = screen.getByRole('button', label);
      if (await skip.isVisible()) {
        await skip.tap();
        await expect(skip).not.toBeVisible();
        return true;
      }
    }
    if (Date.now() >= deadline) return false;
    await delay(200);
  } while (Date.now() < deadline);
  return false;
}

export async function openRoute({ device, screen }: Pick<MobileUI, 'device' | 'screen'>, route: string) {
  if (!/^\/[a-z0-9/?=&._-]*$/i.test(route)) throw new Error('Only static local app routes belong in navigation helpers.');
  await device.openLink(`napivo:/${route}`);
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  if (await dismissPubReminder({ screen }, 0)) {
    await device.openLink(`napivo:/${route}`);
    if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  }
}

export async function skipOnboarding({ app, screen }: Pick<MobileUI, 'app' | 'screen'>) {
  await app.open();
  const skip = screen.getByTestId('onboarding-skip');
  await expect(skip).toBeVisible({ timeout: 60_000 });
  // The native tree can arrive before the first React navigation transition.
  // Skip is idempotent; don't open a deep link until its route has gone away.
  await expect.poll(async () => {
    if (await skip.isVisible()) await skip.tap();
    return !(await skip.isVisible());
  }).toBe(true);
}

export async function signInExisting(ui: MobileUI, emailSecret = 'email', passwordSecret = 'password') {
  await openRoute(ui, '/auth');
  await ui.screen.getByTestId('auth-email').fill(secrets.get(emailSecret));
  await ui.screen.getByTestId('auth-password').fill(secrets.get(passwordSecret));
  await ui.screen.getByTestId('auth-submit').tap();
  await expect(ui.screen.getByTestId('auth-submit')).not.toBeVisible();
  // iOS presents its password-saving dialog after the route has already changed.
  // Wait for that native transition, rather than racing a single isVisible().
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await ui.screen.getByRole('button', 'Not Now').isVisible()) {
      await ui.screen.getByRole('button', 'Not Now').tap();
      break;
    }
    await delay(200);
  }
}

export async function signIn(ui: MobileUI) {
  await skipOnboarding(ui);
  await signInExisting(ui);
}
