import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const script = path.join(__dirname, '..', 'scripts', 'patch-expo-location-heading.js');
const sdk58Streamer = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'DeviceHeadingStreamer.sdk58.swift'),
  'utf8',
);

describe('patch-expo-location-heading', () => {
  let projectRoot: string;
  let streamerFile: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-expo-location-heading-'));
    const providers = path.join(projectRoot, 'node_modules', 'expo-location', 'ios', 'Providers');
    fs.mkdirSync(providers, { recursive: true });
    streamerFile = path.join(providers, 'DeviceHeadingStreamer.swift');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  const runPatch = () => spawnSync(process.execPath, [script, projectRoot], { encoding: 'utf8' });

  it('follows the interface orientation in the SDK 58 heading streamer and is idempotent', () => {
    fs.writeFileSync(streamerFile, sdk58Streamer);

    expect(runPatch().status).toBe(0);
    const patched = fs.readFileSync(streamerFile, 'utf8');

    expect(patched).toContain('import ExpoModulesCore\nimport UIKit\n');
    expect(patched).toContain('manager.headingFilter = kCLHeadingFilterNone');
    expect(patched).toContain(
      '    if Thread.isMainThread {\n      MainActor.assumeIsolated { syncHeadingOrientation() }\n    }\n    continuation?.yield(newHeading)',
    );
    expect(patched).toContain('UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }');
    expect(patched).toContain('switch scene.effectiveGeometry.interfaceOrientation {');
    expect(patched).toContain('case .portraitUpsideDown:\n      orientation = .portraitUpsideDown');
    expect(patched).toContain('case .landscapeLeft:\n      orientation = .landscapeRight');
    expect(patched).toContain('case .landscapeRight:\n      orientation = .landscapeLeft');
    expect(patched).toContain(
      'if manager.headingOrientation != orientation {\n      manager.headingOrientation = orientation',
    );

    expect(runPatch().status).toBe(0);
    expect(fs.readFileSync(streamerFile, 'utf8')).toBe(patched);
  });

  it('fails without writing when the delegate anchor is missing', () => {
    const changedUpstream = sdk58Streamer.replace(
      'continuation?.yield(newHeading)',
      'continuation?.yield(heading)',
    );
    fs.writeFileSync(streamerFile, changedUpstream);

    const result = runPatch();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shape changed (headingOrientation)');
    expect(fs.readFileSync(streamerFile, 'utf8')).toBe(changedUpstream);
  });
});
