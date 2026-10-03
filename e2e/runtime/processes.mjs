import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

export function start(command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: 'inherit', ...options });
  child.on('error', () => {});
  return child;
}

export async function stop(child) {
  if (!child?.pid) return;
  // Only process groups created by this invocation are ever signalled.
  try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([once(child, 'exit').catch(() => {}), delay(4000)]);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
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
