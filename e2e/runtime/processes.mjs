import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const ownership = new WeakMap();
function started(pid) {
  try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
export function processIdentity(pid) { return { pid, started: started(pid) }; }
export function isAlive(record) {
  return Number.isInteger(record?.pid) && record.pid > 0 && Boolean(record.started) && started(record.pid) === record.started;
}
function persist(owner) {
  if (!owner.recordPath) return;
  const value = JSON.stringify([...owner.members.values()]);
  if (value === owner.lastRecord) return;
  const temporary = `${owner.recordPath}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, owner.recordPath);
  owner.lastRecord = value;
}
export function recordedProcesses(runDir) {
  if (!fs.existsSync(runDir)) return [];
  const records = [];
  for (const name of fs.readdirSync(runDir)) {
    if (/^process-\d+\.json$/.test(name)) records.push(...JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')));
    else if (['maestro-process.json', 'android-process.json'].includes(name)) records.push(JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')));
    else if (name === 'processes.json') records.push(...JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')).owned);
  }
  return records;
}
function capture(owner) {
  if (!owner.started) return;
  let lines;
  try { lines = execFileSync('ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' }).trim().split('\n'); }
  catch { return; } // Keep earlier ownership evidence if process inspection fails.
  const current = new Map();
  for (const line of lines) {
    const [, pid, group, birth] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/) || [];
    if (pid && birth) current.set(Number(pid), { pid: Number(pid), group: Number(group), started: birth.trim() });
  }
  // A long-lived supervisor starts many short-lived children (including ps).
  // Keep only live identities; retain known descendants even if reparented.
  for (const [pid, member] of owner.members) {
    if (current.get(pid)?.started !== member.started) owner.members.delete(pid);
  }
  // Only the same snapshot can authorize discovering new group members.
  if (current.get(owner.pid)?.started === owner.started) {
    for (const member of current.values()) {
      if (member.group === owner.pid) owner.members.set(member.pid, { pid: member.pid, started: member.started });
    }
  }
  persist(owner);
}

export function start(command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: 'inherit', ...options });
  child.on('error', () => {});
  if (child.pid) {
    const owner = { pid: child.pid, started: started(child.pid), members: new Map() };
    owner.members.set(owner.pid, { pid: owner.pid, started: owner.started });
    if (options.env?.NA_PIVO_E2E_RUN_DIR) owner.recordPath = path.join(options.env.NA_PIVO_E2E_RUN_DIR, `process-${child.pid}.json`);
    persist(owner);
    ownership.set(child, owner);
    // Remember children before a long-running supervisor exits on its own.
    owner.watch = setInterval(() => capture(owner), 250);
    owner.watch.unref();
    child.once('exit', () => clearInterval(owner.watch));
  }
  return child;
}

export async function stop(child) {
  const owner = child && ownership.get(child);
  if (!owner?.started) return;
  capture(owner);
  clearInterval(owner.watch);
  // Capture individual members while the original group leader is still ours.
  // A leader can exit before its children; never signal its old group ID later.
  const members = [...owner.members.values()];
  const signal = (member, name) => {
    if (started(member.pid) === member.started) {
      try { process.kill(member.pid, name); } catch { /* Already stopped. */ }
    }
  };
  for (const member of members) signal(member, 'SIGTERM');
  for (let attempt = 0; attempt < 40 && members.some(member => started(member.pid) === member.started); attempt++) await delay(100);
  for (const member of members) signal(member, 'SIGKILL');
}

export async function run(command, args, options = {}) {
  const child = start(command, args, options);
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${command} exited with ${code}`);
}

export async function ready(url, child, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode)) throw new Error('Owned service exited before readiness.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* Not listening yet. */ }
    await delay(250);
  }
  throw new Error(`Local service did not become ready: ${url}`);
}
