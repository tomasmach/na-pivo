import type { Device } from '@e2e-dev/mobile';
import { expect, type Locator, type Screen, type TestFixtures } from 'e2e';
import { dismissPubReminder, openRoute } from '../../helpers/navigation';

export type UI = Pick<TestFixtures, 'app' | 'screen' | 'agent'> & { device: Device };
export type IdentityAccount = {
  publicId: string; nickname: string | null; displayName: string; isPublic: boolean;
  status: string; deleted: boolean; originalPasswordWorks: boolean; newPasswordWorks: boolean;
  hasAvatar: boolean; avatarFileExists: boolean;
  settings: { hidePubNames: boolean; hapticEnabled: boolean; marketingEmailsEnabled: boolean };
  drinks: { clientId: string; beerName: string }[]; sessionTokens: number;
  photos: { publicId: string; clientId: string; caption: string; visibility: string; fileExists: boolean }[];
  oneTimeTokens: { purpose: string; used: boolean }[];
};
export type IdentityState = {
  accounts: IdentityAccount[];
  mail: { verify: number; reset: number; exports: { sections: string[]; publicId: string; drinks: { clientId: string; beerName: string }[] }[] };
};

export async function reveal(screen: Screen, target: Locator) {
  // iPhone 17: swipe inside the scrolling content, clear of header and tabs.
  for (let attempt = 0; attempt < 7 && !await target.isVisible(); attempt++) {
    await screen.swipe({ from: { x: 200, y: 700 }, to: { x: 200, y: 300 } });
  }
  await expect(target).toBeVisible();
}

export async function dismissPasswordPrompt({ screen }: Pick<UI, 'screen'>) {
  if (await screen.getByRole('button', 'Not Now').isVisible()) await screen.getByRole('button', 'Not Now').tap();
}

export async function addBeer(ui: UI) {
  await openRoute(ui, '/beer');
  await dismissPasswordPrompt(ui);
  await ui.agent.act('Zapiš právě jedno pivo z nabídky hospody E2E U Testera: E2E Ležák za 41 Kč, objem 0,5 l. Pokud appka žádá povolení polohy, povol polohu při používání. Pokud nabízí připomínání hospody nebo oznámení, odmítni je. Žádné další pivo nepřidávej.');
}

export async function openProfile(ui: Pick<UI, 'device' | 'screen'>) {
  await dismissPubReminder(ui);
  await openRoute(ui, '/profile');
  await dismissPasswordPrompt(ui);
  await expect.poll(async () => {
    if (await ui.screen.getByRole('button', /^(Teď ne, nech mě pít v klidu|Not now, let me drink in peace)$/).isVisible()) {
      await ui.screen.getByRole('button', /^(Teď ne, nech mě pít v klidu|Not now, let me drink in peace)$/).tap();
    }
    return await ui.screen.getByRole('button', /^(Upravit profil|Edit the profile|Vytvořit účet|Create an account)$/).isVisible();
  }).toBe(true);
}

export async function assertProfileName(ui: UI, name: string) {
  await openProfile(ui);
  await ui.screen.getByRole('button', 'Upravit profil').tap();
  await expect(ui.screen.getByRole('textbox', 'Jméno')).toHaveValue(name);
  await ui.screen.getByRole('button', 'Zavřít').tap();
}
