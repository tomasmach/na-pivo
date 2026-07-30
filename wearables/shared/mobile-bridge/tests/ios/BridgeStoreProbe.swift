import Foundation

private enum ProbeError: LocalizedError {
  case failedAssertion(String)

  var errorDescription: String? {
    switch self {
    case .failedAssertion(let message):
      message
    }
  }
}

@main
private enum BridgeStoreProbe {
  private static let messageId = "F4ED24C2-B261-4BF1-8BE9-6CB85F65266F"
  private static let accountEpoch = "83D78467-DA0D-4BED-9D75-D99A5E50C63B"
  private static let inboxName = "WearableBridgeInbox-v1"

  static func main() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-bridge-store-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    defer { try? FileManager.default.removeItem(at: container) }

    let store = NaPivoWearableBridgeStore.makeTestStore(containerURL: container)
    let uppercaseCommand = try envelopeData(
      kind: "command",
      messageId: messageId,
      accountEpoch: accountEpoch,
      payload: ["command": ["type": "clear_target"]]
    )
    let firstDeliveryWasNew = try store.persistIncomingCommand(uppercaseCommand)

    let canonicalMessageId = messageId.lowercased()
    try require(
      firstDeliveryWasNew,
      "The first delivery must wake the phone coordinator."
    )
    try require(
      try inboxFilenames(in: container) == ["\(canonicalMessageId).json"],
      "An uppercase Swift UUID must be stored under its lowercase canonical filename."
    )

    let lowercaseDuplicate = try envelopeData(
      kind: "command",
      messageId: canonicalMessageId,
      accountEpoch: accountEpoch.lowercased(),
      payload: ["command": ["type": "clear_target"]]
    )
    let duplicateDeliveryWasNew = try store.persistIncomingCommand(lowercaseDuplicate)
    try require(
      !duplicateDeliveryWasNew,
      "A duplicate delivery must not wake the phone coordinator into an ACK feedback loop."
    )
    try require(
      try inboxFilenames(in: container).count == 1,
      "UUID casing must not create a duplicate inbox command."
    )

    let snapshot = try envelopeData(
      kind: "state_snapshot",
      messageId: "2866F494-79BE-44FF-8A50-AF527C86D9E0",
      accountEpoch: accountEpoch,
      payload: ["revision": 7]
    )
    _ = try store.saveSnapshot(String(decoding: snapshot, as: UTF8.self))
    try verifySafeProvisionalReplacement(store: store, container: container)
    let watermarkBeforeAcknowledgement = try store.acknowledgedActorSequences(
      accountEpoch: accountEpoch
    )
    let acknowledgement = try store.makeAcknowledgement(
      for: [messageId, canonicalMessageId]
    )
    let acknowledgementObject = try JSONSerialization.jsonObject(
      with: acknowledgement
    ) as? [String: Any]
    let acknowledgementPayload = acknowledgementObject?["payload"] as? [String: Any]
    let decodedAcknowledgement = try WearableEnvelopeDecoder.decoder().decode(
      AckEnvelope.self,
      from: acknowledgement
    )
    try require(
      acknowledgementObject?["accountEpoch"] as? String == accountEpoch.lowercased(),
      "The acknowledgement account epoch must be canonical lowercase."
    )
    try require(
      acknowledgementPayload?["acknowledgedMessageIds"] as? [String] == [
        canonicalMessageId
      ],
      "The acknowledgement must deduplicate UUID identities case-insensitively."
    )
    try require(
      decodedAcknowledgement.payload.acknowledgedMessageIds == [
        UUID(uuidString: canonicalMessageId)!
      ],
      "The phone acknowledgement must decode through the exact watchOS contract."
    )
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch)
        == watermarkBeforeAcknowledgement,
      "Preparing an ACK must not advance ownership before durable transfer is scheduled."
    )

    try store.removeAcknowledgedCommands([canonicalMessageId])
    try require(
      try inboxFilenames(in: container).isEmpty,
      "A lowercase acknowledgement must remove its canonical inbox file."
    )
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch) == [
        "watchOS-Swift-UUID": 1
      ],
      "Inbox removal after ACK transfer must persist the actor watermark."
    )
    try require(
      try store.acknowledgedActorSequences(
        accountEpoch: "1F79646D-0F7B-444E-84C1-86895D26390C"
      ).isEmpty,
      "The watermark getter must never expose a different account epoch."
    )

    let legacyMessageId = "0FA34236-BBD6-4F15-AAF6-ED531BA85A51"
    let inbox = container.appendingPathComponent(inboxName, isDirectory: true)
    let legacyFile = inbox
      .appendingPathComponent(legacyMessageId)
      .appendingPathExtension("json")
    try envelopeData(
      kind: "command",
      messageId: legacyMessageId,
      accountEpoch: accountEpoch,
      payload: ["command": ["type": "clear_target"]]
    ).write(to: legacyFile)

    try store.removeAcknowledgedCommands([legacyMessageId.lowercased()])
    try require(
      try inboxFilenames(in: container).isEmpty,
      "A lowercase acknowledgement must remove a legacy uppercase inbox filename."
    )

    try verifyAcknowledgedLedgerRequiresContiguousSequences(store: store)
    try verifySnapshotResetPreservesInbox(
      store: store,
      container: container,
      snapshot: snapshot,
      previousBridgeActorId: decodedAcknowledgement.actorId,
      acknowledgedWatchActorId: "watchOS-Swift-UUID"
    )
    try verifySnapshotTransportGateSerializesClearAndPublish()
    try verifyActivationGateKeepsInboxDurable(store: store, container: container)

    print("iOS wearable bridge durability, privacy reset, and activation gate: OK")
  }

  private static func verifySafeProvisionalReplacement(
    store: NaPivoWearableBridgeStore,
    container: URL
  ) throws {
    let provisionalEpoch = "6A582D51-B585-4568-AE33-5BB56BC99E38"
    let reboundMessageId = "9A8BAEAC-C2B5-49B5-8B96-F33319F3323A"
    let provisional = try envelopeData(
      kind: "command",
      messageId: reboundMessageId,
      accountEpoch: provisionalEpoch,
      payload: ["command": ["type": "clear_target"]]
    )
    try require(
      try store.persistIncomingCommand(provisional),
      "A provisional first-pair command must enter the durable inbox."
    )
    let rebound = try envelopeData(
      kind: "command",
      messageId: reboundMessageId.lowercased(),
      accountEpoch: accountEpoch.lowercased(),
      payload: ["command": ["type": "clear_target"]]
    )
    try require(
      try store.persistIncomingCommand(rebound),
      "The phone must wake when it safely replaces a provisional command epoch."
    )
    let reboundObject = try inboxEnvelope(
      messageId: reboundMessageId,
      in: container
    )
    try require(
      (reboundObject["accountEpoch"] as? String)?.lowercased() == accountEpoch.lowercased(),
      "A byte-for-byte equivalent provisional command must adopt the latest phone epoch."
    )

    let alteredMessageId = "E82448C5-28BC-4D84-8B49-B9976F71075A"
    let alteredProvisional = try envelopeData(
      kind: "command",
      messageId: alteredMessageId,
      accountEpoch: provisionalEpoch,
      payload: ["command": ["type": "clear_target"]]
    )
    _ = try store.persistIncomingCommand(alteredProvisional)
    let changedPayload = try envelopeData(
      kind: "command",
      messageId: alteredMessageId,
      accountEpoch: accountEpoch,
      payload: [
        "command": [
          "type": "set_target",
          "target": ["selection": "nearest"],
        ]
      ]
    )
    let changedPayloadWasAccepted = try store.persistIncomingCommand(changedPayload)
    try require(
      !changedPayloadWasAccepted,
      "Changing a payload under an existing message id must never replace inbox data."
    )
    let retainedObject = try inboxEnvelope(
      messageId: alteredMessageId,
      in: container
    )
    try require(
      (retainedObject["accountEpoch"] as? String)?.lowercased()
        == provisionalEpoch.lowercased(),
      "A rejected replacement must leave the original provisional envelope untouched."
    )

    try store.removeAcknowledgedCommands([reboundMessageId, alteredMessageId])
  }

  private static func verifySnapshotResetPreservesInbox(
    store: NaPivoWearableBridgeStore,
    container: URL,
    snapshot: Data,
    previousBridgeActorId: String,
    acknowledgedWatchActorId: String
  ) throws {
    let pendingMessageId = "D58D8B9C-716C-4C4C-86BD-B8B1B421F760"
    let pendingCommand = try envelopeData(
      kind: "command",
      messageId: pendingMessageId,
      accountEpoch: accountEpoch,
      payload: ["command": ["type": "clear_target"]]
    )
    _ = try store.persistIncomingCommand(pendingCommand)
    try require(
      try store.latestSnapshotData() != nil,
      "The reset probe needs a private snapshot to remove."
    )

    try store.clearSnapshotMetadataPreservingInbox()

    try require(
      try store.latestSnapshotData() == nil,
      "Account teardown must remove the native snapshot."
    )
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch)[
        acknowledgedWatchActorId
      ] == 1,
      "Account teardown must preserve the non-private ACK watermark."
    )
    try require(
      try inboxFilenames(in: container) == [
        "\(pendingMessageId.lowercased()).json"
      ],
      "Account teardown must preserve every unacknowledged watch command."
    )
    let clearedStatus = try store.status()
    try require(
      clearedStatus.pendingCommands == 1
        && clearedStatus.lastReceivedAt == nil
        && clearedStatus.lastSentAt == nil,
      "Account teardown must clear private transport metadata without hiding the inbox."
    )
    do {
      _ = try store.makeAcknowledgement(for: [pendingMessageId])
      throw ProbeError.failedAssertion(
        "A cleared bridge must not acknowledge against the outgoing account snapshot."
      )
    } catch NaPivoWearableBridgeError.snapshotRequired {
      // Expected: the command remains durable until a replacement account publishes.
    }

    _ = try store.saveSnapshot(String(decoding: snapshot, as: UTF8.self))
    let replacementAcknowledgement = try store.makeAcknowledgement(
      for: [pendingMessageId]
    )
    let decodedReplacement = try WearableEnvelopeDecoder.decoder().decode(
      AckEnvelope.self,
      from: replacementAcknowledgement
    )
    try require(
      decodedReplacement.actorId != previousBridgeActorId
        && decodedReplacement.actorSequence == 1,
      "Account teardown must rotate native bridge actor metadata."
    )
    try store.removeAcknowledgedCommands([pendingMessageId])
  }

  private static func verifyAcknowledgedLedgerRequiresContiguousSequences(
    store: NaPivoWearableBridgeStore
  ) throws {
    let actorId = "watchos-gap-probe"
    let firstMessageId = "A2952709-C1F2-4D2D-8100-E5C4AE10299A"
    let secondMessageId = "BDAB5EAF-D6F0-4AFA-91C4-C6E2AD958A4C"
    let thirdMessageId = "A5D3BC80-F82C-4C89-AB13-C8A33E239480"
    for (messageId, sequence) in [
      (firstMessageId, 1),
      (thirdMessageId, 3),
    ] {
      _ = try store.persistIncomingCommand(
        envelopeData(
          kind: "command",
          messageId: messageId,
          accountEpoch: accountEpoch,
          payload: ["command": ["type": "clear_target"]],
          actorId: actorId,
          actorSequence: sequence
        )
      )
    }
    try store.removeAcknowledgedCommands([firstMessageId, thirdMessageId])
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch)[actorId] == 1,
      "ACKing sequence three before sequence two must expose only contiguous sequence one."
    )

    _ = try store.persistIncomingCommand(
      envelopeData(
        kind: "command",
        messageId: secondMessageId,
        accountEpoch: accountEpoch,
        payload: ["command": ["type": "clear_target"]],
        actorId: actorId,
        actorSequence: 2
      )
    )
    try store.removeAcknowledgedCommands([secondMessageId])
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch)[actorId] == 3,
      "Closing the sequence-two gap must advance through the sparse sequence three."
    )

    let privateActorMessageId = "4A0BA4FE-B655-45E8-AB5A-62266454D1B7"
    _ = try store.persistIncomingCommand(
      envelopeData(
        kind: "command",
        messageId: privateActorMessageId,
        accountEpoch: accountEpoch,
        payload: ["command": ["type": "clear_target"]],
        actorId: "U Zlatého tygra",
        actorSequence: 1
      )
    )
    try store.removeAcknowledgedCommands([privateActorMessageId])
    try require(
      try store.acknowledgedActorSequences(accountEpoch: accountEpoch)[
        "U Zlatého tygra"
      ] == nil,
      "The non-private ledger must reject actor ids that could carry private copy."
    )
  }

  private static func verifyActivationGateKeepsInboxDurable(
    store: NaPivoWearableBridgeStore,
    container: URL
  ) throws {
    let deferredMessageId = "18398D34-C02D-48A0-A6C4-A126E41399DE"
    let deferredCommand = try envelopeData(
      kind: "command",
      messageId: deferredMessageId,
      accountEpoch: accountEpoch,
      payload: ["command": ["type": "clear_target"]]
    )
    _ = try store.persistIncomingCommand(deferredCommand)

    var connectionPropertyReads = 0
    func readConnectionProperty() -> Bool {
      connectionPropertyReads += 1
      return true
    }
    let inactiveStatus = NaPivoWearableConnectivityPolicy.connectionStatus(
      activationStateIsActivated: false,
      paired: readConnectionProperty(),
      reachable: readConnectionProperty()
    )
    try require(
      !inactiveStatus.paired && !inactiveStatus.reachable,
      "Pairing and reachability must report false before activation."
    )
    try require(
      connectionPropertyReads == 0,
      "Connection properties must not be read before activation."
    )
    try require(
      !NaPivoWearableConnectivityPolicy.allowsTransport(
        activationStateIsActivated: false
      ),
      "WatchConnectivity traffic must be deferred before activation."
    )
    try require(
      !NaPivoWearableConnectivityPolicy.shouldRemoveAcknowledgedCommands(
        activationStateWasActivated: false,
        acknowledgementTransferWasScheduled: false
      ),
      "A deferred ACK must not claim its inbox command."
    )
    try require(
      !NaPivoWearableConnectivityPolicy.shouldWakePendingCommands(
        activationStateIsActivated: false,
        pendingCommandCount: 1
      ),
      "A pending command must not wake transport work before activation."
    )
    try require(
      try inboxFilenames(in: container) == [
        "\(deferredMessageId.lowercased()).json"
      ],
      "A command awaiting activation must remain durable in the inbox."
    )

    let activeStatus = NaPivoWearableConnectivityPolicy.connectionStatus(
      activationStateIsActivated: true,
      paired: readConnectionProperty(),
      reachable: readConnectionProperty()
    )
    try require(
      activeStatus.paired && activeStatus.reachable,
      "Active connection properties must be reported."
    )
    try require(
      connectionPropertyReads == 2,
      "Active status must read pairing and reachability exactly once."
    )
    try require(
      !NaPivoWearableConnectivityPolicy.shouldRemoveAcknowledgedCommands(
        activationStateWasActivated: true,
        acknowledgementTransferWasScheduled: false
      ),
      "An ACK must stay durable until its transfer is scheduled."
    )
    try require(
      NaPivoWearableConnectivityPolicy.shouldWakePendingCommands(
        activationStateIsActivated: true,
        pendingCommandCount: 1
      ),
      "Activation must wake deferred inbox work immediately."
    )
    try require(
      !NaPivoWearableConnectivityPolicy.shouldWakePendingCommands(
        activationStateIsActivated: true,
        pendingCommandCount: 0
      ),
      "Activation must not emit an empty inbox wake-up."
    )
    if NaPivoWearableConnectivityPolicy.shouldRemoveAcknowledgedCommands(
      activationStateWasActivated: true,
      acknowledgementTransferWasScheduled: true
    ) {
      try store.removeAcknowledgedCommands([deferredMessageId])
    }
    try require(
      try inboxFilenames(in: container).isEmpty,
      "A scheduled ACK may remove its durable inbox command."
    )
  }

  private static func verifySnapshotTransportGateSerializesClearAndPublish() throws {
    let gate = NaPivoWearableSnapshotTransportGate()
    let firstEntered = DispatchSemaphore(value: 0)
    let releaseFirst = DispatchSemaphore(value: 0)
    let secondStarted = DispatchSemaphore(value: 0)
    let secondEntered = DispatchSemaphore(value: 0)
    let finished = DispatchGroup()
    let queue = DispatchQueue(
      label: "cz.napivo.bridge-gate-probe",
      attributes: .concurrent
    )

    finished.enter()
    queue.async {
      gate.sync {
        _ = firstEntered.signal()
        releaseFirst.wait()
      }
      finished.leave()
    }
    try require(
      firstEntered.wait(timeout: .now() + 1) == .success,
      "The first snapshot transport operation must start."
    )

    finished.enter()
    queue.async {
      _ = secondStarted.signal()
      gate.sync {
        _ = secondEntered.signal()
      }
      finished.leave()
    }
    try require(
      secondStarted.wait(timeout: .now() + 1) == .success,
      "The competing snapshot transport operation must be scheduled."
    )
    try require(
      secondEntered.wait(timeout: .now() + 0.1) == .timedOut,
      "Clear and publish must never overlap their durable transport sections."
    )

    releaseFirst.signal()
    try require(
      secondEntered.wait(timeout: .now() + 1) == .success,
      "The competing snapshot transport operation must continue after clear finishes."
    )
    try require(
      finished.wait(timeout: .now() + 1) == .success,
      "Both serialized snapshot transport operations must finish."
    )
  }

  private static func envelopeData(
    kind: String,
    messageId: String,
    accountEpoch: String,
    payload: [String: Any],
    actorId: String = "watchOS-Swift-UUID",
    actorSequence: Int = 1
  ) throws -> Data {
    try JSONSerialization.data(
      withJSONObject: [
        "protocolVersion": 1,
        "messageId": messageId,
        "accountEpoch": accountEpoch,
        "actorId": actorId,
        "actorKind": "watchos",
        "actorSequence": actorSequence,
        "baseRevision": 0,
        "sentAt": "2026-07-30T19:01:00.000Z",
        "kind": kind,
        "payload": payload,
      ],
      options: [.sortedKeys]
    )
  }

  private static func inboxFilenames(in container: URL) throws -> [String] {
    let inbox = container.appendingPathComponent(inboxName, isDirectory: true)
    return try FileManager.default.contentsOfDirectory(
      at: inbox,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    ).map(\.lastPathComponent).sorted()
  }

  private static func inboxEnvelope(
    messageId: String,
    in container: URL
  ) throws -> [String: Any] {
    let file =
      container
      .appendingPathComponent(inboxName, isDirectory: true)
      .appendingPathComponent(messageId.lowercased())
      .appendingPathExtension("json")
    let data = try Data(contentsOf: file)
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ProbeError.failedAssertion("The stored inbox envelope is not a JSON object.")
    }
    return object
  }

  private static func require(
    _ condition: @autoclosure () throws -> Bool,
    _ message: String
  ) throws {
    guard try condition() else {
      throw ProbeError.failedAssertion(message)
    }
  }
}
