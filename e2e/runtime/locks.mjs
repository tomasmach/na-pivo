import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isAlive, recordedProcesses } from './processes.mjs';

export function acquireLock(lock, owner) {
  const write = () => fs.writeFileSync(lock, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
  // Serialize reclamation. A crashed reclamation is deliberately fail-closed;
  // inspect its tiny guard before removing it, never race an active reclaimer.
  const guard = `${lock}.recovering`;
  try { fs.mkdirSync(guard, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  try {
    if (!fs.existsSync(lock)) { write(); return true; }
    const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!previous.started || !previous.root || !previous.runDir) throw new Error(`Legacy E2E lock requires ownership inspection: ${lock}`);
    if (isAlive(previous)) return false;
    const expected = path.join(previous.root, '.e2e', 'runs');
    if (path.dirname(previous.runDir) !== expected || !/^[a-f0-9-]{36}$/.test(path.basename(previous.runDir))) throw new Error('Invalid abandoned E2E directory.');
    if (recordedProcesses(previous.runDir).some(isAlive)) throw new Error('Abandoned E2E run still has live owned processes; inspect its process records before recovery.');
    const marker = path.join(previous.runDir, 'owner.json');
    if (fs.existsSync(marker)) {
      const prior = JSON.parse(fs.readFileSync(marker, 'utf8'));
      if (prior.root !== previous.root || prior.pid !== previous.pid) throw new Error('Abandoned E2E ownership does not match.');
      if (prior.platform !== 'android' && prior.device) {
        const devices = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' })).devices;
        const simulator = Object.values(devices).flat().find(device => device.udid === prior.device);
        if (simulator && simulator.state !== 'Shutdown') throw new Error('Previous owned simulator has not shut down; its slot remains reserved.');
      }
      for (const entry of fs.readdirSync(previous.runDir)) {
        if (entry.startsWith('attempt-')) fs.rmSync(path.join(previous.runDir, entry, 'private-debug'), { recursive: true, force: true });
        if (entry.startsWith('private-storage-') || entry === 'private-emulator') fs.rmSync(path.join(previous.runDir, entry), { recursive: true, force: true });
      }
    }
    fs.unlinkSync(lock);
    try { write(); return true; }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
  } finally { fs.rmdirSync(guard); }
}
