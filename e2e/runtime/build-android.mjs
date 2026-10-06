import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { acquireLock } from './locks.mjs';
import { start, stop } from './processes.mjs';
import { sdkPath } from './device.mjs';
import { requireFreshNativeProject } from './preflight-native-build.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const free = () => { const disk = fs.statfsSync(root); return disk.bavail * disk.bsize; };
requireFreshNativeProject(root, 'android');
const marker = path.join(root, '.e2e/android-build-owner.json');
fs.mkdirSync(path.dirname(marker), { recursive: true });
const runDir = path.join(root, '.e2e/runs', randomUUID());
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
const env = {
  PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  JAVA_HOME: process.env.JAVA_HOME || execFileSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8' }).trim(),
  ANDROID_HOME: sdkPath(), NODE_ENV: 'development', CI: '1',
  NA_PIVO_E2E_RUN_DIR: runDir,
  E2E_TELEMETRY_DISABLED: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_BACKEND_MODE: 'local', EXPO_PUBLIC_BACKEND_URL: 'local',
  EXPO_PUBLIC_BACKEND_HOST: '127.0.0.1', EXPO_PUBLIC_BACKEND_PORT: '18121',
  EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY: 'e2e-invalid-local-only',
  NA_PIVO_E2E_NATIVE: '1', EXPO_PUBLIC_E2E: '1', NA_PIVO_SKIP_IOS_WIDGETS: '1',
};
const lock = path.join(root, '.e2e/android-build.lock');
const birth = pid => execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
const owner = { root, runDir, pid: process.pid, started: birth(process.pid), platform: 'android' };
if (!acquireLock(lock, owner)) throw new Error('Android E2E build remains reserved; inspect its owner and recovery guard.');
fs.writeFileSync(path.join(runDir, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
fs.writeFileSync(marker, JSON.stringify(owner), { mode: 0o600 });
let child;
let closing = false;
async function cleanup(code) {
  if (closing) return;
  closing = true;
  clearInterval(watch);
  await stop(child);
  fs.rmSync(lock, { force: true });
  process.exit(code);
}
process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));
const watch = setInterval(() => {
  if (free() < 20 * 1024 ** 3) {
    console.error('Android build reached the 20 GiB reserve; stopping only owned build processes.');
    void cleanup(75);
  }
}, 1000);
async function command(executable, args, cwd) {
  const pending = path.join(runDir, 'build-command-starting');
  fs.writeFileSync(pending, '', { mode: 0o600 });
  child = start(executable, args, { cwd, env });
  fs.writeFileSync(path.join(root, '.e2e/android-build-process.json'), JSON.stringify({
    root, pid: child.pid, started: birth(child.pid),
  }), { mode: 0o600 });
  fs.unlinkSync(pending);
  const [code] = await once(child, 'exit');
  if (closing) return;
  if (code !== 0) throw new Error('Owned local Android build command failed.');
}
try {
  await command(process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install'], root);
  if (!closing) await command(path.join(root, 'android/gradlew'), ['assembleDebug', '--no-daemon', '--max-workers=2',
    '-PreactNativeArchitectures=arm64-v8a', '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=512m'], path.join(root, 'android'));
  if (!closing) {
    const output = path.join(root, '.e2e/build/na-pivo-debug.apk');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), output, fs.constants.COPYFILE_FICLONE);
    console.log('Owned local debug APK is ready in .e2e/build/na-pivo-debug.apk');
    await cleanup(0);
  }
} catch (error) { console.error(error.message); await cleanup(1); }
