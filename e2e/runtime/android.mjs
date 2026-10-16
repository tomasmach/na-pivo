import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { start } from './processes.mjs';
import { sdkPath } from './device.mjs';

/** Create or reuse only an idle AVD previously created by this checkout. */
export function startAndroid({ root, runDir, slot, id, env, onStart }) {
  const sdk = sdkPath();
  const avdRoot = path.join(root, '.e2e/android-avds');
  const deviceFile = path.join(root, `.e2e/android-${slot}.json`);
  const adb = path.join(sdk, 'platform-tools/adb');
  const emulator = path.join(sdk, 'emulator/emulator');
  const avdmanager = path.join(sdk, 'cmdline-tools/latest/bin/avdmanager');
  const systemImage = 'system-images;android-36.1;google_apis_playstore;arm64-v8a';
  for (const required of [adb, emulator, avdmanager, path.join(sdk, 'system-images/android-36.1/google_apis_playstore/arm64-v8a/system.img')]) {
    if (!fs.existsSync(required)) throw new Error('Android E2E requires the installed ARM64 API 36.1 image and SDK tools; nothing was downloaded.');
  }
  fs.mkdirSync(avdRoot, { recursive: true, mode: 0o700 });
  const androidEnv = { ...env, ANDROID_HOME: sdk, ANDROID_AVD_HOME: avdRoot };
  const exec = (command, args, options = {}) => execFileSync(command, args, {
    env: androidEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, ...options,
  });
  const running = exec(adb, ['devices']).split('\n').flatMap(line => {
    const match = line.match(/^(emulator-\d+)\s+device$/);
    if (!match) return [];
    try { return [exec(adb, ['-s', match[1], 'emu', 'avd', 'name']).trim().split(/\r?\n/)[0]]; }
    catch { throw new Error('Could not verify ownership of active Android emulators.'); }
  });
  let name;
  try {
    const prior = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
    if (/^napivo-e2e-[1-3]-[a-f0-9-]+$/.test(prior.name) && !running.includes(prior.name) &&
      /^hw\.device\.name\s*=\s*pixel_10\s*$/m.test(fs.readFileSync(path.join(avdRoot, `${prior.name}.avd/config.ini`), 'utf8'))) name = prior.name;
  } catch { /* First Android run in this worktree. */ }
  if (!name) {
    name = `napivo-e2e-${slot}-${id.slice(0, 8)}`;
    const directory = path.join(avdRoot, `${name}.avd`);
    exec(avdmanager, ['create', 'avd', '--name', name, '--package', systemImage, '--device', 'pixel_10', '--path', directory], {
      input: 'no\n', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
    });
    const configPath = path.join(directory, 'config.ini');
    let config = fs.readFileSync(configPath, 'utf8');
    if (!/^hw\.device\.name\s*=\s*pixel_10\s*$/m.test(config)) throw new Error('E2E requires the Pixel 10 device profile.');
    for (const [key, value] of Object.entries({ 'hw.ramSize': '2048', 'disk.dataPartition.size': '4G', 'hw.cpu.ncore': '2' })) {
      config = config.split('\n').filter(line => !line.startsWith(`${key}=`)).join('\n') + `\n${key}=${value}\n`;
    }
    fs.writeFileSync(configPath, config);
    fs.writeFileSync(deviceFile, JSON.stringify({ name }), { mode: 0o600 });
  }
  const consolePort = 5554 + slot * 2;
  const grpcPort = 18520 + slot;
  const serial = `emulator-${consolePort}`;
  const privateDir = path.join(runDir, 'private-emulator');
  fs.mkdirSync(privateDir, { mode: 0o700 });
  const log = fs.openSync(path.join(privateDir, 'emulator.log'), 'w', 0o600);
  const child = start(emulator, ['-avd', name, '-port', String(consolePort), '-grpc', String(grpcPort), '-grpc-use-token',
    '-no-snapshot', '-no-audio', '-no-boot-anim', '-no-window', '-memory', '2048', '-cores', '2'], {
    cwd: root, env: androidEnv, stdio: ['ignore', log, log],
  });
  onStart(child);
  fs.closeSync(log);
  fs.writeFileSync(path.join(runDir, 'android-process.json'), JSON.stringify({
    pid: child.pid, started: execFileSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], { encoding: 'utf8' }).trim(), name, serial,
  }), { mode: 0o600 });
  const discovery = path.join(os.homedir(), 'Library/Caches/TemporaryItems/avd/running');
  const owned = { child, serial, name, grpcPort, info: undefined, sdk, async boot() {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode) throw new Error('Owned Android emulator exited before readiness.');
      try {
        if (exec(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).trim() === '1') {
          // Current engines use pid_<pid>.ini; older launcher help still names
          // _info.ini. Never inspect any other session's discovery file.
          for (const filename of [`pid_${child.pid}.ini`, `pid_${child.pid}_info.ini`]) {
            const candidate = path.join(discovery, filename);
            if (!fs.existsSync(candidate)) continue;
            const fields = Object.fromEntries(fs.readFileSync(candidate, 'utf8').split(/\r?\n/).flatMap(line => {
              const index = line.indexOf('=');
              return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
            }));
            if (fields['port.serial'] === String(consolePort) && fields['grpc.port'] === String(grpcPort) &&
              fields['avd.id'] === name && fields['avd.dir'] === path.join(avdRoot, `${name}.avd`) && fields['grpc.token']) {
              owned.info = candidate;
              return;
            }
          }
        }
      } catch { /* Own emulator is still booting. */ }
      await delay(1000);
    }
    throw new Error('Owned Pixel 10 emulator did not become ready.');
  } };
  return owned;
}
