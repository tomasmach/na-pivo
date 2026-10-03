import { expect } from 'e2e';
import { test } from '../../helpers/test';
import { openRoute, signIn } from '../../helpers/navigation';
import { countMenuBeer, finishEvening, openCounter, openLatestEvening, restartDiaryApp, type DiaryState } from './ui';

test('offline night publication syncs on foreground and survives restart', { tags: ['full', 'diary'], timeout: 420_000 }, async ({ app, screen, agent, device, local }) => {
  await local.reset('diary');
  await app.clearState();
  const ui = { app, screen, agent, device };
  await signIn(ui);
  await openCounter(ui);
  await countMenuBeer(ui);
  await finishEvening(ui);
  await openLatestEvening(ui);
  expect((await local.state<DiaryState>()).scenario.nights).toHaveLength(0);
  await local.offline();
  await screen.getByLabel('Vyvěsit noc na Výčep').tap();
  await agent.act('Vyvěs tuhle noc s právě jedním pivem pouze pro Partu. Potvrď publikaci a počkej, až se formulář zavře. Znovu nepublikuj.');
  await agent.assert('Detail večera označuje noc jako vyvěšenou pro Partu.');
  await restartDiaryApp(ui);
  await openLatestEvening(ui);
  await agent.assert('Detail večera má noc označenou jako vyvěšená pro Partu.');
  await local.online();
  await device.home();
  await app.open();
  try {
    await expect.poll(async () => (await local.state<DiaryState>()).scenario.nights, { timeout: 25_000 }).toHaveLength(1);
  } catch (error) {
    local.screenshot('diary-vycep-foreground-not-synced');
    throw error;
  }
  const published = (await local.state<DiaryState>()).scenario.nights[0];
  expect(published).toMatchObject({ beer_count: 1, pub_names: ['E2E U Testera'], visibility: 'friends', is_removed: false });
  await restartDiaryApp(ui);
  await openLatestEvening(ui);
  await agent.assert('Detail večera má noc označenou jako vyvěšená pro Partu.');
  await openRoute(ui, '/vycep');
  await agent.assert('Ve Výčepu pro Partu je právě jedna moje noc v E2E U Testera s jedním pivem.');
  local.screenshot('diary-vycep-published');
  expect((await local.state<DiaryState>()).scenario.nights).toEqual([published]);
});
