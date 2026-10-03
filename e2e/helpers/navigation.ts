import type { Device } from '@e2e-dev/mobile';
import { expect, secrets, type TestFixtures } from 'e2e';

type MobileUI = Pick<TestFixtures, 'app' | 'screen'> & { device: Device };

export async function openRoute({ device, screen }: Pick<MobileUI, 'device' | 'screen'>, route: string) {
  if (!/^\/[a-z0-9/?=&._-]*$/i.test(route)) throw new Error('Only static local app routes belong in navigation helpers.');
  await device.openLink(`napivo:/${route}`);
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
}

export async function skipOnboarding({ app, screen }: Pick<MobileUI, 'app' | 'screen'>) {
  await app.open();
  await expect(screen.getByTestId('onboarding-skip')).toBeVisible({ timeout: 60_000 });
  await screen.getByTestId('onboarding-skip').tap();
}

export async function signInExisting(ui: MobileUI, emailSecret = 'email', passwordSecret = 'password') {
  await openRoute(ui, '/auth');
  await ui.screen.getByTestId('auth-email').fill(secrets.get(emailSecret));
  await ui.screen.getByTestId('auth-password').fill(secrets.get(passwordSecret));
  await ui.screen.getByTestId('auth-submit').tap();
  await expect(ui.screen.getByTestId('auth-submit')).not.toBeVisible();
  if (await ui.screen.getByRole('button', 'Not Now').isVisible()) await ui.screen.getByRole('button', 'Not Now').tap();
}

export async function signIn(ui: MobileUI) {
  await skipOnboarding(ui);
  await signInExisting(ui);
}
