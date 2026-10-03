import { expect } from 'e2e';
import { test } from '../../helpers/test';
import { observer } from '../../helpers/backend';
import { openRoute, signIn } from '../../helpers/navigation';
import { countMenuBeer, openCounter, restartDiaryApp, type DiaryState } from './ui';

test('offline beer rating survives restart and reaches its own detail', { tags: ['full', 'diary'], timeout: 420_000 }, async ({ app, screen, agent, device, local }) => {
  await local.reset('diary');
  await app.clearState();
  const ui = { app, screen, agent, device };
  await signIn(ui);
  await openCounter(ui);
  await countMenuBeer(ui);
  await expect.poll(async () => (await local.state<DiaryState>()).scenario.drinks.length).toBe(1);
  expect((await local.state<DiaryState>()).scenario.checkins).toHaveLength(0);
  await expect(screen.getByRole('button', 'Ohodnotit')).toBeVisible({ timeout: 15_000 });
  await local.offline();
  await screen.getByRole('button', 'Ohodnotit').tap();
  await agent.act('Ulož hodnocení právě tohoto piva E2E Ležák: 4 hvězdičky, verdikt Má říz a viditelnost Jen pro mě. Jméno piva a pivovar neměň. Ulož právě jednou.').catch(error => {
    local.screenshot('diary-rating-write-failed');
    throw error;
  });
  await restartDiaryApp(ui);
  await openCounter(ui);
  await expect(screen.getByRole('button', '1 pivo, utraceno 41 Kč. Otevře tvůj účet.')).toBeVisible();
  await expect(screen.getByRole('button', 'Změnit místo. Teď E2E U Testera.')).toBeVisible();
  await local.online();
  await device.home();
  await app.open();
  await expect.poll(async () => (await local.state<DiaryState>()).scenario.checkins.length).toBe(1);
  const checkin = (await local.state<DiaryState>()).scenario.checkins[0];
  expect(checkin).toMatchObject({ beer_name: 'E2E Ležák', rating: '4.0', tags: ['crisp'], visibility: 'private', pub_name: 'E2E U Testera' });
  // Encoded query is passed only to the synthetic app route; no personal data.
  await device.openLink('napivo://beer-detail?beer=E2E%20Le%C5%BE%C3%A1k');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await agent.assert('Detail piva E2E Ležák ukazuje moje 1, můj průměr 4.0 a verdikt Má říz.');
  const read = await observer();
  const detail = await read.get('/v1/beers/detail?beer_name=E2E%20Le%C5%BE%C3%A1k');
  expect(detail.status).toBe(200);
  expect(detail.body).toMatchObject({ my_count: 1, my_average_rating: 4, my_tags: { crisp: 1 } });
  await restartDiaryApp(ui);
  await openRoute(ui, '/beer');
  await device.openLink('napivo://beer-detail?beer=E2E%20Le%C5%BE%C3%A1k');
  if (await screen.getByRole('button', 'Open').isVisible()) await screen.getByRole('button', 'Open').tap();
  await agent.assert('Detail piva E2E Ležák ukazuje moje 1, průměr 4.0 a Má říz.');
  local.screenshot('diary-rated-beer-detail');
  expect((await local.state<DiaryState>()).scenario.checkins).toEqual([checkin]);
  expect((await local.state<DiaryState>()).scenario.drinks).toHaveLength(1);
});
