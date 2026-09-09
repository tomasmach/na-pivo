#!/usr/bin/env node
// Local ASGI + Metro, with iOS builds only when the installed native client changes.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const root = fs.realpathSync(path.join(__dirname, '..'));
const backend = path.join(root, 'backend');
const args = process.argv.slice(2);
const metroOnly = args.includes('--metro');
const forceBuild = args.includes('--rebuild');
const reuseOnly = args.includes('--reuse-only');
const children = new Set();
let stateFile;
let stopping = false;

function output(command, argv, cwd = root) {
  return execFileSync(command, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
}
function port(value, fallback) {
  const number = Number(value || fallback);
  if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('Use a port from 1024 to 65535.');
  return number;
}
function listeners(number) {
  try { return output('lsof', ['-nP', `-iTCP:${number}`, '-sTCP:LISTEN', '-t']).split('\n'); } catch { return []; }
}
function ownsListener(number, group, cwd) {
  const pids = listeners(number);
  return pids.length > 0 && pids.every(pid => {
    try {
      return Number(output('ps', ['-o', 'pgid=', '-p', pid])) === group &&
        output('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).split('\n').includes(`n${cwd}`);
    } catch { return false; }
  });
}
function start(command, argv, cwd = root, env = process.env) {
  const child = spawn(command, argv, { cwd, env, detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
  children.add(child);
  child.on('exit', () => children.delete(child));
  child.on('error', error => { console.error(error.message); stop(1); });
  return child;
}
function run(command, argv, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = start(command, argv, cwd, env);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)));
  });
}
async function responds(url, expected) {
  try {
    const result = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return result.ok && (!expected || (await result.text()).includes(expected));
  } catch { return false; }
}
async function ready(child, url, expected) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error(`Process exited before ${url} answered.`);
    if (await responds(url, expected)) return;
    await delay(500);
  }
  throw new Error(`${url} did not answer within 30 seconds.`);
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Each child has its own session. Never kill by port or shut down a simulator.
  const owned = [...children];
  for (const child of owned) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  await Promise.race([
    Promise.all(owned.map(child => child.exitCode !== null || child.signalCode ? null :
      new Promise(resolve => child.once('exit', resolve)))),
    delay(5000),
  ]);
  for (const child of owned) {
    // The wrapper can exit before a reloader descendant. The group still belongs
    // to this invocation even after its leader exits.
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Group already exited. */ }
  }
  if (stateFile && readJson(stateFile)?.ownerPid === process.pid) fs.rmSync(stateFile, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop());
process.on('SIGHUP', () => stop());

async function iosClient() {
  const devices = JSON.parse(output('xcrun', ['simctl', 'list', 'devices', 'available', '--json']));
  const available = Object.entries(devices.devices).filter(([runtime]) => runtime.includes('.iOS-')).flatMap(([, items]) => items).filter(device => device.isAvailable);
  const phones = available.filter(device => (device.deviceTypeIdentifier || device.name).includes('iPhone'));
  const requested = process.env.EXPO_IOS_DEVICE;
  const booted = phones.filter(device => device.state === 'Booted');
  if (!requested && booted.length > 1) throw new Error('Multiple iPhones are booted. Set EXPO_IOS_DEVICE to the intended UDID.');
  const device = requested ? available.find(item => item.udid === requested || item.name === requested) : booted[0] || phones[0];
  if (!device) throw new Error('No matching iPhone simulator. Create one in Xcode or set EXPO_IOS_DEVICE.');
  if (device.state !== 'Booted') {
    await run('xcrun', ['simctl', 'boot', device.udid]);
    await run('xcrun', ['simctl', 'bootstatus', device.udid, '-b']);
  }
  console.log(`==> Checking native client (${device.name})`);
  const { createFingerprintAsync } = require('expo/fingerprint');
  const { hash } = await createFingerprintAsync(root, {
    platforms: ['ios'], silent: true,
    extraSources: [
      { type: 'file', filePath: 'package-lock.json', reasons: ['Locked native dependencies'] },
      { type: 'dir', filePath: 'scripts', reasons: ['Local native patches and build commands'] },
    ],
  });
  const bundle = require('expo/config').getConfig(root).exp.ios.bundleIdentifier;
  const common = output('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const stamp = path.join(common, 'napivo-dev-clients', `${device.udid}.json`);
  function installedIdentity() {
    try {
      const app = output('xcrun', ['simctl', 'get_app_container', device.udid, bundle, 'app']);
      // The signed code directory covers native libraries/resources, including
      // Debug dylibs whose launcher executable may stay unchanged across builds.
      const signed = require('node:child_process').spawnSync('codesign', ['-d', '--verbose=4', app], { encoding: 'utf8' });
      const codeHash = `${signed.stdout || ''}\n${signed.stderr || ''}`.match(/^CDHash=(.+)$/m)?.[1];
      if (signed.status !== 0 || !codeHash) return null;
      return `${app}:${codeHash}`;
    } catch { return null; }
  }
  const previous = readJson(stamp);
  const identity = installedIdentity();
  if (forceBuild || !identity || previous?.hash !== hash || previous?.identity !== identity) {
    console.log('==> Native inputs changed or no verified client is installed; building iOS locally');
    await run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--clean', '--platform', 'ios', '--no-install']);
    await run('pod', ['install'], path.join(root, 'ios'));
    await run('npm', ['run', 'ios:local', '--', '--device', device.udid, '--no-bundler']);
    const built = installedIdentity();
    if (!built) throw new Error('The iOS build did not install the expected app.');
    writeJson(stamp, { hash, identity: built });
  } else {
    console.log('==> Compatible iOS client found; skipping prebuild, CocoaPods and Xcode build');
  }
  return device.udid;
}

async function main() {
  if (args.includes('--help')) {
    console.log('npm run dev [-- --metro | --rebuild]\n  --metro    Start local ASGI and Metro; use an already compatible native client.\n  --rebuild  Rebuild the local iOS simulator client.\nPorts: EXPO_PUBLIC_BACKEND_PORT (8012), EXPO_METRO_PORT (8081).\niOS device: EXPO_IOS_DEVICE (UDID or name).');
    return;
  }
  if (args.some(arg => !['--metro', '--rebuild', '--reuse-only'].includes(arg)) || (metroOnly && forceBuild)) throw new Error('Invalid options. Use npm run dev -- --help.');
  if (!metroOnly && process.platform !== 'darwin') throw new Error('iOS requires macOS. Use npm run dev -- --metro for the local backend and Metro.');
  process.chdir(root);
  process.env.NODE_ENV ||= 'development';
  const expoRequire = require('node:module').createRequire(require.resolve('expo/package.json'));
  expoRequire('@expo/env').load(root);
  const backendPort = port(process.env.EXPO_PUBLIC_BACKEND_PORT, 8012);
  const metroPort = port(process.env.EXPO_METRO_PORT, 8081);
  if (backendPort === metroPort) throw new Error('Backend and Metro need different ports.');
  process.env.EXPO_PUBLIC_BACKEND_MODE = 'local';
  process.env.EXPO_PUBLIC_BACKEND_URL = 'local';
  process.env.EXPO_PUBLIC_BACKEND_PORT = String(backendPort);
  process.env.NA_PIVO_SKIP_IOS_WIDGETS ??= '1';
  process.env.LANG ||= 'en_US.UTF-8';
  process.env.LC_ALL ||= process.env.LANG;
  // Local verification must never migrate a DB selected by production credentials.
  const backendEnv = { ...process.env, DATABASE_URL: `sqlite:///${backend}/db.sqlite3`, DEBUG: 'True' };
  const signature = crypto.createHash('sha256').update(JSON.stringify({
    root, backendPort, metroPort,
    env: Object.entries(process.env).filter(([key]) => key.startsWith('EXPO_PUBLIC_')).sort(),
    files: ['package-lock.json', 'backend/.env', 'backend/pyproject.toml', 'backend/uv.lock',
      ...fs.readdirSync(path.join(backend, 'pubs/migrations')).filter(file => file.endsWith('.py')).sort().map(file => `backend/pubs/migrations/${file}`),
    ].map(file => fs.existsSync(path.join(root, file)) ? crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') : null),
  })).digest('hex');
  stateFile = path.join(root, '.expo', `dev-local-${metroPort}.json`);
  const previous = readJson(stateFile);
  const health = `http://127.0.0.1:${backendPort}/v1/health`;
  const metroStatus = `http://127.0.0.1:${metroPort}/status`;
  const reuse = previous?.signature === signature &&
    ownsListener(backendPort, previous.backendPid, backend) &&
    ownsListener(metroPort, previous.metroPid, root) &&
    await responds(health) && await responds(metroStatus, 'packager-status:running');
  if (reuseOnly && !reuse) throw new Error('The running session does not match these ports, settings or migrations. Stop it with npm run dev:stop from this checkout before restarting.');
  if (!reuse && (listeners(backendPort).length || listeners(metroPort).length)) {
    throw new Error('A requested port belongs to another or unverified dev session. Reuse its checkout or choose free EXPO_PUBLIC_BACKEND_PORT and EXPO_METRO_PORT values. No process was stopped.');
  }
  if (reuse) {
    console.log(`==> Reusing this checkout's backend and Metro on ${backendPort}/${metroPort}`);
  } else {
    if (previous?.ownerPid) {
      try { process.kill(previous.ownerPid, 0); throw new Error('This checkout is already starting. Wait for its ready message.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    if (previous) fs.rmSync(stateFile);
    fs.writeFileSync(stateFile, JSON.stringify({ ownerPid: process.pid }), { flag: 'wx', mode: 0o600 });
    console.log(`==> Local API: http://127.0.0.1:${backendPort}; database: ${backend}/db.sqlite3`);
    await run('uv', ['run', 'python', 'manage.py', 'migrate'], backend, backendEnv);
    const server = start('uv', ['run', '--extra', 'prod', 'uvicorn', 'config.asgi:application',
      '--host', '0.0.0.0', '--port', String(backendPort), '--reload', '--reload-dir', backend,
      '--timeout-graceful-shutdown', '3'], backend, backendEnv);
    await ready(server, health);
    const metro = start(process.execPath, [require.resolve('expo/bin/cli'), 'start', '--dev-client', '--lan', '--port', String(metroPort)], root,
      { ...process.env, CI: '0' });
    await ready(metro, metroStatus, 'packager-status:running');
    writeJson(stateFile, { ownerPid: process.pid, signature, backendPid: server.pid, metroPid: metro.pid });
    for (const child of [server, metro]) child.on('exit', () => { if (!stopping) { console.error('A local dev process exited.'); stop(1); } });
  }
  if (!metroOnly) {
    const device = await iosClient();
    await run('open', ['-a', 'Simulator']);
    await run('xcrun', ['simctl', 'openurl', device,
      `napivo://expo-development-client/?url=${encodeURIComponent(`http://127.0.0.1:${metroPort}`)}`]);
  }
  console.log(`==> Ready: ${root} (API ${backendPort}, Metro ${metroPort})`);
  if (metroOnly) console.log('==> Native client compatibility and the native screen have not been verified by --metro.');
  if (reuse) return;
  console.log('==> Ctrl+C stops only the processes started here. The simulator stays open.');
}

main().catch(error => { console.error(error.message); stop(1); });
