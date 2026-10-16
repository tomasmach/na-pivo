import { expect, secrets } from 'e2e';
import { test } from '../../helpers/test';

test('login and one beer survive a process restart', { tags: ['critical', 'full', 'spike'] }, async ({ app, screen, agent, device, local }) => {
  await app.open();
  await expect(screen.getByTestId('onboarding-skip')).toBeVisible({ timeout: 60_000 });
  await screen.getByTestId('onboarding-skip').tap();
  await device.openLink('napivo://auth');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await screen.getByTestId('auth-email').fill(secrets.get('email'));
  await screen.getByTestId('auth-password').fill(secrets.get('password'));
  await screen.getByTestId('auth-submit').tap();
  await expect(screen.getByTestId('auth-submit')).not.toBeVisible();
  await device.openLink('napivo://beer');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await agent.act('Zapiš právě jedno pivo z nabídky hospody E2E U Testera: E2E Ležák za 41 Kč, objem 0,5 l. Pokud se zobrazí systémová nabídka Save Password, zvol Not Now. Po zapsání už další pivo nepřidávej.');
  await agent.assert('Počítadlo ukazuje právě jedno zapsané pivo.');
  await expect.poll(async () => (await local.state()).accounts.find(a => a.nickname === 'E2EPivar')?.drinks).toEqual([
    { beer_name: 'E2E Ležák', price_czk: 41, volume_ml: 500, place_context: 'pub', drink_type: 'beer' },
  ]);
  expect((await local.state()).scenario.primaryDrinkPubNames).toEqual(['E2E U Testera']);
  await app.restart();
  await device.openLink('napivo://profile');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await agent.act('Zobraz Profil přihlášeného účtu. Pokud appka nabízí připomínání hospody nebo povolení oznámení, odmítni tlačítkem Teď ne, nech mě pít v klidu. Nic nezapínej.');
  await screen.getByRole('button', 'Upravit profil').tap();
  await expect(screen.getByRole('textbox', 'Jméno')).toHaveValue('E2E Pivař');
  await device.openLink('napivo://beer');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await agent.assert('Po restartu je v počítadle stále právě jedno pivo a celková cena je 41 Kč.');
  local.screenshot('spike-persisted-drink');
  const account = (await local.state()).accounts.find(a => a.nickname === 'E2EPivar');
  expect(account?.drinks).toEqual([{ beer_name: 'E2E Ležák', price_czk: 41, volume_ml: 500, place_context: 'pub', drink_type: 'beer' }]);
  expect(account?.activeTokens).toBeGreaterThan(0);
  expect((await local.state()).scenario.primaryDrinkPubNames).toEqual(['E2E U Testera']);
});
