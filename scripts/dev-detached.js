#!/usr/bin/env node
/**
 * `npm run dev`, in its own session.
 *
 * The plain runner is a child of whatever shell started it, and when that shell
 * goes away — an agent finishing a turn, a closed terminal, tmux being killed —
 * the process group is signalled and Metro and the backend die with it. The app
 * stays installed on a booted simulator with nothing to talk to, which looks
 * exactly like Metro "not working".
 *
 * `detached: true` puts the runner in a new session, so that signal cannot
 * reach it. It keeps running until you stop it:
 *
 *   npm run dev:stop
 *
 * Interactively, prefer plain `npm run dev` — you want Ctrl+C to tidy up.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LOG = '/tmp/napivo-dev.log';
const PID = '/tmp/napivo-dev.pid';

const out = fs.openSync(LOG, 'w');
const child = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NAPIVO_KEEP_SIM: '1' },
  detached: true,
  stdio: ['ignore', out, out],
});
child.unref();

fs.writeFileSync(PID, String(child.pid));
console.log(`==> Běží odpojeně, pid ${child.pid}`);
console.log(`==> Log:   tail -f ${LOG}`);
console.log('==> Stop:  npm run dev:stop');
