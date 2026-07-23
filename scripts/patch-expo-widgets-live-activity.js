const fs = require('fs');
const path = require('path');

const appIntentFile = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-widgets',
  'ios',
  'Widgets',
  'AppIntent.swift',
);

const originalImports = `import AppIntents
import WidgetKit`;

const patchedImports = `import ActivityKit
import AppIntents
import Foundation
import WidgetKit`;

const originalLiveActivityIntent = `@available(iOS 16.0, *)
struct LiveActivityUserInteraction: LiveActivityIntent {
  // title is not used for non-discoverable intents, but it is required
  static var title: LocalizedStringResource = "User Interaction"
  static var isDiscoverable: Bool = false

  @Parameter(title: "source")
  var source: String?

  @Parameter(title: "target")
  var target: String?

  init() {}
  init(source: String?, target: String?) {
    self.source = source
    self.target = target
  }

  func perform() async throws -> some IntentResult {
    WidgetsEvents.shared.sendNotification(type: .userEvent, data: [
      "source": source as Any,
      "target": target as Any,
      "timestamp": Int(Date().timeIntervalSince1970 * 1000)
    ])

    return .result()
  }
}`;

const patchedLiveActivityIntent = `private let beerLiveActivityAddTarget = "add-beer"
private let beerLiveActivityPendingAddsDirectory = "BeerLiveActivityPendingAdds-v1"

@available(iOS 16.2, *)
private actor BeerLiveActivityInteractionCoordinator {
  static let shared = BeerLiveActivityInteractionCoordinator()

  func addBeer(activityId: String) async -> String? {
    guard let activity = Activity<LiveActivityAttributes>.activities.first(where: { $0.id == activityId }),
          let propsData = activity.content.state.props.data(using: .utf8),
          var props = try? JSONSerialization.jsonObject(with: propsData) as? [String: Any],
          let sessionId = props["sessionId"] as? String,
          !sessionId.isEmpty else {
      return nil
    }

    let eventId = UUID().uuidString.lowercased()
    var event: [String: Any] = [
      "id": eventId,
      "sessionId": sessionId,
      "createdAt": Int64(Date().timeIntervalSince1970 * 1000)
    ]
    if let beerName = props["repeatBeerName"] as? String, !beerName.isEmpty {
      event["beerName"] = beerName
    }
    if let priceCzk = props["repeatBeerPriceCzk"] as? NSNumber {
      event["priceCzk"] = priceCzk.doubleValue
    }
    if let volumeMl = props["repeatBeerVolumeMl"] as? NSNumber {
      event["volumeMl"] = volumeMl.intValue
    }
    if let servingType = props["repeatBeerServingType"] as? String, !servingType.isEmpty {
      event["servingType"] = servingType
    }

    do {
      try persist(event: event, id: eventId)
    } catch {
      // Never show a count that was not durably recorded for app reconciliation.
      print("[ExpoWidgets] Could not persist pending beer add: \\(error.localizedDescription)")
      return nil
    }

    let currentCount = (props["beerCount"] as? NSNumber)?.intValue ?? 0
    props["beerCount"] = currentCount + 1
    // The isolated intent cannot recalculate the aggregate total. Hide the stale
    // value until JS commits the repeated drink and sends a formatted payload.
    props["totalPrice"] = ""
    let timeFormatter = DateFormatter()
    timeFormatter.locale = Locale(identifier: "cs_CZ")
    timeFormatter.dateFormat = "H:mm"
    props["latestBeerAt"] = timeFormatter.string(from: Date())

    if let updatedData = try? JSONSerialization.data(withJSONObject: props),
       let updatedProps = String(data: updatedData, encoding: .utf8) {
      let state = LiveActivityAttributes.ContentState(
        name: activity.content.state.name,
        props: updatedProps
      )
      await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    return eventId
  }

  private func persist(event: [String: Any], id: String) throws {
    guard let groupIdentifier = Bundle.main.object(
      forInfoDictionaryKey: "ExpoWidgetsAppGroupIdentifier"
    ) as? String,
    let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: groupIdentifier
    ) else {
      throw CocoaError(.fileNoSuchFile)
    }

    let directory = container.appendingPathComponent(
      beerLiveActivityPendingAddsDirectory,
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )

    let data = try JSONSerialization.data(withJSONObject: event)
    let destination = directory.appendingPathComponent(id).appendingPathExtension("json")
    try data.write(to: destination, options: .atomic)
  }
}

@available(iOS 16.0, *)
struct LiveActivityUserInteraction: LiveActivityIntent {
  // title is not used for non-discoverable intents, but it is required
  static var title: LocalizedStringResource = "User Interaction"
  static var isDiscoverable: Bool = false

  @Parameter(title: "source")
  var source: String?

  @Parameter(title: "target")
  var target: String?

  init() {}
  init(source: String?, target: String?) {
    self.source = source
    self.target = target
  }

  func perform() async throws -> some IntentResult {
    var pendingAddId: String?
    if target == beerLiveActivityAddTarget,
       let source,
       #available(iOS 16.2, *) {
      // LiveActivityIntent runs in the app process without opening the app.
      // Persist first, then update the glanceable count optimistically.
      pendingAddId = await BeerLiveActivityInteractionCoordinator.shared.addBeer(
        activityId: source
      )
    }

    WidgetsEvents.shared.sendNotification(type: .userEvent, data: [
      "source": source as Any,
      "target": target as Any,
      "pendingAddId": pendingAddId as Any,
      "timestamp": Int(Date().timeIntervalSince1970 * 1000)
    ])

    return .result()
  }
}`;

if (!fs.existsSync(appIntentFile)) {
  console.warn('[patch-expo-widgets-live-activity] expo-widgets iOS source not found; skipping');
  process.exit(0);
}

let source = fs.readFileSync(appIntentFile, 'utf8');

if (source.includes('BeerLiveActivityInteractionCoordinator')) {
  const countUpdate = `    props["beerCount"] = currentCount + 1`;
  const totalPriceReset = `    props["totalPrice"] = ""`;
  const snapshotAnchor = `    let event: [String: Any] = [
      "id": eventId,
      "sessionId": sessionId,
      "createdAt": Int64(Date().timeIntervalSince1970 * 1000)
    ]`;
  const snapshotBlock = `    var event: [String: Any] = [
      "id": eventId,
      "sessionId": sessionId,
      "createdAt": Int64(Date().timeIntervalSince1970 * 1000)
    ]
    if let beerName = props["repeatBeerName"] as? String, !beerName.isEmpty {
      event["beerName"] = beerName
    }
    if let priceCzk = props["repeatBeerPriceCzk"] as? NSNumber {
      event["priceCzk"] = priceCzk.doubleValue
    }
    if let volumeMl = props["repeatBeerVolumeMl"] as? NSNumber {
      event["volumeMl"] = volumeMl.intValue
    }
    if let servingType = props["repeatBeerServingType"] as? String, !servingType.isEmpty {
      event["servingType"] = servingType
    }`;
  const latestTimeUpdate = `    let timeFormatter = DateFormatter()
    timeFormatter.locale = Locale(identifier: "cs_CZ")
    timeFormatter.dateFormat = "H:mm"
    props["latestBeerAt"] = timeFormatter.string(from: Date())`;
  const priceResetBlock = `${countUpdate}
    // Hide the stale total until JS commits the repeated drink and re-syncs.
${totalPriceReset}`;
  const malformedPriceResetBlock = `${countUpdate}
+    // Hide the stale total until JS commits the repeated drink and re-syncs.
+${totalPriceReset}`;
  if (source.includes(malformedPriceResetBlock)) {
    source = source.replace(malformedPriceResetBlock, priceResetBlock);
  }
  if (!source.includes(totalPriceReset)) {
    if (!source.includes(countUpdate)) {
      console.error('[patch-expo-widgets-live-activity] patched count update shape changed');
      process.exit(1);
    }
    source = source.replace(countUpdate, priceResetBlock);
  }
  if (!source.includes('event["beerName"] = beerName')) {
    if (!source.includes(snapshotAnchor)) {
      console.error('[patch-expo-widgets-live-activity] pending event shape changed');
      process.exit(1);
    }
    source = source.replace(snapshotAnchor, snapshotBlock);
  }
  if (!source.includes('props["latestBeerAt"] = timeFormatter.string(from: Date())')) {
    source = source.replace(totalPriceReset, `${totalPriceReset}
${latestTimeUpdate}`);
  }
  fs.writeFileSync(appIntentFile, source);
  console.log('[patch-expo-widgets-live-activity] durable add-beer intent is current');
  process.exit(0);
}

if (!source.includes(originalImports) || !source.includes(originalLiveActivityIntent)) {
  console.error('[patch-expo-widgets-live-activity] expected expo-widgets AppIntent.swift shape changed');
  process.exit(1);
}

source = source
  .replace(originalImports, patchedImports)
  .replace(originalLiveActivityIntent, patchedLiveActivityIntent);

fs.writeFileSync(appIntentFile, source);
console.log('[patch-expo-widgets-live-activity] added durable add-beer LiveActivityIntent');
