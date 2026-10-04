import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireFreshIosProject } from './preflight-ios-build.mjs';

test('isolated iOS preparation preserves an existing native project and refuses it', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-ios-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ios'));
  const manual = path.join(root, 'ios', 'manual-change.txt');
  fs.writeFileSync(manual, 'keep this native edit');
  assert.throws(() => requireFreshIosProject(root), /Existing ios/);
  assert.equal(fs.readFileSync(manual, 'utf8'), 'keep this native edit');
});

test('a dangling native project symlink is also preserved and refused', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-ios-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.symlinkSync('missing-native-project', path.join(root, 'ios'));
  assert.throws(() => requireFreshIosProject(root), /Existing ios/);
  assert.equal(fs.readlinkSync(path.join(root, 'ios')), 'missing-native-project');
});
