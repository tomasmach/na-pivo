import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function requireFreshNativeProject(root, platform) {
  if (!['ios', 'android'].includes(platform)) throw new Error('Unknown native platform.');
  try {
    fs.lstatSync(path.join(root, platform));
    throw new Error(`Existing ${platform}/ may contain manual or stale native configuration. Inspect it and move it aside before the isolated E2E build; no files were changed.`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const disk = fs.statfsSync(root);
  if (disk.bavail * disk.bsize < 30 * 1024 ** 3) throw new Error(`${platform} E2E build requires at least 30 GiB free.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireFreshNativeProject(fileURLToPath(new URL('../../', import.meta.url)), process.argv[2]);
}
