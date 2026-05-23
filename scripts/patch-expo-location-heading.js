const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-location',
  'ios',
  'Providers',
  'DeviceHeadingStreamer.swift',
);

const needle = `      self.continuation = continuation
      manager.startUpdatingHeading()`;

const replacement = `      self.continuation = continuation
      manager.headingFilter = kCLHeadingFilterNone
      manager.startUpdatingHeading()`;

if (!fs.existsSync(file)) {
  console.warn('[patch-expo-location-heading] expo-location iOS source not found; skipping');
  process.exit(0);
}

const source = fs.readFileSync(file, 'utf8');

if (source.includes(replacement)) {
  console.log('[patch-expo-location-heading] headingFilter patch already applied');
  process.exit(0);
}

if (!source.includes(needle)) {
  console.error('[patch-expo-location-heading] expected DeviceHeadingStreamer.swift shape changed');
  process.exit(1);
}

fs.writeFileSync(file, source.replace(needle, replacement));
console.log('[patch-expo-location-heading] set iOS headingFilter to kCLHeadingFilterNone');
