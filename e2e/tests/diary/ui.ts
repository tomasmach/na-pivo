import { execFileSync } from 'node:child_process';
import type { Device } from '@e2e-dev/mobile';
import { expect, type TestFixtures } from 'e2e';
import { dismissPubReminder, openRoute } from '../../helpers/navigation';

export type DiaryUI = Pick<TestFixtures, 'app' | 'screen' | 'agent'> & { device: Device };
export type DiaryState = {
  drinks: { client_id: string; beer_name: string; price_czk: number; volume_ml: number; place_context: string; drink_type: string; drank_at: string; name: string; external_id: string }[];
  visits: { client_id: string; name: string; started_at: string; ended_at: string | null; closed_at: string | null }[];
  checkins: { client_id: string; beer_name: string; brewery_name: string; rating: string; tags: string[]; pub_name: string; visit_client_id: string | null; visibility: string; checked_in_at: string }[];
  nights: { client_id: string; beer_count: number; pub_names: string[]; visibility: string; is_removed: boolean }[];
  stats: { total_beers: number; total_evenings: number; distinct_pubs: number; total_spent_czk: number };
  plans: { id: string; title: string; owner: string; scheduledDate: string | null; scheduledTime: string | null; stops: { client_id: string; name: string; position: number }[] }[];
  shares: { plan_id: string; revoked_at: string | null }[];
  publications: { planId: string; status: string; title: string; snapshotKeys: string[]; stopNames: string[] }[];
};

export async function openCounter(ui: DiaryUI) {
  await openRoute(ui, '/beer');
  if (await ui.screen.getByRole('button', 'Not Now').isVisible()) await ui.screen.getByRole('button', 'Not Now').tap();
  if (await ui.screen.getByRole('button', 'Teď ne, nech mě pít v klidu').isVisible()) await ui.screen.getByRole('button', 'Teď ne, nech mě pít v klidu').tap();
  await expect(ui.screen.getByTestId('counter-primary')).toBeVisible();
}

export async function countMenuBeer(ui: DiaryUI) {
  await ui.agent.act('V počítadle zapiš právě jedno pivo z nabídky E2E U Testera: E2E Ležák za 41 Kč, objem 0,5 l. Pokud musíš vybrat hospodu, vyber E2E U Testera. Nepřidávej žádné další pivo.');
}

export async function countOtherBeer(ui: DiaryUI, name: string, price: number) {
  await ui.screen.getByLabel('Vybrat jiné pivo nebo drink').tap();
  await ui.screen.getByLabel('Přidat nové pivo').tap();
  await ui.screen.getByTestId('beer-form-name').fill(name);
  await ui.screen.getByTestId('beer-form-price').fill(String(price));
  await ui.device.dismissKeyboard();
  await ui.screen.getByTestId('beer-form-submit').tap();
  await ui.screen.getByRole('button', 'Ještě jedno').tap();
}

export async function openDiary(ui: DiaryUI) {
  await openRoute(ui, '/beer');
  await ui.screen.getByTestId('diary-segment').tap();
}

export async function openLatestEvening(ui: DiaryUI) {
  await openDiary(ui);
  await ui.screen.getByTestId('diary-latest-evening').tap();
}

export async function finishEvening(ui: DiaryUI) {
  await ui.screen.getByTestId('counter-more').tap();
  await ui.screen.getByLabel('Dopito, zavřít tenhle večer').tap();
  await ui.screen.getByRole('button', 'Dopito').tap();
}

export async function createTour(ui: DiaryUI, title: string) {
  await openRoute(ui, '/tours');
  await ui.screen.getByRole('button', 'Naplánovat tour').tap();
  await ui.agent.act('Ve výběru hospod přidej přesně E2E U Testera jako první a E2E Druhá hospoda jako druhou. Nepřidávej další hospodu, zatím neukládej tour.');
  await ui.screen.getByTestId('tour-picker-done').tap();
  await ui.screen.getByTestId('tour-title').fill(title);
  await ui.device.dismissKeyboard();
}

/** The private capability stays in memory and never enters a model prompt/report. */
export function copiedTourToken(): string {
  try {
    const clipboard = execFileSync('xcrun', ['simctl', 'pbpaste', process.env.NA_PIVO_E2E_DEVICE!], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const token = new URL(clipboard.trim()).pathname.split('/').at(-1)!;
    if (/^[A-Za-z0-9_-]{16,128}$/.test(token)) return token;
  } catch { /* Do not include URL parser input or native stdout in a report. */ }
  throw new Error('Expected a synthetic tour capability in the simulator clipboard.');
}

export async function openTourToken(ui: DiaryUI, token: string) {
  try {
    execFileSync('xcrun', ['simctl', 'openurl', process.env.NA_PIVO_E2E_DEVICE!, `napivo://t/${token}`], { stdio: 'ignore' });
  } catch { throw new Error('Synthetic tour deep link could not be opened.'); }
  if (await ui.screen.getByRole('button', 'Open').isVisible()) await ui.screen.getByRole('button', 'Open').tap();
}

export async function openCreatedTour(ui: DiaryUI, title: string) {
  await openRoute(ui, '/tours');
  await ui.agent.act(`Otevři uloženou tour ${title}. Pokud se zobrazí připomínka, odmítni ji. Nic nezapisuj.`);
  await expect(ui.screen.getByText(title)).toBeVisible();
}

export async function restartDiaryApp(ui: DiaryUI) {
  await ui.app.restart();
  await dismissPubReminder(ui);
}
