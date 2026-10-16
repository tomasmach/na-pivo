import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { isAlive, processIdentity, start, stop } from './processes.mjs';

test('cleanup never signals an exited child or an unowned PID', async t => {
  const child = start(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  await once(child, 'exit');
  const kill = t.mock.method(process, 'kill', () => { throw new Error('Unexpected signal'); });
  await stop(child);
  await stop({ pid: process.pid, exitCode: null });
  assert.equal(kill.mock.callCount(), 0);
});

test('a child whose ownership record cannot be written is stopped before the error', async t => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'napivo-e2e-record-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  const marker = `napivo-e2e-unrecorded-${process.pid}-${Date.now()}`;
  const running = () => execFileSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).includes(marker);
  t.mock.method(fs, 'renameSync', () => { throw new Error('ENOSPC'); });
  assert.throws(() => start(process.execPath, ['-e', 'setInterval(()=>{},1000)', marker], {
    stdio: 'ignore', env: { ...process.env, NA_PIVO_E2E_RUN_DIR: runDir },
  }), /ENOSPC/);
  for (let i = 0; i < 20 && running(); i++) await delay(100);
  assert.equal(running(), false);
});

for (const exitBeforeCleanup of [false, true]) test(`cleanup stops a descendant when its leader exits ${exitBeforeCleanup ? 'before' : 'during'} cleanup`, async () => {
  const program = `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>process.stdout.write(String(child.pid)));
    process.stdin.once('data',()=>process.exit(0));
    setInterval(()=>{},1000);
  `;
  const parent = start(process.execPath, ['-e', program], { stdio: ['pipe', 'pipe', 'ignore'] });
  const [data] = await once(parent.stdout, 'data');
  const pid = Number(data.toString());
  const birth = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  function alive() {
    try {
      const current = execFileSync('ps', ['-o', 'lstart=', '-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return current.startsWith(birth) && !/\sZ\S*$/.test(current);
    } catch { return false; }
  }
  try {
    if (exitBeforeCleanup) {
      await delay(1000);
      const exited = once(parent, 'exit');
      parent.stdin.write('exit');
      await exited;
      assert.equal(alive(), true, 'The owned descendant must outlive its leader.');
    }
    await stop(parent);
    for (let i = 0; i < 20 && alive(); i++) await delay(100);
    assert.equal(alive(), false);
  } finally {
    await stop(parent);
    if (alive()) process.kill(pid, 'SIGKILL');
  }
});

test('a zombie counts as exited', async t => {
  // The parent execs into sleep and never reaps its background child.
  const parent = spawn('/bin/sh', ['-c', 'sleep 0.3 & echo $!; exec sleep 5'], { stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => parent.kill('SIGKILL'));
  const [pid] = await once(parent.stdout, 'data');
  const zombie = processIdentity(Number(String(pid).trim()));
  assert.equal(isAlive(zombie), true);
  await delay(800);
  assert.match(execFileSync('ps', ['-o', 'stat=', '-p', String(zombie.pid)], { encoding: 'utf8' }), /Z/);
  assert.equal(isAlive(zombie), false);
});
