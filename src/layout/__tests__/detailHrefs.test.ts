import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const ALLOWED = path.join('src', 'layout', 'openDetail.ts');

// A pushed pub, evening or friend profile skips the right half of a wide
// window. Openers go through openDetail (openPubPage, openEvening,
// openFriendProfile) instead.
const PATTERNS = [
  /pathname:\s*['"]\/(pub|evening|parta\/\[id\])['"]/,
  /`\/parta\/\$\{/,
  /['"]\/parta\/['"]\s*\+/,
  /\.(push|replace|navigate|dismissTo)\(\s*['"`]\/(pub|evening)(['"`?])/,
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('detail hrefs', () => {
  it('exist only in openDetail.ts', () => {
    const offenders = ['app', 'src']
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) => path.relative(ROOT, file) !== ALLOWED)
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ line, at: `${path.relative(ROOT, file)}:${index + 1}` }))
          .filter(({ line }) => PATTERNS.some((pattern) => pattern.test(line)))
          .map(({ at, line }) => `${at}  ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('would catch each way the screens used to build them', () => {
    const old = [
      "router.push({ pathname: '/evening', params: { startedAt } });",
      'router.push(`/parta/${account.id}` as Href);',
      "router.push({ pathname: '/parta/[id]', params: { id } } as Href);",
      "pathname: '/pub',",
    ];
    for (const line of old) expect(PATTERNS.some((pattern) => pattern.test(line))).toBe(true);
  });
});
