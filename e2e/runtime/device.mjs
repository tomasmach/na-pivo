import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const platform = process.env.NA_PIVO_E2E_PLATFORM || 'ios';
export const appId = platform === 'android' ? 'com.tomasmach.na_pivo' : 'com.tomasmach.na-pivo';
const device = () => process.env.NA_PIVO_E2E_DEVICE;
export const sdkPath = () => process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const execute = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, ...options,
});
export const simctl = (...args) => execute('xcrun', ['simctl', ...args]);
export const adb = (...args) => execute(path.join(sdkPath(), 'platform-tools/adb'), ['-s', device(), ...args]);

export function installApp() {
  if (platform === 'android') adb('install', '-r', '-t', process.env.NA_PIVO_E2E_APP_PATH);
  else simctl('install', device(), process.env.NA_PIVO_E2E_APP_PATH);
}

export function resetApp() {
  if (platform === 'android') {
    adb('shell', 'am', 'force-stop', appId);
    if (adb('shell', 'pm', 'clear', appId).trim() !== 'Success') throw new Error('Owned app data reset failed.');
  } else {
    try { simctl('terminate', device(), appId); } catch { /* Not running. */ }
    simctl('uninstall', device(), appId);
    installApp();
  }
}

export function prepareAppDevice() {
  installApp();
  if (platform === 'android') {
    // Expo --localhost advertises a loopback bundle URL in its manifest.
    // Forward only this owned emulator's Metro port to the host.
    const port = process.env.NA_PIVO_E2E_METRO_PORT;
    adb('reverse', `tcp:${port}`, `tcp:${port}`);
    adb('shell', 'cmd', 'uimode', 'night', 'yes');
    // Android's console accepts longitude first. Never forward this output.
    adb('emu', 'geo', 'fix', '14.42108', '50.08759');
  } else {
    simctl('ui', device(), 'appearance', 'dark');
    simctl('location', device(), 'set', '50.08759,14.42108');
  }
}

export function openLink(link) {
  if (platform === 'android') adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-p', appId, '-d', link);
  else simctl('openurl', device(), link);
}

export function openDevelopmentBundle() {
  if (platform !== 'android') return;
  const metro = `http://127.0.0.1:${process.env.NA_PIVO_E2E_METRO_PORT}?disableOnboarding=1`;
  openLink(`napivo://expo-development-client/?url=${encodeURIComponent(metro)}`);
}

export function appProcess() {
  if (platform === 'android') {
    const pid = adb('shell', 'pidof', appId).trim();
    if (!/^[1-9]\d*$/.test(pid)) throw new Error('Expected one owned application process.');
    return Number(pid);
  }
  const matches = simctl('spawn', device(), 'launchctl', 'list').split('\n')
    .map(line => line.trim().split(/\s+/)).filter(fields => fields.length === 3 &&
      /^[1-9]\d*$/.test(fields[0]) && /^UIKitApplication:com\.tomasmach\.na-pivo(?:\[|$)/.test(fields[2]));
  if (matches.length !== 1) throw new Error('Expected the owned application process.');
  return Number(matches[0][0]);
}

export function screenshot(destination) {
  if (platform === 'android') {
    const png = execute(path.join(sdkPath(), 'platform-tools/adb'), ['-s', device(), 'exec-out', 'screencap', '-p'], { encoding: null });
    fs.writeFileSync(destination, png, { mode: 0o600 });
  } else simctl('io', device(), 'screenshot', destination);
}

export function addMedia(files) {
  if (platform === 'android') {
    for (const file of files) {
      const destination = `/sdcard/Pictures/${path.basename(file)}`;
      adb('push', file, destination);
      adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${destination}`);
    }
  } else simctl('addmedia', device(), ...files);
}

/** Read the actual guest clipboard; neither credentials nor capability text leave this process. */
export async function clipboard() {
  if (platform !== 'android') return simctl('pbpaste', device()).trim();
  const port = Number(process.env.NA_PIVO_E2E_GRPC_PORT);
  const infoPath = process.env.NA_PIVO_E2E_GRPC_INFO;
  if (![18521, 18522, 18523].includes(port) || !infoPath) throw new Error('Owned emulator control is unavailable.');
  const info = fs.readFileSync(infoPath, 'utf8');
  const token = info.match(/^grpc\.token\s*=\s*(.+)$/m)?.[1]?.trim();
  if (!token) throw new Error('Owned emulator control credential is unavailable.');
  const grpc = await import('@grpc/grpc-js');
  const loader = await import('@grpc/proto-loader');
  const definition = loader.loadSync(path.join(sdkPath(), 'emulator/lib/emulator_controller.proto'));
  const Controller = grpc.loadPackageDefinition(definition).android.emulation.control.EmulatorController;
  const client = new Controller(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('authorization', `Bearer ${token}`);
  try {
    const result = await new Promise((resolve, reject) => client.getClipboard({}, metadata, {
      deadline: Date.now() + 5000,
    }, (error, value) => error ? reject(new Error('Owned clipboard read failed.')) : resolve(value)));
    return result.text.trim();
  } finally { client.close(); }
}
