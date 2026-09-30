const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// A local production build (Pods, Xcode archive, IPA) needs this much room in
// the temp volume. Below it the build dies late in "Install pods" with ENOSPC.
const MIN_FREE_GB = 20;
const output = path.join(__dirname, '..', 'build', 'na-pivo.ipa');

const stats = fs.statfsSync(process.env.EAS_LOCAL_BUILD_WORKINGDIR || os.tmpdir());
const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
if (freeGb < MIN_FREE_GB) {
  console.error(
    `[release-ios] Only ${freeGb.toFixed(1)} GB free, a local iOS build needs ${MIN_FREE_GB} GB. ` +
      'Remove old worktrees or build leftovers first.',
  );
  process.exit(1);
}

function eas(args) {
  const result = spawnSync('eas', args, { stdio: 'inherit' });
  if (result.error) console.error(`[release-ios] ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

fs.rmSync(output, { force: true });
eas(['build', '--platform', 'ios', '--profile', 'production', '--local', '--output', output]);
eas(['submit', '--platform', 'ios', '--profile', 'production', '--path', output]);
