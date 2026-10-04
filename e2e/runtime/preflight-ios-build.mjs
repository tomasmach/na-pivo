import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function requireFreshIosProject(root) {
  try {
    fs.lstatSync(path.join(root, 'ios'));
    throw new Error('Existing ios/ may contain manual or non-E2E native configuration. Inspect it and move it aside before the isolated E2E build; no files were changed.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const disk = fs.statfsSync(root);
  if (disk.bavail * disk.bsize < 30 * 1024 ** 3) throw new Error('iOS E2E build requires at least 30 GiB free.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireFreshIosProject(fileURLToPath(new URL('../../', import.meta.url)));
}
