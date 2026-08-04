import Foundation

private let wearableAppGroup = "group.com.tomasmach.na-pivo"

enum NaPivoWearableBridgeError: LocalizedError {
  case appGroupUnavailable
  case malformedEnvelope
  case snapshotRequired
  case invalidMessageId

  var errorDescription: String? {
    switch self {
    case .appGroupUnavailable:
      "The wearable app-group container is unavailable."
    case .malformedEnvelope:
      "The wearable envelope does not match protocol v1."
    case .snapshotRequired:
      "Publish a durable state snapshot before acknowledging commands."
    case .invalidMessageId:
      "A command acknowledgement contains an invalid message id."
    }
  }
}

struct NaPivoWearableBridgeStatus {
  let pendingCommands: Int
  let lastReceivedAt: String?
  let lastSentAt: String?
}

enum NaPivoWearableConnectivityPolicy {
  static func allowsTransport(activationStateIsActivated: Bool) -> Bool {
    activationStateIsActivated
  }

  static func connectionStatus(
    activationStateIsActivated: Bool,
    paired: @autoclosure () -> Bool,
    reachable: @autoclosure () -> Bool
  ) -> (paired: Bool, reachable: Bool) {
    guard activationStateIsActivated else {
      return (paired: false, reachable: false)
    }
    return (paired: paired(), reachable: reachable())
  }

  static func shouldRemoveAcknowledgedCommands(
    activationStateWasActivated: Bool,
    acknowledgementTransferWasScheduled: Bool
  ) -> Bool {
    activationStateWasActivated && acknowledgementTransferWasScheduled
  }

  static func shouldWakePendingCommands(
    activationStateIsActivated: Bool,
    pendingCommandCount: Int
  ) -> Bool {
    activationStateIsActivated && pendingCommandCount > 0
  }
}

final class NaPivoWearableSnapshotTransportGate {
  private let lock = NSLock()

  func sync<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
}

final class NaPivoWearableBridgeStore {
  static let shared = NaPivoWearableBridgeStore()
  private static let acknowledgedActorsFile =
    "wearable-bridge-acknowledged-actors-v1.json"
  private static let maxAcknowledgedActorEntries = 128
  private static let maxSparseAcknowledgedSequences = 128
  private static let maxSafeActorSequence = 9_007_199_254_740_991

#if NAPIVO_BRIDGE_TESTS
  private var testContainerURL: URL?

  static func makeTestStore(containerURL: URL) -> NaPivoWearableBridgeStore {
    let store = NaPivoWearableBridgeStore()
    store.testContainerURL = containerURL
    return store
  }
#endif

  private struct Metadata: Codable {
    var bridgeActorId: String
    var bridgeActorSequence: Int
    var latestSnapshotJson: String?
    var lastReceivedAt: String?
    var lastSentAt: String?

    static func empty() -> Metadata {
      Metadata(
        bridgeActorId: "phone-bridge-\(UUID().uuidString.lowercased())",
        bridgeActorSequence: 0,
        latestSnapshotJson: nil,
        lastReceivedAt: nil,
        lastSentAt: nil
      )
    }
  }

  private struct PendingSortKey: Comparable {
    let actorId: String
    let sequence: Int
    let messageId: String

    static func < (lhs: PendingSortKey, rhs: PendingSortKey) -> Bool {
      if lhs.actorId != rhs.actorId { return lhs.actorId < rhs.actorId }
      if lhs.sequence != rhs.sequence { return lhs.sequence < rhs.sequence }
      return lhs.messageId < rhs.messageId
    }
  }

  private struct AcknowledgedActorEntry: Codable, Hashable {
    let accountEpoch: String
    let actorId: String
    let acknowledgedThrough: Int
    let sparseSequences: [Int]
  }

  private struct AcknowledgedCommandIdentity {
    let accountEpoch: String
    let actorId: String
    let actorSequence: Int
  }

  private struct AcknowledgedActorLedger: Codable {
    let version: Int
    var entries: [AcknowledgedActorEntry]

    static let empty = AcknowledgedActorLedger(version: 1, entries: [])
  }

  private let queue = DispatchQueue(label: "cz.napivo.wearable-bridge.store")
  private let encoder: JSONEncoder = {
    let value = JSONEncoder()
    value.outputFormatting = [.sortedKeys]
    return value
  }()
  private let decoder = JSONDecoder()
  private let isoFormatter = ISO8601DateFormatter()

  private init() {
    isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  }

  @discardableResult
  func persistIncomingCommand(_ data: Data) throws -> Bool {
    try queue.sync {
      let fields = try validatedEnvelope(data, requiredKind: "command")
      guard
        let rawMessageId = fields["messageId"] as? String,
        let messageId = canonicalUUIDString(rawMessageId)
      else {
        throw NaPivoWearableBridgeError.malformedEnvelope
      }
      let directory = try inboxDirectory(create: true)
      let file = directory.appendingPathComponent(messageId).appendingPathExtension("json")
      let existingFile = try commandFiles(in: directory).first {
        canonicalMessageId(for: $0) == messageId
      }
      var metadata = try readMetadata()
      let didPersist: Bool
      if let existingFile,
        let existingData = try? Data(contentsOf: existingFile),
        try canReplaceProvisionalCommand(
          existingData,
          with: data,
          expectedAccountEpoch: latestSnapshotAccountEpoch(from: metadata)
        )
      {
        try protectedWrite(data, to: existingFile)
        didPersist = true
      } else if existingFile == nil {
        try protectedWrite(data, to: file)
        didPersist = true
      } else {
        didPersist = false
      }
      metadata.lastReceivedAt = isoFormatter.string(from: Date())
      try writeMetadata(metadata)
      return didPersist
    }
  }

  func pendingCommandJSON() throws -> [String] {
    try queue.sync {
      let directory = try inboxDirectory(create: false)
      guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
      let files = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
      ).filter { $0.pathExtension == "json" }

      let values: [(PendingSortKey, String)] = files.compactMap { file in
        guard
          let data = try? Data(contentsOf: file),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let actorId = object["actorId"] as? String,
          let sequence = object["actorSequence"] as? Int,
          let messageId = object["messageId"] as? String,
          let json = String(data: data, encoding: .utf8)
        else {
          return nil
        }
        return (PendingSortKey(actorId: actorId, sequence: sequence, messageId: messageId), json)
      }
      return values.sorted { $0.0 < $1.0 }.map(\.1)
    }
  }

  func saveSnapshot(_ json: String) throws -> Data {
    try queue.sync {
      guard let data = json.data(using: .utf8) else {
        throw NaPivoWearableBridgeError.malformedEnvelope
      }
      _ = try validatedEnvelope(data, requiredKind: "state_snapshot")
      var metadata = try readMetadata()
      metadata.latestSnapshotJson = json
      metadata.lastSentAt = isoFormatter.string(from: Date())
      try writeMetadata(metadata)
      return data
    }
  }

  func latestSnapshotData() throws -> Data? {
    try queue.sync {
      let metadata = try readMetadata()
      return metadata.latestSnapshotJson?.data(using: .utf8)
    }
  }

  func acknowledgedActorSequences(accountEpoch: String) throws -> [String: Int] {
    try queue.sync {
      guard let canonicalEpoch = canonicalUUIDString(accountEpoch) else {
        return [:]
      }
      var result: [String: Int] = [:]
      for entry in try readAcknowledgedActorLedger().entries
      where entry.accountEpoch == canonicalEpoch {
        guard isValidActorId(entry.actorId), entry.acknowledgedThrough > 0 else {
          continue
        }
        result[entry.actorId] = max(
          result[entry.actorId] ?? 0,
          entry.acknowledgedThrough
        )
      }
      return result
    }
  }

  func clearSnapshotMetadataPreservingInbox() throws {
    try queue.sync {
      // Rotate the bridge actor together with the private snapshot. The durable
      // command inbox belongs to the watch and must survive until JS accepts it.
      try writeMetadata(.empty())
    }
  }

  func makeAcknowledgement(for messageIds: [String]) throws -> Data {
    try queue.sync {
      guard !messageIds.isEmpty else {
        throw NaPivoWearableBridgeError.invalidMessageId
      }
      let uniqueIds = try Array(Set(messageIds.map { messageId in
        guard let canonical = canonicalUUIDString(messageId) else {
          throw NaPivoWearableBridgeError.invalidMessageId
        }
        return canonical
      })).sorted()

      guard !uniqueIds.isEmpty else {
        throw NaPivoWearableBridgeError.invalidMessageId
      }

      var metadata = try readMetadata()
      guard
        let snapshotJson = metadata.latestSnapshotJson,
        let snapshotData = snapshotJson.data(using: .utf8),
        let snapshot = try JSONSerialization.jsonObject(with: snapshotData) as? [String: Any],
        let rawAccountEpoch = snapshot["accountEpoch"] as? String,
        let accountEpoch = canonicalUUIDString(rawAccountEpoch),
        let payload = snapshot["payload"] as? [String: Any],
        let revision = payload["revision"] as? Int
      else {
        throw NaPivoWearableBridgeError.snapshotRequired
      }

      metadata.bridgeActorSequence += 1
      let now = isoFormatter.string(from: Date())
      let acknowledgement: [String: Any] = [
        "protocolVersion": 1,
        "messageId": UUID().uuidString.lowercased(),
        "accountEpoch": accountEpoch,
        "actorId": metadata.bridgeActorId,
        "actorKind": "phone",
        "actorSequence": metadata.bridgeActorSequence,
        "baseRevision": revision,
        "sentAt": now,
        "kind": "ack",
        "payload": [
          "acknowledgedMessageIds": uniqueIds,
          "revision": revision,
        ],
      ]
      let data = try JSONSerialization.data(
        withJSONObject: acknowledgement,
        options: [.sortedKeys]
      )
      metadata.lastSentAt = now
      try writeMetadata(metadata)
      return data
    }
  }

  func removeAcknowledgedCommands(_ messageIds: [String]) throws {
    try queue.sync {
      let canonicalIds = try Set(messageIds.map { messageId in
        guard let canonical = canonicalUUIDString(messageId) else {
          throw NaPivoWearableBridgeError.invalidMessageId
        }
        return canonical
      })
      let directory = try inboxDirectory(create: false)
      guard FileManager.default.fileExists(atPath: directory.path) else { return }
      let acknowledgedFiles = try commandFiles(in: directory).filter { file in
        guard
          let storedMessageId = canonicalMessageId(for: file),
          canonicalIds.contains(storedMessageId)
        else {
          return false
        }
        return true
      }

      let advances = acknowledgedFiles.compactMap(acknowledgedActorEntry)
      if !advances.isEmpty {
        var ledger = try readAcknowledgedActorLedger()
        for advance in advances {
          let previous = ledger.entries.first {
            $0.accountEpoch == advance.accountEpoch && $0.actorId == advance.actorId
          }
          ledger.entries.removeAll {
            $0.accountEpoch == advance.accountEpoch && $0.actorId == advance.actorId
          }
          var acknowledgedThrough = previous?.acknowledgedThrough ?? 0
          var sparseSequences = Set(previous?.sparseSequences ?? [])
          if advance.actorSequence > acknowledgedThrough {
            sparseSequences.insert(advance.actorSequence)
          }
          while acknowledgedThrough < Self.maxSafeActorSequence,
            sparseSequences.remove(acknowledgedThrough + 1) != nil
          {
            acknowledgedThrough += 1
          }
          ledger.entries.append(
            AcknowledgedActorEntry(
              accountEpoch: advance.accountEpoch,
              actorId: advance.actorId,
              acknowledgedThrough: acknowledgedThrough,
              sparseSequences: Array(
                sparseSequences
                  .filter {
                    $0 > acknowledgedThrough
                      && $0 <= Self.maxSafeActorSequence
                  }
                  .sorted()
                  .prefix(Self.maxSparseAcknowledgedSequences)
              )
            )
          )
        }
        ledger.entries = Array(
          ledger.entries.suffix(Self.maxAcknowledgedActorEntries)
        )
        // Persist transfer ownership before removing inbox facts. If a crash
        // splits these writes, a retained duplicate is safely stale; the
        // inverse order could strand the next sequence after account cleanup.
        try writeAcknowledgedActorLedger(ledger)
      }

      for file in acknowledgedFiles {
        try FileManager.default.removeItem(at: file)
      }
    }
  }

  func status() throws -> NaPivoWearableBridgeStatus {
    try queue.sync {
      let metadata = try readMetadata()
      let directory = try inboxDirectory(create: false)
      let count: Int
      if FileManager.default.fileExists(atPath: directory.path) {
        count = try FileManager.default.contentsOfDirectory(
          at: directory,
          includingPropertiesForKeys: nil,
          options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }.count
      } else {
        count = 0
      }
      return NaPivoWearableBridgeStatus(
        pendingCommands: count,
        lastReceivedAt: metadata.lastReceivedAt,
        lastSentAt: metadata.lastSentAt
      )
    }
  }

  private func validatedEnvelope(
    _ data: Data,
    requiredKind: String
  ) throws -> [String: Any] {
    guard
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["protocolVersion"] as? Int == 1,
      object["kind"] as? String == requiredKind,
      object["payload"] is [String: Any],
      let messageId = object["messageId"] as? String,
      UUID(uuidString: messageId) != nil,
      let accountEpoch = object["accountEpoch"] as? String,
      UUID(uuidString: accountEpoch) != nil,
      object["actorId"] is String,
      object["actorKind"] is String,
      object["actorSequence"] is Int,
      object["baseRevision"] is Int,
      object["sentAt"] is String
    else {
      throw NaPivoWearableBridgeError.malformedEnvelope
    }
    return object
  }

  private func readMetadata() throws -> Metadata {
    let file = try containerURL().appendingPathComponent("wearable-bridge-metadata-v1.json")
    guard let data = try? Data(contentsOf: file) else {
      return .empty()
    }
    return try decoder.decode(Metadata.self, from: data)
  }

  private func writeMetadata(_ metadata: Metadata) throws {
    let file = try containerURL().appendingPathComponent("wearable-bridge-metadata-v1.json")
    try protectedWrite(encoder.encode(metadata), to: file)
  }

  private func readAcknowledgedActorLedger() throws -> AcknowledgedActorLedger {
    let file = try containerURL().appendingPathComponent(
      Self.acknowledgedActorsFile
    )
    guard let data = try? Data(contentsOf: file) else {
      return .empty
    }
    guard
      let decoded = try? decoder.decode(AcknowledgedActorLedger.self, from: data),
      decoded.version == 1
    else {
      return .empty
    }
    var entries: [AcknowledgedActorEntry] = []
    for entry in decoded.entries.suffix(Self.maxAcknowledgedActorEntries) {
      guard
        let accountEpoch = canonicalUUIDString(entry.accountEpoch),
        isValidActorId(entry.actorId),
        entry.acknowledgedThrough >= 0,
        entry.acknowledgedThrough <= Self.maxSafeActorSequence
      else {
        continue
      }
      let sparseSequences = Array(
        Set(entry.sparseSequences)
          .filter {
            $0 > entry.acknowledgedThrough
              && $0 <= Self.maxSafeActorSequence
          }
          .sorted()
          .prefix(Self.maxSparseAcknowledgedSequences)
      )
      entries.removeAll {
        $0.accountEpoch == accountEpoch && $0.actorId == entry.actorId
      }
      entries.append(
        AcknowledgedActorEntry(
          accountEpoch: accountEpoch,
          actorId: entry.actorId,
          acknowledgedThrough: entry.acknowledgedThrough,
          sparseSequences: sparseSequences
        )
      )
    }
    return AcknowledgedActorLedger(version: 1, entries: entries)
  }

  private func writeAcknowledgedActorLedger(
    _ ledger: AcknowledgedActorLedger
  ) throws {
    let file = try containerURL().appendingPathComponent(
      Self.acknowledgedActorsFile
    )
    try protectedWrite(encoder.encode(ledger), to: file)
  }

  private func acknowledgedActorEntry(
    for file: URL
  ) -> AcknowledgedCommandIdentity? {
    guard
      let data = try? Data(contentsOf: file),
      let object = try? validatedEnvelope(data, requiredKind: "command"),
      let rawEpoch = object["accountEpoch"] as? String,
      let accountEpoch = canonicalUUIDString(rawEpoch),
      let actorId = object["actorId"] as? String,
      isValidActorId(actorId),
      let sequence = object["actorSequence"] as? Int,
      sequence > 0,
      sequence <= Self.maxSafeActorSequence
    else {
      return nil
    }
    return AcknowledgedCommandIdentity(
      accountEpoch: accountEpoch,
      actorId: actorId,
      actorSequence: sequence
    )
  }

  private func isValidActorId(_ actorId: String) -> Bool {
    guard actorId.utf8.count == actorId.count, (1...128).contains(actorId.count) else {
      return false
    }
    return actorId.unicodeScalars.allSatisfy { scalar in
      switch scalar.value {
      case 48...57, 65...90, 97...122, 45, 46, 58, 95:
        true
      default:
        false
      }
    }
  }

  private func canonicalUUIDString(_ value: String) -> String? {
    UUID(uuidString: value)?.uuidString.lowercased()
  }

  private func latestSnapshotAccountEpoch(from metadata: Metadata) -> String? {
    guard
      let snapshotJson = metadata.latestSnapshotJson,
      let data = snapshotJson.data(using: .utf8),
      let snapshot = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let rawAccountEpoch = snapshot["accountEpoch"] as? String
    else {
      return nil
    }
    return canonicalUUIDString(rawAccountEpoch)
  }

  private func canReplaceProvisionalCommand(
    _ existingData: Data,
    with incomingData: Data,
    expectedAccountEpoch: String?
  ) throws -> Bool {
    guard
      let expectedAccountEpoch,
      let existing = try? validatedEnvelope(existingData, requiredKind: "command"),
      let incoming = try? validatedEnvelope(incomingData, requiredKind: "command"),
      let existingRawEpoch = existing["accountEpoch"] as? String,
      let existingEpoch = canonicalUUIDString(existingRawEpoch),
      let incomingRawEpoch = incoming["accountEpoch"] as? String,
      let incomingEpoch = canonicalUUIDString(incomingRawEpoch),
      incomingEpoch == expectedAccountEpoch,
      existingEpoch != expectedAccountEpoch,
      let existingRawMessageId = existing["messageId"] as? String,
      let incomingRawMessageId = incoming["messageId"] as? String,
      let existingMessageId = canonicalUUIDString(existingRawMessageId),
      let incomingMessageId = canonicalUUIDString(incomingRawMessageId),
      existingMessageId == incomingMessageId
    else {
      return false
    }

    var existingComparable = existing
    var incomingComparable = incoming
    existingComparable.removeValue(forKey: "accountEpoch")
    incomingComparable.removeValue(forKey: "accountEpoch")
    existingComparable["messageId"] = existingMessageId
    incomingComparable["messageId"] = incomingMessageId
    let existingCanonicalData = try JSONSerialization.data(
      withJSONObject: existingComparable,
      options: [.sortedKeys]
    )
    let incomingCanonicalData = try JSONSerialization.data(
      withJSONObject: incomingComparable,
      options: [.sortedKeys]
    )
    return existingCanonicalData == incomingCanonicalData
  }

  private func canonicalMessageId(for file: URL) -> String? {
    guard file.pathExtension == "json" else { return nil }
    return canonicalUUIDString(file.deletingPathExtension().lastPathComponent)
  }

  private func commandFiles(in directory: URL) throws -> [URL] {
    try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    ).filter { $0.pathExtension == "json" }
  }

  private func inboxDirectory(create: Bool) throws -> URL {
    let directory = try containerURL().appendingPathComponent(
      "WearableBridgeInbox-v1",
      isDirectory: true
    )
    if create, !FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true
      )
    }
    if FileManager.default.fileExists(atPath: directory.path) {
      try excludeFromBackup(directory)
    }
    return directory
  }

  private func containerURL() throws -> URL {
#if NAPIVO_BRIDGE_TESTS
    if let testContainerURL {
      return testContainerURL
    }
#endif
    guard
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: wearableAppGroup
      )
    else {
      throw NaPivoWearableBridgeError.appGroupUnavailable
    }
    return container
  }

  private func protectedWrite(_ data: Data, to url: URL) throws {
    try data.write(
      to: url,
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
    )
    try excludeFromBackup(url)
  }

  private func excludeFromBackup(_ url: URL) throws {
    var protectedURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protectedURL.setResourceValues(values)
  }
}
