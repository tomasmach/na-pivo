import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { acquireLock } from './locks.mjs';
import { isAlive, processIdentity, recordedProcesses, start, stop } from './processes.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-ownership-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, '.e2e/runs', randomUUID());
  fs.mkdirSync(runDir, { recursive: true });
  return { root, runDir, lock: path.join(root, 'slot.lock') };
}
const dead = { pid: 2147483000, started: 'no such process' };

test('an unfinished recovery guard also protects a temporarily missing lock', t => {
  const f = fixture(t);
  fs.mkdirSync(`${f.lock}.recovering`);
  assert.equal(acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), false);
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal(fs.existsSync(`${f.lock}.recovering`), true);
});

test('an active owner keeps its lock and private artifacts', t => {
  const f = fixture(t);
  const owner = { ...processIdentity(process.pid), ...f };
  assert.equal(acquireLock(f.lock, owner), true);
  assert.equal(acquireLock(f.lock, { ...dead, ...f }), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.lock)), owner);
});

test('recovery refuses live recorded descendants even after their owner died', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ ...dead, ...f }));
  fs.writeFileSync(path.join(f.runDir, `process-${process.pid}.json`), JSON.stringify([processIdentity(process.pid)]));
  assert.throws(() => acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), /live owned processes/);
  assert.equal(JSON.parse(fs.readFileSync(f.lock)).pid, dead.pid);
});

test('recovery removes only abandoned private artifacts and retains evidence', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ ...dead, ...f }));
  fs.writeFileSync(path.join(f.runDir, 'owner.json'), JSON.stringify({ ...dead, root: f.root, platform: 'android' }));
  const privateDir = path.join(f.runDir, 'attempt-1/private-debug');
  const safeDir = path.join(f.runDir, 'attempt-1/screenshots');
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(safeDir, { recursive: true });
  fs.writeFileSync(path.join(privateDir, 'fixture.txt'), 'synthetic');
  fs.writeFileSync(path.join(safeDir, 'safe.txt'), 'evidence');
  assert.equal(acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), true);
  assert.equal(fs.existsSync(privateDir), false);
  assert.equal(fs.readFileSync(path.join(safeDir, 'safe.txt'), 'utf8'), 'evidence');
});

test('a reused PID with another birth time does not own an abandoned lock', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ pid: process.pid, started: 'old incarnation', ...f }));
  assert.equal(acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), true);
});

test('a child remains recorded and stoppable after its group leader exits', async t => {
  const f = fixture(t);
  const code = `require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setTimeout(() => process.exit(0), 1200);`;
  const leader = start(process.execPath, ['-e', code], {
    env: { PATH: process.env.PATH, NA_PIVO_E2E_RUN_DIR: f.runDir }, stdio: 'ignore',
  });
  try {
    await once(leader, 'exit');
    const survivors = recordedProcesses(f.runDir).filter(isAlive);
    assert.equal(survivors.length, 1);
    assert.notEqual(survivors[0].pid, leader.pid);
    await stop(leader);
    assert.equal(isAlive(survivors[0]), false);
  } finally { await stop(leader); }
});


test('failed process inspection cannot reclaim an abandoned build lock', t => {
  const f = fixture(t);
  const owner = { ...dead, ...f };
  fs.writeFileSync(f.lock, JSON.stringify(owner));
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ps'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const code = `import { acquireLock } from ${JSON.stringify(new URL('./locks.mjs', import.meta.url).href)}; acquireLock(${JSON.stringify(f.lock)}, ${JSON.stringify(owner)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, PATH: bin }, stdio: 'pipe',
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.lock)), owner);
  assert.equal(fs.existsSync(`${f.lock}.recovering`), false);
});

test('recovery refuses a descendant without a verifiable birth time', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ ...dead, ...f }));
  fs.writeFileSync(path.join(f.runDir, `process-${process.pid}.json`), JSON.stringify([{ pid: process.pid }]));
  assert.throws(() => acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), /Unverifiable/);
  assert.equal(JSON.parse(fs.readFileSync(f.lock)).pid, dead.pid);
});


test('an interrupted child start keeps its build lock for inspection', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ ...dead, ...f }));
  fs.writeFileSync(path.join(f.runDir, 'build-command-starting'), '');
  assert.throws(() => acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), /incomplete process ownership/);
  assert.equal(JSON.parse(fs.readFileSync(f.lock)).pid, dead.pid);
});

test('legacy build locks without descendant evidence remain reserved', t => {
  const f = fixture(t);
  fs.writeFileSync(f.lock, JSON.stringify({ ...dead, root: f.root }));
  assert.throws(() => acquireLock(f.lock, { ...processIdentity(process.pid), ...f }), /Legacy E2E lock/);
  assert.equal(JSON.parse(fs.readFileSync(f.lock)).pid, dead.pid);
});
