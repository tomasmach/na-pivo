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

final class NaPivoWearableBridgeStore {
  static let shared = NaPivoWearableBridgeStore()

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

  func persistIncomingCommand(_ data: Data) throws {
    try queue.sync {
      let fields = try validatedEnvelope(data, requiredKind: "command")
      guard let messageId = fields["messageId"] as? String, UUID(uuidString: messageId) != nil
      else {
        throw NaPivoWearableBridgeError.malformedEnvelope
      }
      let directory = try inboxDirectory(create: true)
      let file = directory.appendingPathComponent(messageId).appendingPathExtension("json")
      if !FileManager.default.fileExists(atPath: file.path) {
        try protectedWrite(data, to: file)
      }
      var metadata = try readMetadata()
      metadata.lastReceivedAt = isoFormatter.string(from: Date())
      try writeMetadata(metadata)
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

  func makeAcknowledgement(for messageIds: [String]) throws -> Data {
    try queue.sync {
      let uniqueIds = Array(Set(messageIds)).sorted()
      guard !uniqueIds.isEmpty else {
        throw NaPivoWearableBridgeError.invalidMessageId
      }
      guard uniqueIds.allSatisfy({ UUID(uuidString: $0) != nil }) else {
        throw NaPivoWearableBridgeError.invalidMessageId
      }

      var metadata = try readMetadata()
      guard
        let snapshotJson = metadata.latestSnapshotJson,
        let snapshotData = snapshotJson.data(using: .utf8),
        let snapshot = try JSONSerialization.jsonObject(with: snapshotData) as? [String: Any],
        let accountEpoch = snapshot["accountEpoch"] as? String,
        UUID(uuidString: accountEpoch) != nil,
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
      let directory = try inboxDirectory(create: false)
      guard FileManager.default.fileExists(atPath: directory.path) else { return }
      for messageId in Set(messageIds) {
        guard UUID(uuidString: messageId) != nil else {
          throw NaPivoWearableBridgeError.invalidMessageId
        }
        let file = directory.appendingPathComponent(messageId).appendingPathExtension("json")
        do {
          try FileManager.default.removeItem(at: file)
        } catch let error as CocoaError where error.code == .fileNoSuchFile {
          continue
        }
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
    return directory
  }

  private func containerURL() throws -> URL {
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
  }
}
