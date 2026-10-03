import { expect } from 'e2e';
import { test } from '../../helpers/test';
import { observer } from '../../helpers/backend';
import { dismissPubReminder, openRoute, signIn } from '../../helpers/navigation';

type Row = Record<string, string | boolean>;
type PlacesState = {
  pubKeys: Record<string, string>;
  addedPubs: Row[]; reports: Row[]; feedback: Row[];
  contributions: Row[]; communityXp: Row[];
  community: { name: string; hours_json: unknown; beers: { name: string; price_czk: number }[] }[];
};

test('catalogue selection survives offline restart across compass map and search', { tags: ['critical', 'full'] }, async ({ app, screen, agent, device, local }) => {
  await local.reset('places_social');
  await signIn({ app, screen, device });
  await openRoute({ device, screen }, '/');
  await agent.assert('Kompas míří na hospodu E2E U Testera.');
  await screen.getByLabel('Přepnout na mapu').tap();
  await agent.act('Otevři seznam hospod v mapě a vyber E2E Druhá hospoda. Otevři její stránku hospody. Nic nezapisuj.');
  await agent.assert('Stránka hospody patří E2E Druhá hospoda a ukazuje E2E Ležák za 41 Kč.');
  await screen.getByRole('button', 'Namířit kompas na E2E Druhá hospoda').tap();
  await agent.assert('Kompas míří na E2E Druhá hospoda.');
  await local.offline();
  await app.restart();
  await dismissPubReminder({ screen });
  await openRoute({ device, screen }, '/pub-search');
  await agent.act('Do hledání hospod napiš E2E Druhá a otevři výsledek E2E Druhá hospoda.');
  await agent.assert('Po restartu bez serveru je otevřená stránka E2E Druhá hospoda.');
  local.screenshot('places-offline-catalogue');
  await local.online();
  expect((await local.state<PlacesState>()).scenario.addedPubs).toEqual([]);
});

test('confirmed map pin queues one pub and owner rename preserves its identity', { tags: ['critical', 'full'] }, async ({ app, screen, agent, device, local }) => {
  await local.reset('places_social');
  await signIn({ app, screen, device });
  await openRoute({ device, screen }, '/add-pub');
  await local.offline();
  await agent.act('Vyplň název E2E Nová hospoda a město Praha. Pro novou hospodu vyber polohu špendlíkem v mapě. Potvrď špendlík bez hledání adresy. Ulož hospodu E2E Nová hospoda právě jednou. Nepovoluj oznámení.');
  await openRoute({ device, screen }, '/my-added-pubs');
  await agent.assert('Moje přidané hospody obsahují E2E Nová hospoda, která čeká na odeslání.');
  await app.restart();
  await dismissPubReminder({ screen });
  await openRoute({ device, screen }, '/my-added-pubs');
  await agent.assert('Čekající hospoda E2E Nová hospoda přežila restart bez serveru.');
  await local.online();
  await device.home();
  await device.openApp('com.tomasmach.na-pivo');
  await dismissPubReminder({ screen });
  await expect.poll(async () => (await local.state<PlacesState>()).scenario.addedPubs.length).toBe(1);
  const created = (await local.state<PlacesState>()).scenario.addedPubs[0];
  expect(created).toMatchObject({ account__nickname: 'E2EPivar', name: 'E2E Nová hospoda', location_source: 'user_pin', active: true });
  await openRoute({ device, screen }, '/my-added-pubs');
  await agent.act('U zveřejněné hospody E2E Nová hospoda otevři možnosti a uprav vlastní hospodu. Změň pouze název na E2E Přejmenovaná hospoda a změnu ulož.');
  await expect.poll(async () => (await local.state<PlacesState>()).scenario.addedPubs).toEqual([{ ...created, name: 'E2E Přejmenovaná hospoda' }]);
  await openRoute({ device, screen }, '/my-added-pubs');
  await agent.assert('Je tu právě jedna vlastní hospoda E2E Přejmenovaná hospoda se stavem zveřejněné hospody.');
  local.screenshot('places-published-owner-edit');
});

test('cancelled report changes nothing and offline report hides only for its author', { tags: ['critical', 'full'] }, async ({ app, screen, agent, device, local }) => {
  await local.reset('places_social');
  await signIn({ app, screen, device });
  await openRoute({ device, screen }, '/pub-search');
  await agent.act('Vyhledej E2E Druhá hospoda a otevři její stránku. Přes další možnosti hospody zvol nahlášení, důvod Hospoda zavřela, ale závěrečné potvrzení zruš tlačítkem Zpátky.');
  expect((await local.state<PlacesState>()).scenario.reports).toEqual([]);
  await local.offline();
  await agent.act('Nahlas tuto hospodu E2E Druhá hospoda znovu jako zavřenou. Tentokrát potvrď Nahlásit.');
  await app.restart();
  await dismissPubReminder({ screen });
  await openRoute({ device, screen }, '/pub-search');
  await agent.act('Vyhledej E2E Druhá.');
  await agent.assert('Nahlášená E2E Druhá hospoda není mezi výsledky ani návrhy.');
  local.screenshot('places-reported-hidden-offline');
  await local.online();
  await device.home();
  await device.openApp('com.tomasmach.na-pivo');
  await dismissPubReminder({ screen });
  await expect.poll(async () => (await local.state<PlacesState>()).scenario.reports.length).toBe(1);
  const report = (await local.state<PlacesState>()).scenario;
  expect(report.reports[0]).toEqual({ account__nickname: 'E2EPivar', reason: 'closed', cache_key: report.pubKeys['E2E Druhá hospoda'] });
  const other = await observer('second');
  const search = await other.get('/v1/pubs/suggest?query=E2E%20Druh%C3%A1&pub_search=true');
  expect(search.status).toBe(200);
  expect(JSON.stringify(search.body)).toContain('E2E Druhá hospoda');
});

test('feedback text is durably queued offline and delivered once after restart', { tags: ['critical', 'full'] }, async ({ app, screen, agent, device, local }) => {
  await local.reset('places_social');
  await signIn({ app, screen, device });
  await openRoute({ device, screen }, '/report');
  await local.offline();
  await agent.act('Do hlášení appky napiš přesně E2E Test zprávy bez signálu. Nevyplňuj kontakt ani přílohu. Odešli zprávu jednou.');
  await expect(screen.getByText('Díky!')).toBeVisible();
  await expect(screen.getByText('Zpráva dorazí, i kdyby teď zrovna nebylo připojení. Odešlu ji, jakmile budeš online.')).toBeVisible();
  local.screenshot('places-feedback-queued');
  await app.restart();
  await dismissPubReminder({ screen });
  await local.online();
  await device.home();
  await device.openApp('com.tomasmach.na-pivo');
  await dismissPubReminder({ screen });
  await expect.poll(async () => (await local.state<PlacesState>()).scenario.feedback.length).toBe(1);
  expect((await local.state<PlacesState>()).scenario.feedback[0]).toMatchObject({ message: 'E2E Test zprávy bez signálu.', category: 'bug', attachmentPresent: false });
  await app.restart();
  await dismissPubReminder({ screen });
  expect((await local.state<PlacesState>()).scenario.feedback).toHaveLength(1);
});
