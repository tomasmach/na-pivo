import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { start, stop } from './processes.mjs';
import { summarize } from './report.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const commandStarted = Date.now();
const freeBytes = () => { const disk = fs.statfsSync(root); return disk.bavail * disk.bsize; };
if (freeBytes() < 30 * 1024 ** 3) throw new Error('Local E2E needs at least 30 GiB of free disk space before starting.');
process.chdir(root);
process.env.E2E_TELEMETRY_DISABLED = '1';
const args = process.argv.slice(2);
const engine = process.env.E2E_ENGINE === 'testerarmy' ? 'testerarmy' : 'maestro';
const repeat = args.includes('--stability') ? 3 : 1;
const switches = new Set(['--stability', '--no-cache', '--strict-cache']);
const filters = new Set(['--tag', '--exclude-tag', '--grep', '--grep-invert', '--tag-mode']);
for (let index = 0; index < args.length; index++) {
  if (switches.has(args[index])) continue;
  if (filters.has(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) { index++; continue; }
  if (/^e2e\/tests\/[a-z0-9_/*.-]+$/i.test(args[index]) && !args[index].includes('..')) continue;
  throw new Error(`Unsupported E2E option: ${args[index]}. Only test filters and cache switches are allowed.`);
}
if (engine === 'testerarmy' && repeat > 1 && args.includes('--no-cache')) throw new Error('--stability requires the replay cache.');
const slot = Number(process.env.E2E_SLOT || '1');
if (process.platform !== 'darwin') throw new Error('This runner requires macOS and an iPhone 17 simulator.');
if (![1, 2, 3].includes(slot)) throw new Error('E2E_SLOT must be 1, 2, or 3.');
const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
const lockRoot = path.join(gitDir, 'napivo-e2e');
fs.mkdirSync(lockRoot, { recursive: true });
const lock = path.join(lockRoot, `slot-${slot}.lock`);
try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, root }), { flag: 'wx', mode: 0o600 }); }
catch { throw new Error(`E2E slot ${slot} is owned by another run. Choose another E2E_SLOT; no process was stopped.`); }
let runner;
let device;
let closing = false;
let runDir;
let preparation;
let bootOwned = false;
let diskWatch;
const bootLock = path.join(lockRoot, 'boot.lock');
function releaseBoot() {
  if (!bootOwned) return;
  try {
    const owner = JSON.parse(fs.readFileSync(bootLock, 'utf8'));
    if (owner.pid === process.pid && owner.runDir === runDir) fs.rmSync(bootLock);
  } catch { /* Already released. */ }
  bootOwned = false;
}
async function acquireBoot() {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline && !closing) {
    try {
      fs.writeFileSync(bootLock, JSON.stringify({ pid: process.pid, runDir }), { flag: 'wx', mode: 0o600 });
      bootOwned = true;
      return;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    await delay(500);
  }
  if (closing) return;
  throw new Error('Another run still owns simulator startup. Inspect the shared boot.lock; no process was stopped.');
}
const simctl = (...argv) => execFileSync('xcrun', ['simctl', ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function cleanup(code) {
  if (closing) return;
  closing = true;
  clearInterval(diskWatch);
  await stop(preparation);
  // Capture members before terminating leaders; a child can outlive its parent.
  let ownedProcesses = [];
  try {
    const records = JSON.parse(fs.readFileSync(path.join(runDir, 'processes.json'), 'utf8')).owned;
    const cliRecord = path.join(runDir, 'maestro-process.json');
    if (fs.existsSync(cliRecord)) records.push(JSON.parse(fs.readFileSync(cliRecord, 'utf8')));
    const processes = execFileSync('ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' }).trim().split('\n').map(line => {
      const [, pid, pgid, started] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/) || [];
      // macOS pads every lstart column; record() trims the single-PID form.
      return { pid: Number(pid), pgid: Number(pgid), started: started?.trim() };
    });
    const groups = new Set(records.filter(record => processes.some(p => p.pid === record.pid && p.started === record.started)).map(record => record.pid));
    ownedProcesses = processes.filter(p => groups.has(p.pgid));
  } catch { /* No services started. */ }
  await stop(runner);
  if (runDir) {
    try {
      const stillOwned = owned => {
        try {
          const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(owned.pid)], { encoding: 'utf8' }).trim();
          return started === owned.started;
        } catch { return false; }
      };
      for (const owned of ownedProcesses) {
        if (stillOwned(owned)) { try { process.kill(owned.pid, 'SIGTERM'); } catch { /* Already stopped. */ } }
      }
      if (ownedProcesses.some(stillOwned)) await delay(4000);
      for (const owned of ownedProcesses) {
        if (stillOwned(owned)) { try { process.kill(owned.pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
      }
      for (let attempt = 0; attempt < 20 && ownedProcesses.some(stillOwned); attempt++) await delay(100);
    } catch { /* No service was started. */ }
  }
  if (device) {
    try { simctl('shutdown', device); } catch { /* Already down. */ }
    // simctl can return while CoreSimulator still reports "Shutting Down".
    // Finish that transition before releasing the slot for a subsequent run.
    try {
      for (let attempt = 0; attempt < 30; attempt++) {
        const inventory = Object.values(JSON.parse(simctl('list', 'devices', '--json')).devices).flat();
        if (inventory.find(candidate => candidate.udid === device)?.state === 'Shutdown') break;
        await delay(500);
      }
    } catch {
      console.error('Could not confirm shutdown of the owned simulator.');
      code ||= 1;
    }
  }
  // Maestro records evaluated fixture credentials even with report format NOOP.
  // Only disposable @example.test accounts are authorized, and their raw debug
  // output must not survive a successful, failed, or interrupted invocation.
  try {
    if (runDir) {
      for (const entry of fs.readdirSync(runDir)) {
        if (entry.startsWith('attempt-')) fs.rmSync(path.join(runDir, entry, 'private-debug'), { recursive: true, force: true });
      }
      fs.writeFileSync(path.join(runDir, 'command-metrics.json'), JSON.stringify({
        engine, durationSeconds: (Date.now() - commandStarted) / 1000, exitCode: code,
      }, null, 2), { mode: 0o600 });
    }
  } catch {
    console.error('Could not finish local E2E artifact cleanup or metrics. Inspect the owned run directory.');
    code ||= 1;
  } finally {
    releaseBoot();
    try { fs.rmSync(lock, { force: true }); }
    catch { console.error('Could not release the owned E2E slot lock.'); code ||= 1; }
    process.exit(code);
  }
}
process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));
async function freePort(port) {
  const server = net.createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  await new Promise(resolve => server.close(resolve));
}
try {
  const backendPort = 18120 + slot;
  const metroPort = 18220 + slot;
  const controlPort = 18320 + slot;
  await Promise.all([freePort(backendPort), freePort(metroPort), freePort(controlPort)]);
  const appPath = process.env.E2E_APP_PATH || path.join(root, '.e2e/build/Napivo.app');
  if (!fs.existsSync(appPath)) throw new Error('Build the local client first: npm run e2e:build');
  const runtimes = JSON.parse(simctl('list', 'runtimes', '--json')).runtimes;
  const runtime = runtimes.filter(r => r.isAvailable && r.identifier.includes('.iOS-')).at(-1);
  if (!runtime) throw new Error('Install an iOS simulator runtime in Xcode.');
  const id = crypto.randomUUID();
  runDir = path.join(root, '.e2e/runs', id);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const deviceFile = path.join(root, `.e2e/simulator-${slot}.json`);
  try {
    const prior = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
    const inventory = Object.values(JSON.parse(simctl('list', 'devices', 'available', '--json')).devices).flat();
    const match = inventory.find(d => d.udid === prior.udid && d.name === prior.name && d.state === 'Shutdown' && d.deviceTypeIdentifier === 'com.apple.CoreSimulator.SimDeviceType.iPhone-17');
    if (match) device = match.udid;
  } catch { /* First run in this worktree. */ }
  if (!device) {
    const name = `Na Pivo E2E ${slot} ${id.slice(0, 8)}`;
    device = simctl('create', name, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime.identifier);
    fs.writeFileSync(deviceFile, JSON.stringify({ name, udid: device }), { mode: 0o600 });
  }
  fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify({ pid: process.pid, root, device, slot, backendPort, metroPort, controlPort }), { mode: 0o600 });
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', E2E_TELEMETRY_DISABLED: '1',
    NA_PIVO_E2E_RUN_DIR: runDir, NA_PIVO_E2E_DEVICE: device,
    NA_PIVO_E2E_CONTROL_SOCKET: `/tmp/napivo-e2e-${id}.sock`,
    NA_PIVO_E2E_BACKEND_PORT: String(backendPort), NA_PIVO_E2E_METRO_PORT: String(metroPort),
    NA_PIVO_E2E_CONTROL_PORT: String(controlPort),
    NA_PIVO_E2E_APP_PATH: appPath,
    NA_PIVO_E2E_EMAIL: `e2e-${id}@example.test`,
    NA_PIVO_E2E_PASSWORD: crypto.randomBytes(24).toString('base64url'),
    NA_PIVO_E2E_NEW_PASSWORD: crypto.randomBytes(24).toString('base64url'),
    ...(process.env.XDG_CONFIG_HOME ? { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME } : {}),
    ...(process.env.E2E_MAESTRO_PATH ? { E2E_MAESTRO_PATH: process.env.E2E_MAESTRO_PATH } : {}),
  };
  diskWatch = setInterval(() => {
    if (freeBytes() < 20 * 1024 ** 3) {
      console.error('Free disk space fell below the 20 GiB safety reserve. Stopping only this run.');
      void cleanup(75);
    }
  }, 1000);
  console.log(`E2E slot ${slot}; iPhone 17 ${device}; API ${backendPort}; Metro ${metroPort}`);
  for (let index = 1; index <= repeat; index++) {
    // agent-device shares a daemon: a cold-boot timeout can reset other sessions.
    // Serialize only preparation, then let isolated tests run concurrently.
    await acquireBoot();
    if (closing) break;
    fs.rmSync(path.join(runDir, 'engine-ready'), { force: true });
    preparation = start('xcrun', ['simctl', 'bootstatus', device, '-b'], { cwd: root, env });
    const bootDeadline = setTimeout(() => cleanup(124), 180_000);
    const [bootCode] = await once(preparation, 'exit');
    clearTimeout(bootDeadline);
    preparation = undefined;
    if (closing) break;
    if (bootCode !== 0) throw new Error('Owned iPhone failed to boot.');
    const output = path.join(runDir, `attempt-${index}`);
    const runArgs = args.filter(arg => arg !== '--stability');
    if (engine === 'testerarmy' && index > 1) runArgs.push('--strict-cache');
    const command = engine === 'testerarmy'
      ? [path.join(root, 'node_modules/e2e/dist/cli/bin.js'), 'run', ...runArgs, '--output', output]
      : [path.join(root, 'e2e/runtime/maestro.mjs'), ...runArgs];
    runner = start(process.execPath, command, { cwd: root, env: { ...env, NA_PIVO_E2E_OUTPUT: output } });
    const preparationWatch = setInterval(() => {
      if (fs.existsSync(path.join(runDir, 'engine-ready'))) { releaseBoot(); clearInterval(preparationWatch); }
    }, 250);
    const watchdog = setTimeout(() => cleanup(124), 2 * 60 * 60 * 1000);
    const [code] = await once(runner, 'exit');
    clearTimeout(watchdog);
    clearInterval(preparationWatch);
    if (closing) break;
    releaseBoot();
    if (code !== 0) { await cleanup(code || 1); break; }
    const metrics = engine === 'testerarmy' ? summarize(path.join(output, 'report.json')) : JSON.parse(fs.readFileSync(path.join(output, 'metrics.json'), 'utf8'));
    fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
    console.log(`Verified run ${index}: ${JSON.stringify(metrics)}`);
    if (engine === 'testerarmy' && index > 1 && (metrics.handedOff > 0 || metrics.missed > 0)) throw new Error('Stability run required complete replay, but an agent.act missed or handed off.');
  }
  await cleanup(0);
} catch (error) { console.error(error.message); await cleanup(1); }
