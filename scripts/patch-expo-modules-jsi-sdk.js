const fs = require('fs');
const path = require('path');

const stubScript = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-modules-jsi',
  'apple',
  'scripts',
  'create-stub-xcframework.sh',
);

if (!fs.existsSync(stubScript)) {
  console.error('[patch-expo-modules-jsi-sdk] ExpoModulesJSI stub script not found');
  process.exit(1);
}

const source = fs.readFileSync(stubScript, 'utf8');
const original = 'echo "" | clang -x c - -dynamiclib \\\n';
const patched = 'echo "" | xcrun --sdk macosx clang -isysroot "$(xcrun --sdk macosx --show-sdk-path)" -x c - -dynamiclib \\\n';

if (source.includes(patched)) {
  console.log('[patch-expo-modules-jsi-sdk] host macOS SDK patch already applied');
} else if (source.includes(original)) {
  fs.writeFileSync(stubScript, source.replace(original, patched));
  console.log('[patch-expo-modules-jsi-sdk] selected Xcode macOS SDK for stub binary');
} else {
  console.error('[patch-expo-modules-jsi-sdk] expected ExpoModulesJSI stub compiler shape changed');
  process.exit(1);
}
