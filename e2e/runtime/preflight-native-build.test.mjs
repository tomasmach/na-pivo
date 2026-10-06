import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireFreshNativeProject } from './preflight-native-build.mjs';

for (const platform of ['ios', 'android']) {
  test(`${platform} preparation preserves an existing native project and refuses it`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-native-preflight-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, platform));
    const manual = path.join(root, platform, 'manual-change.txt');
    fs.writeFileSync(manual, 'keep this native edit');
    assert.throws(() => requireFreshNativeProject(root, platform), /Existing/);
    assert.equal(fs.readFileSync(manual, 'utf8'), 'keep this native edit');
  });

  test(`${platform} dangling native project symlink is preserved and refused`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-native-preflight-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.symlinkSync('missing-native-project', path.join(root, platform));
    assert.throws(() => requireFreshNativeProject(root, platform), /Existing/);
    assert.equal(fs.readlinkSync(path.join(root, platform)), 'missing-native-project');
  });
}
