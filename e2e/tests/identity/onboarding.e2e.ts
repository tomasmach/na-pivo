import { expect } from 'e2e';
import { test } from '../../helpers/test';
import { openProfile } from './helpers';

test('onboarding completion persists and auth offers native providers', { tags: ['full', 'identity'] }, async ({ app, screen, device, local }) => {
  await local.reset('identity');
  await app.open();
  await expect(screen.getByTestId('onboarding-skip')).toBeVisible({ timeout: 60_000 });
  // Native startup and the CTA's 700 ms debounce can swallow an early tap.
  // Advance only while the expected next slide is absent.
  await expect.poll(async () => {
    if (await screen.getByText('Čárkuj si večer').first().isVisible()) return true;
    await screen.getByTestId('onboarding-next').tap();
    return false;
  }).toBe(true);
  await expect.poll(async () => {
    if (await screen.getByTestId('onboarding-auth').isVisible()) return true;
    await screen.getByTestId('onboarding-next').tap();
    return false;
  }).toBe(true);
  await screen.getByRole('button', 'Založit účet').tap();
  await expect(screen.getByTestId('auth-email')).toBeVisible();
  await expect(screen.getByRole('button', 'Pokračovat přes Apple')).toBeVisible();
  // Local dummy provider IDs only expose the button; never start external OAuth.
  await expect(screen.getByRole('button', 'Pokračovat přes Google')).toBeVisible();
  await screen.getByRole('button', 'Zpět').tap();
  await app.restart();
  await openProfile({ device, screen });
  await expect(screen.getByRole('button', 'Vytvořit účet')).toBeVisible();
  await expect(screen.getByTestId('onboarding-skip')).not.toBeVisible();
  const anonymous = (await local.state()).accounts.filter(account => !account.registered);
  expect(anonymous).toHaveLength(1);
  expect(anonymous[0].activeTokens).toBeGreaterThan(0);
  local.screenshot('identity-onboarding-completed');
});

test('interrupted onboarding returns until skip persists', { tags: ['full', 'identity'] }, async ({ app, screen, device, local }) => {
  await local.reset('identity');
  await app.open();
  await expect(screen.getByTestId('onboarding-skip')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    if (await screen.getByText('Čárkuj si večer').first().isVisible()) return true;
    await screen.getByTestId('onboarding-next').tap();
    return false;
  }).toBe(true);
  await app.restart();
  await expect(screen.getByTestId('onboarding-skip')).toBeVisible();
  await screen.getByTestId('onboarding-skip').tap();
  await app.restart();
  await openProfile({ device, screen });
  await expect(screen.getByRole('button', 'Vytvořit účet')).toBeVisible();
  await expect(screen.getByTestId('onboarding-skip')).not.toBeVisible();
  expect((await local.state()).accounts.filter(account => !account.registered)).toHaveLength(1);
  local.screenshot('identity-onboarding-skipped');
});
