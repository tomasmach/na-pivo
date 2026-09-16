#!/usr/bin/env node
// Detached state belongs to this checkout; stop only a matching runner process.
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = fs.realpathSync(path.join(__dirname, '..'));
const directory = path.join(root, '.expo');
const statePath = path.join(directory, 'dev-detached.json');
const logPath = path.join(directory, 'dev-detached.log');
const runner = path.join(root, 'scripts/dev-local.js');
function identity(pid) {
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    const started = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
    return command.includes(runner) ? started : null;
  } catch { return null; }
}
let state;
try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* First run. */ }
const running = state?.started && identity(state.pid) === state.started;
if (process.argv.includes('--stop')) {
  if (running) {
    process.kill(state.pid, 'SIGTERM');
    console.log(`==> Stopping this checkout's dev runner (${state.pid})`);
  } else console.log('==> No matching detached runner for this checkout; no process was stopped.');
  process.exit(0);
}
if (running) {
  console.log(`==> Validating the requested start against this checkout's running session (${state.pid})`);
  // Keep the original stop PID. Validate env/ports/migrations through the runner;
  // explicit iOS rebuilds and opening the app complete in this terminal.
  const result = spawnSync(process.execPath, [runner, ...process.argv.slice(2), '--reuse-only'], { cwd: root, env: process.env, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
fs.mkdirSync(directory, { recursive: true });
const out = fs.openSync(logPath, 'w', 0o600);
const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
  cwd: root, env: process.env, detached: true, stdio: ['ignore', out, out],
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('spawn', () => {
  fs.writeFileSync(statePath, JSON.stringify({ pid: child.pid, started: identity(child.pid) }), { mode: 0o600 });
  console.log(`==> Starting this checkout in the background (${child.pid}); inspect readiness in ${logPath}`);
  console.log('==> Stop from this checkout: npm run dev:stop');
  child.unref();
});
fs.closeSync(out);
