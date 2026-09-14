/**
 * Source-level guard: UI code reads copy through `t` from '@/i18n' and formats
 * dates and numbers with `intlLocale`, so English keeps working as screens
 * change. Tests and the i18n folder itself are exempt.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..');
const SCAN_DIRS = ['app', 'src'];
const SKIP = [/__tests__/, /__mocks__/, /__diag__/, /\/src\/i18n\//, /\.d\.ts$/];

/** Files that must keep a fixed Czech collation on purpose (identity keys). */
const FIXED_LOCALE_ALLOWLIST = new Set(['src/data/pubIdentity.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
  .map((f) => path.relative(ROOT, f))
  .filter((f) => !SKIP.some((re) => re.test(`/${f}`)));

describe('i18n discipline', () => {
  it('never imports the Czech strings object directly', () => {
    const offenders = files.filter((f) =>
      /from ['"]@\/i18n\/(cs|en|plural|enHelpers)['"]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('never hardcodes the cs-CZ Intl locale', () => {
    const offenders = files.filter(
      (f) => !FIXED_LOCALE_ALLOWLIST.has(f) && /['"]cs-CZ['"]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
