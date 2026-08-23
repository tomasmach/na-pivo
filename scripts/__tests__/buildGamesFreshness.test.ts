import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

jest.setTimeout(300_000);

const SCRIPT = resolve(__dirname, '..', 'build-games.mjs');
const ASSETS = ['assets/games/dice.html', 'assets/games/bottle.html', 'assets/games/wheel.html'];

let outputRoot: string;

const runScript = (args: string[] = []) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NAPIVO_GAMES_OUTPUT_ROOT: outputRoot },
  });

beforeEach(async () => {
  outputRoot = await mkdtemp(join(tmpdir(), 'napivo-games-'));
});

afterEach(async () => {
  await rm(outputRoot, { recursive: true, force: true });
});

describe('build-games freshness', () => {
  it('detects stale generated assets via --check and repairs them on rebuild', async () => {
    const firstBuild = runScript();
    expect(firstBuild.status).toBe(0);
    for (const asset of ASSETS) {
      await expect(readFile(join(outputRoot, asset))).resolves.toBeInstanceOf(Buffer);
    }

    const freshCheck = runScript(['--check']);
    expect(freshCheck.status).toBe(0);

    const dicePath = join(outputRoot, 'assets/games/dice.html');
    await writeFile(dicePath, Buffer.concat([await readFile(dicePath), Buffer.from('<stale>\n')]));

    const staleCheck = runScript(['--check']);
    expect(staleCheck.status).not.toBe(0);
    expect(`${staleCheck.stdout}${staleCheck.stderr}`).toContain('assets/games/dice.html');

    const repairBuild = runScript();
    expect(repairBuild.status).toBe(0);

    const repairedCheck = runScript(['--check']);
    expect(repairedCheck.status).toBe(0);
  });
});
