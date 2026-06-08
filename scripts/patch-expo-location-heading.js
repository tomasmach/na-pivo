const fs = require('fs');
const path = require('path');

const headingFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-location',
  'ios',
  'Providers',
  'DeviceHeadingStreamer.swift',
);

const headingNeedle = `      self.continuation = continuation
      manager.startUpdatingHeading()`;

const headingReplacement = `      self.continuation = continuation
      manager.headingFilter = kCLHeadingFilterNone
      manager.startUpdatingHeading()`;

if (!fs.existsSync(headingFile)) {
  console.warn('[patch-expo-location-heading] expo-location iOS source not found; skipping');
} else {
  const source = fs.readFileSync(headingFile, 'utf8');

  if (source.includes(headingReplacement)) {
    console.log('[patch-expo-location-heading] headingFilter patch already applied');
  } else {
    if (!source.includes(headingNeedle)) {
      console.error('[patch-expo-location-heading] expected DeviceHeadingStreamer.swift shape changed');
      process.exit(1);
    }

    fs.writeFileSync(headingFile, source.replace(headingNeedle, headingReplacement));
    console.log('[patch-expo-location-heading] set iOS headingFilter to kCLHeadingFilterNone');
  }
}

const subscriberFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-location',
  'build',
  'LocationSubscribers.js',
);

if (!fs.existsSync(subscriberFile)) {
  console.warn('[patch-expo-location-heading] expo-location subscriber build not found; skipping');
  process.exit(0);
}

const subscriberSource = fs.readFileSync(subscriberFile, 'utf8');

const removeWatchReplacements = [
  {
    needle: 'ExpoLocation.removeWatchAsync(id);',
    replacement: 'ExpoLocation.removeWatchAsync(id).catch(() => {});',
  },
  {
    needle: 'ExpoLocation.removeWatchAsync(watchId);',
    replacement: 'ExpoLocation.removeWatchAsync(watchId).catch(() => {});',
  },
];

if (removeWatchReplacements.every(({ replacement }) => subscriberSource.includes(replacement))) {
  console.log('[patch-expo-location-heading] removeWatchAsync rejection patch already applied');
  process.exit(0);
}

const patchedSubscriberSource = removeWatchReplacements.reduce(
  (source, { needle, replacement }) => source.replace(needle, replacement),
  subscriberSource,
);

if (patchedSubscriberSource === subscriberSource) {
  console.error('[patch-expo-location-heading] expected LocationSubscribers.js shape changed');
  process.exit(1);
}

fs.writeFileSync(subscriberFile, patchedSubscriberSource);
console.log('[patch-expo-location-heading] ignored rejected removeWatchAsync cleanup calls');
