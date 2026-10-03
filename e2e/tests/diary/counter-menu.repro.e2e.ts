import { expect } from 'e2e';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from '../../helpers/test';
import { signIn } from '../../helpers/navigation';
import { countMenuBeer, openCounter, openLatestEvening, type DiaryState } from './ui';

// Small reproduction: the overflow's closing action must be exposed to iOS automation/VoiceOver.
test('counter overflow exposes its evening closing action', { tags: ['full', 'diary'], timeout: 240_000 }, async ({ app, screen, agent, device, local }) => {
  await local.reset('diary');
  await app.clearState();
  const ui = { app, screen, agent, device };
  await signIn(ui);
  await openCounter(ui);
  await countMenuBeer(ui);
  await expect.poll(async () => (await local.state<DiaryState>()).scenario.drinks.length).toBe(1);
  local.screenshot('diary-counter-surface');
  await screen.getByTestId('counter-more').tap();
  await delay(1000);
  local.screenshot('diary-counter-overflow');
  const { createAgentDeviceClient } = await import('agent-device');
  const client = createAgentDeviceClient({ session: `napivo-${process.env.NA_PIVO_E2E_DEVICE}-0` });
  for (const forceFull of [false, true]) {
    const snapshot = await client.capture.snapshot({ platform: 'ios', udid: process.env.NA_PIVO_E2E_DEVICE, interactiveOnly: false, noRecord: true, forceFull });
    if (snapshot.nodes.some(node => /textfield|secure|password/i.test(String(node.type)) || /@|password|heslo|e-?mail/i.test(node.label ?? ''))) throw new Error('Diagnostic snapshot contains a credential control.');
    const quality = (snapshot as typeof snapshot & { snapshotQuality?: { state?: unknown; backend?: unknown; reasonCode?: unknown; reason?: unknown; effectiveDepth?: unknown; timing?: unknown } }).snapshotQuality;
    console.log('SAFE_COUNTER_SNAPSHOT', JSON.stringify({ forceFull, truncated: snapshot.truncated, count: snapshot.nodes.length,
      quality: quality && { state: quality.state, backend: quality.backend, reasonCode: quality.reasonCode, reason: quality.reason, effectiveDepth: quality.effectiveDepth, timing: quality.timing },
      nodes: snapshot.nodes.map(({ type, label, identifier }) => ({ type, label, identifier })),
    }));
  }
  await expect(screen.getByLabel('Dopito, zavřít tenhle večer')).toBeVisible();
  await screen.getByLabel('Dopito, zavřít tenhle večer').tap();
  await screen.getByRole('button', 'Dopito').tap();
  await expect.poll(async () => (await local.state<DiaryState>()).scenario.visits[0]?.closed_at ?? null).not.toBeNull();
  expect((await local.state<DiaryState>()).scenario.drinks).toHaveLength(1);
  await openLatestEvening(ui);
  await agent.assert('Detail ukončeného večera obsahuje právě jedno pivo E2E Ležák za 41 Kč.');
  local.screenshot('diary-counter-closed-evening');
});
