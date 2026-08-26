/**
 * The "posledních 50 večerů" limit only exists without an account, so a
 * signed-in user must never be told about it.
 *
 * DiaryScreen cannot be imported here (jest runs without the expo-react-native
 * preset), so the branch is checked the way the other diary regressions are:
 * the copy from `cs.ts` plus the composition in the screen source.
 */
import * as fs from 'fs';
import * as path from 'path';

import { cs } from '@/i18n/cs';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'DiaryScreen.tsx'),
  'utf8',
);

it('keeps the no-account limit in its own sentence', () => {
  expect(cs.diary.statsFooter).not.toContain('Bez účtu');
  expect(cs.diary.statsFooterNoAccount).toContain('Bez účtu');
});

it('appends the no-account sentence only when nobody is signed in', () => {
  expect(source).toContain('export function statsFooterCopy(signedIn: boolean)');
  expect(source).toContain('signedIn\n    ? t.diary.statsFooter');
  expect(source).toContain('${t.diary.statsFooter} ${t.diary.statsFooterNoAccount}');
  expect(source).toContain('footer={statsFooterCopy(signedIn)}');
});
