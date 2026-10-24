// audit-ci.jsonc allowlists the zod advisory GHSA-mrhx-c7xc-m3w5 only on the
// expo>@expo/cli>zod path. audit-ci builds its paths from npm's `effects`, which
// leave out a consumer whose range already allows the patched zod, so a new
// production path to a vulnerable zod would pass it. This walks the resolved
// production tree instead. Remove it together with the allowlist entry.
const { execFileSync } = require('node:child_process');

const ALLOWED_PATH = 'expo>@expo/cli>zod';
const PATCHED = [4, 6, 6];

function isVulnerable(version) {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (let i = 0; i < PATCHED.length; i += 1) {
    if (parts[i] !== PATCHED[i]) return parts[i] < PATCHED[i];
  }
  return version.includes('-');
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', 'zod', '--all', '--omit=dev', '--package-lock-only', '--json'], {
    encoding: 'utf8',
  }),
);

const unexpected = [];
(function walk(node, trail) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    const path = [...trail, name];
    if (name === 'zod' && child.version && isVulnerable(child.version) && path.join('>') !== ALLOWED_PATH) {
      unexpected.push(`${path.join('>')}@${child.version}`);
    }
    walk(child, path);
  }
})(tree, []);

if (unexpected.length > 0) {
  console.error(`Vulnerable zod (GHSA-mrhx-c7xc-m3w5) outside ${ALLOWED_PATH}:\n  ${unexpected.join('\n  ')}`);
  process.exit(1);
}
console.log(`zod advisory exception holds: vulnerable zod only on ${ALLOWED_PATH}.`);
