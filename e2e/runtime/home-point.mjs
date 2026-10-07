import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { platform, sdkPath, appId } from './device.mjs';

/** Read only our simulator's persisted setting; coordinates never leave memory. */
export function readHomePoint(device) {
  if (platform === 'android') return readAndroidHomePoint(device);
  const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'com.tomasmach.na-pivo', 'data'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const directory = path.join(container, 'Library/Application Support/com.tomasmach.na-pivo/RCTAsyncLocalStorage_V1');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const key = 'na-pivo-settings';
  const stored = manifest[key] === null
    ? fs.readFileSync(path.join(directory, crypto.createHash('md5').update(key).digest('hex')), 'utf8')
    : manifest[key];
  const point = stored === undefined ? null : JSON.parse(stored).state.homePoint;
  if (point != null && (!Number.isFinite(point.lat) || !Number.isFinite(point.lng))) throw new Error('Invalid persisted home point.');
  return {
    present: point != null,
    matchesFixture: point != null && Math.abs(point.lat - 50.08759) < 0.00001 && Math.abs(point.lng - 14.42108) < 0.00001,
  };
}

function readAndroidHomePoint(device) {
  const directory = fs.mkdtempSync(path.join(process.env.NA_PIVO_E2E_RUN_DIR, 'private-storage-'));
  fs.chmodSync(directory, 0o700);
  try {
    // Copy main DB and its current WAL while the test is idle. This reads the
    // actual app store, including uncheckpointed writes; no fixture substitutes.
    for (const suffix of ['', '-wal']) {
      let bytes;
      try {
        bytes = execFileSync(path.join(sdkPath(), 'platform-tools/adb'), ['-s', device,
          'exec-out', 'run-as', appId, 'cat', `databases/RKStorage${suffix}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
      } catch (error) {
        if (suffix && error.stderr?.toString().includes('No such file')) continue;
        throw new Error('Could not read the owned Android settings store.');
      }
      fs.writeFileSync(path.join(directory, `RKStorage${suffix}`), bytes, { mode: 0o600 });
    }
    const result = execFileSync(path.resolve('backend/.venv/bin/python'), ['-c', `
import json, math, sqlite3, sys
connection = sqlite3.connect('file:' + sys.argv[1] + '?mode=ro', uri=True)
row = connection.execute('SELECT value FROM catalystLocalStorage WHERE key = ?', ('na-pivo-settings',)).fetchone()
point = json.loads(row[0]).get('state', {}).get('homePoint') if row else None
if point is not None:
    assert all(isinstance(point.get(key), (int, float)) and math.isfinite(point[key]) for key in ('lat', 'lng'))
print(json.dumps({'present': point is not None, 'matchesFixture': point is not None and abs(point['lat'] - 50.08759) < 0.00001 and abs(point['lng'] - 14.42108) < 0.00001}))
`, path.join(directory, 'RKStorage')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    return JSON.parse(result);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
