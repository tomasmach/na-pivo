import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { ready, start, stop } from './processes.mjs';
import { controlServer } from './control.mjs';
import { clearFixtureLocation, platform, setFixtureLocation } from './device.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runDir = process.env.NA_PIVO_E2E_RUN_DIR;
if (!runDir || !fs.existsSync(path.join(runDir, 'owner.json'))) throw new Error('Start with npm run e2e:critical or e2e:full.');
// e2e starts app.command only after preparing its native engine.
fs.writeFileSync(path.join(runDir, 'engine-ready'), 'ready\n');
const backendPort = process.env.NA_PIVO_E2E_BACKEND_PORT;
const metroPort = process.env.NA_PIVO_E2E_METRO_PORT;
const api = `http://127.0.0.1:${backendPort}`;
const env = {
  ...process.env, DEBUG: 'True', NA_PIVO_E2E: '1', PYTHON_DOTENV_DISABLED: '1',
  PYTHONPATH: root, DJANGO_SETTINGS_MODULE: 'e2e.backend.settings',
  EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', E2E_TELEMETRY_DISABLED: '1',
  EXPO_PUBLIC_BACKEND_MODE: 'local', EXPO_PUBLIC_BACKEND_URL: 'local',
  EXPO_PUBLIC_BACKEND_HOST: '127.0.0.1', EXPO_PUBLIC_BACKEND_PORT: backendPort,
  EXPO_PUBLIC_E2E: '1',
  // Presence-only OAuth controls. These IDs cannot authenticate a real client.
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'e2e-invalid.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'e2e-invalid-ios.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: 'com.googleusercontent.apps.e2e-invalid',
  NA_PIVO_SKIP_IOS_WIDGETS: '1', CI: '1',
  NODE_OPTIONS: '--dns-result-order=ipv4first',
};
const backendOptions = { cwd: path.join(root, 'backend'), env };
let backend;
let metro;
let migration;
let closing = false;
let control;
let httpControl;
let locationTimer;
function record() {
  const owned = [{ pid: process.pid }, migration, backend, metro].filter(child => child?.pid).flatMap(child => {
    try { return [{ pid: child.pid, started: execFileSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], { encoding: 'utf8' }).trim() }]; }
    catch { return []; }
  });
  fs.writeFileSync(path.join(runDir, 'processes.json'), JSON.stringify({ supervisor: process.pid, owned }), { mode: 0o600 });
}
async function online() {
  if (backend && backend.exitCode === null && !backend.signalCode) return;
  backend = start(path.join(root, 'backend/.venv/bin/python'), ['-m', 'uvicorn', 'config.asgi:application', '--host', '127.0.0.1', '--port', backendPort, '--no-access-log', '--log-level', 'critical'], backendOptions);
  record();
  await ready(`${api}/v1/health`, backend);
}
async function cleanup(code = 0) {
  if (closing) return;
  closing = true;
  clearInterval(locationTimer);
  try { clearFixtureLocation(); } catch { /* Owned emulator may already be stopped. */ }
  control?.close();
  httpControl?.close();
  await Promise.all([stop(migration), stop(backend), stop(metro)]);
  try { fs.unlinkSync(process.env.NA_PIVO_E2E_CONTROL_SOCKET); } catch { /* Not created. */ }
  process.exit(code);
}
process.on('SIGTERM', () => cleanup());
process.on('SIGINT', () => cleanup(130));
try {
  console.log(`Local E2E API: ${api}; SQLite: ${runDir}/test.sqlite3`);
  migration = start(path.join(root, 'backend/.venv/bin/python'), ['manage.py', 'migrate', '--noinput', '--verbosity', '0'], backendOptions);
  record();
  const migrationDeadline = setTimeout(() => cleanup(1), 90_000);
  const [migrationCode] = await once(migration, 'exit');
  clearTimeout(migrationDeadline);
  migration = undefined;
  if (migrationCode !== 0) throw new Error('Local E2E migration failed.');
  await online();
  if (platform === 'android') {
    // Expo's balanced current-position request accepts fixes at most 3s old.
    // The emulator has no physical receiver; supply the same fixed point while
    // this owned supervisor lives, including during backend outages.
    locationTimer = setInterval(() => {
      try { setFixtureLocation(); }
      catch { console.error('Owned emulator location update failed.'); void cleanup(1); }
    }, 1000);
  }
  if (process.env.NA_PIVO_E2E_CONTROL_PORT) {
    httpControl = controlServer({ online, offline: async () => { await stop(backend); backend = undefined; record(); } });
    httpControl.on('error', () => cleanup(1));
  }
  // A private Unix socket controls only this run's backend for offline tests.
  control = net.createServer(socket => {
    socket.once('data', async data => {
      try {
        if (data.toString().trim() === 'offline') { await stop(backend); backend = undefined; record(); }
        else if (data.toString().trim() === 'online') await online();
        else throw new Error('Unknown control command.');
        socket.end('ok');
      } catch { socket.end('error'); }
    });
  });
  control.on('error', () => cleanup(1));
  control.listen(process.env.NA_PIVO_E2E_CONTROL_SOCKET, () => fs.chmodSync(process.env.NA_PIVO_E2E_CONTROL_SOCKET, 0o600));
  metro = start(process.execPath, [path.join(root, 'node_modules/expo/bin/cli'), 'start', '--dev-client', '--localhost', '--port', metroPort], { cwd: root, env });
  record();
  metro.once('exit', () => { if (!closing) cleanup(1); });
  await ready(`http://127.0.0.1:${metroPort}/status`, metro);
} catch (error) { console.error(error.message); await cleanup(1); }
