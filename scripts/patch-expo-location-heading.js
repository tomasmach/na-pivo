const fs = require('fs');
const path = require('path');

const projectRoot = process.argv[2] || path.join(__dirname, '..');

const headingFile = path.join(
  projectRoot,
  'node_modules',
  'expo-location',
  'ios',
  'Providers',
  'DeviceHeadingStreamer.swift',
);

const headingEdits = [
  {
    name: 'headingFilter',
    needle: `      self.continuation = continuation
      manager.startUpdatingHeading()`,
    replacement: `      self.continuation = continuation
      manager.headingFilter = kCLHeadingFilterNone
      manager.startUpdatingHeading()`,
  },
  {
    name: 'UIKit import',
    needle: `import CoreLocation
import ExpoModulesCore
`,
    replacement: `import CoreLocation
import ExpoModulesCore
import UIKit
`,
  },
  {
    name: 'headingOrientation',
    needle: `  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    continuation?.yield(newHeading)
  }`,
    replacement: `  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    // Core Location calls the delegate on the thread that created the manager, which BaseLocationProvider pins to main.
    if Thread.isMainThread {
      MainActor.assumeIsolated { syncHeadingOrientation() }
    }
    continuation?.yield(newHeading)
  }

  // Core Location measures heading from the top edge of headingOrientation, portrait by default. Resizable iPhone
  // apps (iOS 27, e.g. a foldable's inner display) can lay out in landscape despite the portrait lock, and folding
  // changes the orientation without a rotation event, so every update re-reads the scene.
  @MainActor
  private func syncHeadingOrientation() {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
      return
    }
    // UIKit and Core Location name the landscape sides oppositely.
    let orientation: CLDeviceOrientation
    switch scene.effectiveGeometry.interfaceOrientation {
    case .portrait:
      orientation = .portrait
    case .portraitUpsideDown:
      orientation = .portraitUpsideDown
    case .landscapeLeft:
      orientation = .landscapeRight
    case .landscapeRight:
      orientation = .landscapeLeft
    default:
      return
    }
    if manager.headingOrientation != orientation {
      manager.headingOrientation = orientation
    }
  }`,
  },
];

if (!fs.existsSync(headingFile)) {
  console.warn('[patch-expo-location-heading] expo-location iOS source not found; skipping');
} else {
  const source = fs.readFileSync(headingFile, 'utf8');
  let patchedSource = source;

  for (const { name, needle, replacement } of headingEdits) {
    if (patchedSource.includes(replacement)) {
      console.log(`[patch-expo-location-heading] ${name} patch already applied`);
      continue;
    }
    if (!patchedSource.includes(needle)) {
      console.error(
        `[patch-expo-location-heading] expected DeviceHeadingStreamer.swift shape changed (${name})`,
      );
      process.exit(1);
    }
    // A replacer function keeps Swift's $0 closure arguments literal.
    patchedSource = patchedSource.replace(needle, () => replacement);
    console.log(`[patch-expo-location-heading] applied ${name} patch`);
  }

  if (patchedSource !== source) {
    fs.writeFileSync(headingFile, patchedSource);
  }
}

const subscriberFile = path.join(
  projectRoot,
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
