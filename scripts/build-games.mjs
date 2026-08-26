/**
 * Builds each WebView game into ONE self-contained HTML file.
 *
 * three.js and cannon-es are inlined, so the page needs no network at runtime —
 * a pub is exactly where there is none — and no asset resolution beyond the one
 * file. The output is committed, so a clean checkout runs without this script
 * and `eas update` ships a changed game over the air without a store release.
 *
 *   npm run build:games
 *
 * With `--check` nothing is written: every game is built in memory and compared
 * byte-for-byte against the committed `assets/games/*.html`, exiting nonzero and
 * listing every stale or missing file if they differ. CI uses this so a forgotten
 * rebuild fails loudly instead of shipping an old game over the air.
 *
 * Set `NAPIVO_GAMES_OUTPUT_ROOT` to redirect where the HTML files are read and
 * written (tests use a temp directory); source resolution always stays in-repo.
 *
 * Run it whenever anything under `src/games/web/` changes. It is deliberately
 * not wired into `npm run dev`: a build step that runs on every start is a build
 * step people learn to wait for.
 *
 * If a game route ever dies with "Cannot read property 'ErrorBoundary' of
 * undefined", that is Metro holding a cache from before `.html` was added to
 * `assetExts` in `metro.config.js`. The route's import fails and expo-router
 * reports it as that, which points nowhere near the cause. `npx expo start
 * --clear` fixes it.
 */

import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Only output paths move; entries, alias and everything source-side stay in-repo.
const outputRoot = process.env.NAPIVO_GAMES_OUTPUT_ROOT
  ? resolve(process.env.NAPIVO_GAMES_OUTPUT_ROOT)
  : root;

const checkOnly = process.argv.slice(2).includes('--check');
const unknownFlags = process.argv.slice(2).filter((arg) => arg !== '--check');
if (unknownFlags.length > 0) {
  console.error(`unknown arguments: ${unknownFlags.join(' ')} — supported: [--check]`);
  process.exit(2);
}

const GAMES = [
  { key: 'dice', entry: 'src/games/web/dice/main.ts' },
  { key: 'bottle', entry: 'src/games/web/bottle/main.ts' },
  { key: 'wheel', entry: 'src/games/web/wheel/main.ts' },
];

/**
 * No margins, no scroll, no text selection — it is a table, not a document.
 *
 * The page paints NO background of its own. It used to fill itself with the
 * app's stout, which made the canvas a hard-edged rectangle sitting on top of
 * the screen instead of part of it; the host now owns the surface and its
 * corner radius, and the page draws only the prop.
 */
const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
  body { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  canvas { display: block; width: 100%; height: 100%; }
`;

/** Relative paths in logs and check reports are always repo-relative. */
const relPath = (key) => `assets/games/${key}.html`;

/** Builds one game to its final normalized HTML, entirely in memory. */
async function buildGameHtml(game) {
  const result = await build({
    entryPoints: [resolve(root, game.entry)],
    bundle: true,
    // The game imports the shared protocol and SDK by alias, exactly as the app
    // does, so one definition serves both sides and neither can drift.
    alias: { '@': resolve(root, 'src') },
    loader: { '.png': 'dataurl', '.webp': 'dataurl' },
    minify: true,
    format: 'iife',
    target: ['safari15', 'chrome90'],
    write: false,
    logLevel: 'warning',
  });

  const js = result.outputFiles[0].text;
  // No lang attribute: the page draws no words of its own. Every label the
  // table reads is passed in by the host in the app's language.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
<title>${game.key}</title>
<style>${CSS}</style>
</head>
<body>
<script>${js}</script>
</body>
</html>`;

  // Strip trailing spaces/tabs per line and spaces before leading tab
  // indentation — esbuild-inlined shaders carry both and the release diff-check flags them.
  return Buffer.from(
    html.replace(/[ \t]+$/gm, '').replace(/^( +)\t/gm, '\t'),
    'utf8',
  );
}

if (checkOnly) {
  const stale = [];
  for (const game of GAMES) {
    const expected = await buildGameHtml(game);
    let actual;
    try {
      actual = await readFile(resolve(outputRoot, relPath(game.key)));
    } catch {
      stale.push(relPath(game.key));
      continue;
    }
    if (!actual.equals(expected)) stale.push(relPath(game.key));
  }

  if (stale.length > 0) {
    console.error(
      `stale generated games — run \`npm run build:games\` and commit:\n${stale.map((p) => `  ${p}`).join('\n')}`,
    );
    process.exit(1);
  }
  console.log(`all ${GAMES.length} generated games are up to date`);
} else {
  for (const game of GAMES) {
    const normalized = await buildGameHtml(game);
    const out = resolve(outputRoot, relPath(game.key));
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, normalized);
    const kb = Math.round(normalized.byteLength / 1024);
    console.log(`built ${relPath(game.key)} — ${kb} kB`);
  }
}
