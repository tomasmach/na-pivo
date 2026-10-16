const fs = require('fs');
const path = require('path');

// Backport of the expo-secure-store 58 fix: rewriting an existing Keychain item
// changed only its value, so a record first saved with the default "when
// unlocked" class stayed unreadable in the background forever.
const moduleFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-secure-store',
  'ios',
  'SecureStoreModule.swift',
);

const needle = `    let valueData = value.data(using: .utf8)
    let updateDictionary = [kSecValueData as String: valueData]
`;

const replacement = `    let valueData = Data(value.utf8)
    var updateDictionary: [String: Any] = [kSecValueData as String: valueData]

    // Keychain updates keep the existing accessibility unless it is set here.
    if !options.requireAuthentication {
      updateDictionary[kSecAttrAccessible as String] = attributeWith(options: options)
    }
`;

if (!fs.existsSync(moduleFile)) {
  console.warn('[patch-expo-secure-store-accessibility] expo-secure-store iOS source not found; skipping');
  process.exit(0);
}

const source = fs.readFileSync(moduleFile, 'utf8');

if (source.includes(replacement)) {
  console.log('[patch-expo-secure-store-accessibility] accessibility update patch already applied');
  process.exit(0);
}

if (!source.includes(needle)) {
  console.error('[patch-expo-secure-store-accessibility] expected SecureStoreModule.swift shape changed');
  process.exit(1);
}

fs.writeFileSync(moduleFile, source.replace(needle, replacement));
console.log('[patch-expo-secure-store-accessibility] Keychain updates now apply the requested accessibility');
