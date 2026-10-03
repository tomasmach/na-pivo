import { expect } from 'e2e';
import { test } from '../../helpers/test';
import { restartWithPermissions } from '../../helpers/media';
import { dismissPubReminder, openRoute, signIn } from '../../helpers/navigation';

test('denied location keeps manual search usable and denied camera keeps feedback usable', { tags: ['full'] }, async ({ app, screen, agent, device, local }) => {
  await local.reset('places_social');
  await signIn({ app, screen, device });
  await restartWithPermissions(device, { location: 'deny', camera: 'deny' });
  await dismissPubReminder({ screen });
  await openRoute({ device, screen }, '/');
  await agent.assert('Kompas vysvětluje chybějící povolení polohy a nabízí mapu bez polohy.');
  await agent.act('Otevři mapu bez polohy. Nepovoluj polohu v nastavení.');
  await agent.assert('Pivní mapa se otevřela i bez polohy.');
  await openRoute({ device, screen }, '/pub-search');
  await agent.act('Vyhledej nesmyslný název E2E NenalezitelnyPodnik.');
  await agent.assert('Úspěšné hledání ukazuje, že nic nenašlo.');
  await openRoute({ device, screen }, '/report');
  await agent.act('Přidej přílohu z fotoaparátu do hlášení. Pokud appka vysvětlí odepřenou kameru, zruš dialog a vrať se do formuláře bez otevření nastavení. Pak napiš zprávu E2E Kamera odmítnuta a odešli ji bez přílohy.');
  await expect.poll(async () => (await local.state<{ feedback: { message: string; attachmentPresent: boolean }[] }>()).scenario.feedback).toEqual([expect.objectContaining({ message: 'E2E Kamera odmítnuta', attachmentPresent: false })]);
  await expect(screen.getByText('Díky!')).toBeVisible();
  await expect(screen.getByText('Zpráva dorazí, i kdyby teď zrovna nebylo připojení. Odešlu ji, jakmile budeš online.')).toBeVisible();
  local.screenshot('places-denied-camera-feedback');
});
