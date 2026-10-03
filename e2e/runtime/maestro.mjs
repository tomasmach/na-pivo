import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { ready, start, stop } from './processes.mjs';

const root = process.cwd();
const output = process.env.NA_PIVO_E2E_OUTPUT;
const privateDir = path.join(output, 'private-debug');
fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const binary = process.env.E2E_MAESTRO_PATH || path.join(root, '.e2e/tools/maestro/bin/maestro');
const privateEnv = { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_DISABLE_UPDATE_CHECK: 'true', MAESTRO_API_URL: `http://127.0.0.1:${process.env.NA_PIVO_E2E_CONTROL_PORT}` };
if (!fs.existsSync(binary)) throw new Error('Install the pinned local CLI with npm run e2e:maestro:install.');
if (execFileSync(binary, ['--version'], { encoding: 'utf8', env: privateEnv }).trim() !== '2.11.0') throw new Error('Use the verified Maestro 2.11.0.');
const device = process.env.NA_PIVO_E2E_DEVICE;
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { stdio: 'ignore' });
const secrets = [process.env.NA_PIVO_E2E_EMAIL, process.env.NA_PIVO_E2E_PASSWORD, process.env.NA_PIVO_E2E_NEW_PASSWORD];
function redact(value) {
  let text = value.replace(/\u001b\[[0-9;]*m/g, '').replace(/[^\s"'<>]+@[^\s"'<>]+/g, '[fixture email]').replace(/-?\d{1,3}\.\d{4,}/g, '[decimal value]');
  for (const secret of secrets) if (secret) text = text.split(secret).join('[fixture credential]');
  return text;
}
let services;
let child;
let closing = false;
async function cleanup(code) {
  if (closing) return;
  closing = true;
  await stop(child);
  await stop(services);
  fs.rmSync(privateDir, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGINT', () => cleanup(130));
process.on('SIGTERM', () => cleanup(143));
try {
  const serviceLog = fs.openSync(path.join(output, 'services.log'), 'w', 0o600);
  services = start(process.execPath, ['e2e/runtime/serve.mjs'], { cwd: root, env: process.env, stdio: ['ignore', serviceLog, serviceLog] });
  fs.closeSync(serviceLog);
  await ready(`http://127.0.0.1:${process.env.NA_PIVO_E2E_METRO_PORT}/status`, services, 90_000);
  simctl('install', device, process.env.NA_PIVO_E2E_APP_PATH);
  simctl('ui', device, 'appearance', 'dark');
  simctl('location', device, 'set', '50.08759,14.42108');
  const args = process.argv.slice(2);
  const filters = [];
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag') filters.push('--include-tags', args[++i]);
    else if (args[i] === '--exclude-tag') filters.push('--exclude-tags', args[++i]);
    else if (args[i] === '--no-cache') { /* Maestro has no model cache. */ }
    else if (args[i].startsWith('e2e/tests/')) paths.push(args[i]);
    else throw new Error('Maestro accepts area paths, --tag and --exclude-tag.');
  }
  // CLI receives only synthetic credentials. Actual bearer and mail tokens stay
  // in the local HTTP controller, outside Maestro variables and artifacts.
  const env = {
    ...privateEnv, E2E_TELEMETRY_DISABLED: '1',
    MAESTRO_EMAIL: process.env.NA_PIVO_E2E_EMAIL,
    MAESTRO_PASSWORD: process.env.NA_PIVO_E2E_PASSWORD,
    MAESTRO_NEW_PASSWORD: process.env.NA_PIVO_E2E_NEW_PASSWORD,
    MAESTRO_CONTROL: `http://127.0.0.1:${process.env.NA_PIVO_E2E_CONTROL_PORT}`,
    MAESTRO_METRO: `http://127.0.0.1:${process.env.NA_PIVO_E2E_METRO_PORT}`,
    MAESTRO_SCREENSHOTS: path.join(output, 'screenshots'),
  };
  const consolePath = path.join(privateDir, 'console.txt');
  const consoleLog = fs.openSync(consolePath, 'w', 0o600);
  const started = Date.now();
  child = start(binary, ['--device', device, 'test', '--no-ansi', '--flatten-debug-output', '--debug-output', privateDir, '--test-output-dir', privateDir, '--format', 'JUNIT', '--output', path.join(privateDir, 'junit.xml'), ...filters, ...(paths.length ? paths : ['e2e/tests'])], { cwd: root, env, stdio: ['ignore', consoleLog, consoleLog] });
  fs.writeFileSync(path.join(process.env.NA_PIVO_E2E_RUN_DIR, 'maestro-process.json'), JSON.stringify({ pid: child.pid, started: execFileSync('ps', ['-o', 'lstart=', '-p', String(child.pid)], { encoding: 'utf8' }).trim() }), { mode: 0o600 });
  fs.closeSync(consoleLog);
  console.log('Maestro 2.11.0 is running on the owned iPhone 17; raw fixture reports are temporary.');
  const [code, signal] = await once(child, 'exit');
  const report = fs.existsSync(path.join(privateDir, 'junit.xml')) ? fs.readFileSync(path.join(privateDir, 'junit.xml'), 'utf8') : '';
  const total = (report.match(/<testcase\b/g) || []).length;
  const failed = (report.match(/<failure\b/g) || []).length + (report.match(/<error\b/g) || []).length;
  const skipped = (report.match(/<skipped\b/g) || []).length;
  const metrics = { engine: 'maestro-2.11.0', durationSeconds: (Date.now() - started) / 1000, passed: Math.max(0, total - failed - skipped), failed: failed || (code !== 0 || !total ? 1 : 0), skipped, modelCalls: 0, tokens: 0, replayed: null, handedOff: null, missed: null };
  fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  const failures = (report.match(/<(?:failure|error)\b[\s\S]*?<\/(?:failure|error)>/g) || []).join('\n');
  const errors = [];
  if (code !== 0) {
    for (const entry of fs.readdirSync(privateDir, { recursive: true })) {
      if (path.basename(entry) === 'maestro.log') {
        const lines = fs.readFileSync(path.join(privateDir, entry), 'utf8').split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/\[ERROR\]|Caused by:/.test(lines[i])) errors.push(lines.slice(i, i + 2).join('\n'));
        }
      }
    }
  }
  const safeLog = redact(fs.readFileSync(consolePath, 'utf8') + '\n' + failures + '\n' + errors.slice(-12).join('\n'));
  fs.writeFileSync(path.join(output, 'result.txt'), safeLog);
  console.log(safeLog.slice(-7000));
  if (!total) throw new Error('Maestro did not execute any tests.');
  if (signal) throw new Error(`Maestro was interrupted by ${signal}.`);
  await cleanup(code === 0 && failed === 0 ? 0 : 1);
} catch (error) {
  console.error(redact(error.message));
  await cleanup(1);
}
