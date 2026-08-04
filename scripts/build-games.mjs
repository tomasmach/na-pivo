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
 * Run it whenever anything under `src/games/web/` changes. It is deliberately
 * not wired into `npm run dev`: a build step that runs on every start is a build
 * step people learn to wait for.
 */

import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const GAMES = [{ key: 'dice', entry: 'src/games/web/dice/main.ts' }];

/** No margins, no scroll, no text selection — it is a table, not a document. */
const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #15120F; }
  body { -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  canvas { display: block; width: 100%; height: 100%; }
`;

for (const game of GAMES) {
  const result = await build({
    entryPoints: [resolve(root, game.entry)],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['safari15', 'chrome90'],
    write: false,
    logLevel: 'warning',
  });

  const js = result.outputFiles[0].text;
  const html = `<!doctype html>
<html lang="cs">
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

  const out = resolve(root, `assets/games/${game.key}.html`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`built assets/games/${game.key}.html — ${kb} kB`);
}
