import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Read only our simulator's persisted setting; coordinates never leave memory. */
export function readHomePoint(device) {
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
