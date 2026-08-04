import Foundation

private enum ProbeError: LocalizedError {
  case invalidArguments
  case unexpectedFixture(String)
  case failedAssertion(String)

  var errorDescription: String? {
    switch self {
    case .invalidArguments:
      "Expected the shared fixture directory as the only argument."
    case .unexpectedFixture(let filename):
      "Unexpected fixture: \(filename)"
    case .failedAssertion(let message):
      message
    }
  }
}

@main
private enum ContractFixtureProbe {
  static func main() throws {
    guard CommandLine.arguments.count == 2 else {
      throw ProbeError.invalidArguments
    }
    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    try verifyCommandFixtures(in: directory)
    try verifySnapshotFixture(in: directory)
    try verifyRepeatIdentity()
    try verifyDrinkRules()
    try verifyGeohashParity()
    try verifyNearbyTargetParity()
    try verifyCrashRecoveryBeforeNextMutation()
    try verifyFirstPairRebindsPendingOutbox()
    try verifyAcknowledgementPersistsBeforeUI()
    try verifyStaleSnapshotCannotRegressAcknowledgedState()
    try verifyAccountChangeResetsRevisionWithoutOutbox()
    print("Apple Watch contract fixtures: OK")
  }

  private static func verifyCommandFixtures(in directory: URL) throws {
    let filenames = [
      "custom-beer-command.v1.json",
      "remove-drink-command.v1.json",
      "start-evening-command.v1.json",
    ]
    let decoder = WearableEnvelopeDecoder.decoder()

    for filename in filenames {
      let data = try Data(contentsOf: directory.appendingPathComponent(filename))
      let envelope = try decoder.decode(CommandEnvelope.self, from: data)
      try require(envelope.protocolVersion == WearableProtocol.version, "Wrong protocol version.")
      try require(envelope.kind == "command", "Command fixture has the wrong kind.")

      switch (filename, envelope.payload.command) {
      case ("custom-beer-command.v1.json", .addDrink(_, let drink)):
        try require(drink.drinkType == .beer, "Custom drink lost its type.")
        try require(drink.volumeMl == 450, "Custom 450 ml volume was not preserved.")
      case ("remove-drink-command.v1.json", .removeDrink):
        break
      case ("start-evening-command.v1.json", .startEveningAndAddDrink):
        break
      default:
        throw ProbeError.unexpectedFixture(filename)
      }
    }
  }

  private static func verifySnapshotFixture(in directory: URL) throws {
    let data = try Data(
      contentsOf: directory.appendingPathComponent("state-snapshot.v1.json")
    )
    let snapshot = try WearableEnvelopeDecoder.decoder().decode(
      StateSnapshotEnvelope.self,
      from: data
    )
    try require(snapshot.kind == "state_snapshot", "Snapshot fixture has the wrong kind.")
    try require(snapshot.payload.recentDrinks.count == 1, "Recent choices did not decode.")
    try require(snapshot.payload.frequentDrinks.isEmpty, "Frequent choices did not decode.")
    try require(snapshot.payload.menuDrinks.count == 1, "Menu choices did not decode.")
    try require(
      snapshot.payload.menuDrinks[0].priceCzk == nil,
      "An unknown menu price must remain unknown."
    )
  }

  private static func verifyRepeatIdentity() throws {
    let template = DrinkTemplate(
      name: "Testovací ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft
    )
    let first = drink(from: template)
    let repeated = drink(from: template)
    try require(first.id != repeated.id, "Repeating a drink must mint a new fact UUID.")
  }

  private static func verifyDrinkRules() throws {
    try require(
      DrinkValidation.normalizedName("Pivo") == nil,
      "A generic beer name must be rejected."
    )
    try require(
      DrinkValidation.normalizedName("shot") == nil,
      "The generic English shot category must be rejected like the mobile contract."
    )
    try require(
      DrinkValidation.normalizedName(String(repeating: "a", count: 81)) == nil,
      "A drink name above the shared 80-character limit must be rejected."
    )
    try require(
      DrinkValidation.validVolume(450, for: .beer),
      "A custom beer volume must be accepted."
    )
    try require(
      DrinkValidation.validVolume(40, for: .shot),
      "A standard shot volume must be accepted."
    )
    try require(
      !DrinkValidation.validVolume(450, for: .shot),
      "A shot volume above 200 ml must be rejected."
    )
  }

  private static func verifyGeohashParity() throws {
    try require(
      Geohash.encode(latitude: 0, longitude: 0, precision: 8) == "7zzzzzzz",
      "Exact geohash midpoints must use the strict greater-than branch."
    )
    try require(
      Geohash.encode(latitude: 50.08706, longitude: 14.41786, precision: 8) == "u2fkbn4f",
      "Prague fixture geohash diverged from the mobile and backend encoders."
    )
  }

  private static func verifyNearbyTargetParity() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-nearby-target-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let pubA = PubRef(
      pubKey: "u2fkbn4f",
      name: "První hospoda",
      latitude: 50.08706,
      longitude: 14.41786
    )
    let pubB = PubRef(
      pubKey: "u2fkbn4g",
      name: "Druhá hospoda",
      latitude: 50.088,
      longitude: 14.42
    )
    let first = try WatchDataStore.updateNearbyPubs(
      [pubA],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_030)
    )
    try require(
      first.target == TargetState(selection: .nearest, pub: pubA),
      "The first nearby pub must become the nearest target when no target is selected."
    )

    let moved = try WatchDataStore.updateNearbyPubs(
      [pubB],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_031)
    )
    try require(
      moved.target == TargetState(selection: .nearest, pub: pubB),
      "A nearest target must follow the first result in the new nearby area."
    )

    let empty = try WatchDataStore.updateNearbyPubs(
      [],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_032)
    )
    try require(
      empty.nearbyPubs.isEmpty && empty.target == nil && !empty.isStale,
      "A genuine empty nearby result must clear the cache and its nearest target."
    )

    let manual = TargetState(selection: .manual, pub: pubA)
    _ = try WatchDataStore.enqueue(
      [.setTarget(manual)],
      at: Date(timeIntervalSince1970: 1_754_000_033)
    )
    let manualMoved = try WatchDataStore.updateNearbyPubs(
      [pubB],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_034)
    )
    let manualEmpty = try WatchDataStore.updateNearbyPubs(
      [],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_035)
    )
    try require(
      manualMoved.target == manual
        && manualEmpty.target == manual
        && manualEmpty.nearbyPubs.isEmpty,
      "Nearby updates, including genuine empty, must preserve a manual target."
    )
  }

  private static func verifyCrashRecoveryBeforeNextMutation() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-crash-recovery-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let initial = try WatchDataStore.loadState()
    let pub = PubRef(
      pubKey: "u2fkbn4f",
      name: "Testovací hospoda",
      latitude: 50.08706,
      longitude: 14.41786
    )
    let eveningId = UUID()
    let firstDrink = DrinkSpec(
      id: UUID(),
      name: "První ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_100)
    )
    let interruptedEnvelope = CommandEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: initial.accountEpoch,
      actorId: initial.actorId,
      actorKind: .watchOS,
      actorSequence: 1,
      baseRevision: 0,
      sentAt: firstDrink.recordedAt,
      kind: "command",
      payload: CommandPayload(
        command: .startEveningAndAddDrink(
          eveningId: eveningId,
          pub: pub,
          drinkingDayKey: "2025-08-01",
          drink: firstDrink
        )
      )
    )

    // Simulate power loss after the durable outbox rename but before state write.
    let interruptedOutbox = try WearableEnvelopeDecoder.encoder().encode([
      interruptedEnvelope
    ])
    try interruptedOutbox.write(
      to: container.appendingPathComponent("watch-outbox-v1.json"),
      options: .atomic
    )

    let recovered = try WatchDataStore.loadState()
    let persistedStateData = try Data(
      contentsOf: container.appendingPathComponent("watch-state-v1.json")
    )
    let persistedState = try WearableEnvelopeDecoder.decoder().decode(
      WatchLocalState.self,
      from: persistedStateData
    )
    try require(
      recovered.actorSequence == 1
        && recovered.activeEvening?.visibleDrinks.map(\.id) == [firstDrink.id]
        && recovered.pendingCommandCount == 1,
      "Loading after an interrupted commit must recover its optimistic fact and actor sequence."
    )
    try require(
      persistedState == recovered,
      "Crash recovery must repair the durable state before returning it to the UI."
    )

    let secondDrink = DrinkSpec(
      id: UUID(),
      name: "Druhý ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_101)
    )
    let next = try WatchDataStore.enqueue([
      .addDrink(eveningId: eveningId, drink: secondDrink)
    ])
    let afterNextMutation = try WatchDataStore.loadState()
    try require(
      next.first?.actorSequence == 2,
      "The first mutation after recovery must not recycle a pending actor sequence."
    )
    try require(
      afterNextMutation.activeEvening?.visibleDrinks.map(\.id) == [
        firstDrink.id, secondDrink.id,
      ],
      "The next mutation must build on every recovered optimistic fact."
    )
  }

  private static func verifyFirstPairRebindsPendingOutbox() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-first-pair-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let provisional = try WatchDataStore.loadState()
    let pub = PubRef(
      pubKey: "u2fkbn4f",
      name: "Testovací hospoda",
      latitude: 50.08706,
      longitude: 14.41786
    )
    let drink = DrinkSpec(
      id: UUID(),
      name: "Phoneless ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_110)
    )
    let pending = try WatchDataStore.enqueue([
      .startEveningAndAddDrink(
        eveningId: UUID(),
        pub: pub,
        drinkingDayKey: "2025-08-01",
        drink: drink
      )
    ])
    let phoneEpoch = UUID()
    let firstPhoneSnapshot = StateSnapshotEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: phoneEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 1,
      baseRevision: 0,
      sentAt: Date(timeIntervalSince1970: 1_754_000_111),
      kind: "state_snapshot",
      payload: StateSnapshotPayload(
        revision: 0,
        target: nil,
        activeEvening: nil,
        otherEvenings: [],
        nearbyPubs: [pub],
        recentDrinks: [],
        frequentDrinks: [],
        menuDrinks: [],
        pendingCommandCount: 1,
        isStale: false,
        lastPhoneContactAt: Date(timeIntervalSince1970: 1_754_000_111)
      )
    )
    let firstPhoneSnapshotData = try WearableEnvelopeDecoder.encoder().encode(firstPhoneSnapshot)
    let firstApplication = try WatchDataStore.applySnapshotEnvelopeData(firstPhoneSnapshotData)

    let reboundState = try WatchDataStore.loadState()
    let reboundOutbox = try WatchDataStore.loadOutbox()
    try require(
      reboundState.accountEpoch == phoneEpoch
        && reboundState.actorId == provisional.actorId
        && reboundState.actorSequence == 1
        && reboundState.syncIssue == nil,
      "A first phone snapshot must bind the provisional actor without creating an account conflict."
    )
    try require(
      reboundOutbox.map(\.messageId) == pending.map(\.messageId)
        && reboundOutbox.allSatisfy { $0.accountEpoch == phoneEpoch },
      "First pairing must rebind every pending envelope while preserving immutable identities."
    )
    try require(
      firstApplication.reboundOutbox == reboundOutbox,
      "The first pairing callback must expose the full atomically rewritten durable outbox for retry."
    )
    let duplicateApplication = try WatchDataStore.applySnapshotEnvelopeData(
      firstPhoneSnapshotData
    )
    try require(
      duplicateApplication.reboundOutbox.isEmpty,
      "A duplicate first-pair snapshot must not request a second explicit outbox flush."
    )
    try require(
      reboundState.activeEvening?.visibleDrinks.map(\.id) == [drink.id],
      "First-pair reconciliation must retain the phoneless optimistic drink."
    )

    let acknowledgement = AckEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: phoneEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 2,
      baseRevision: 1,
      sentAt: Date(timeIntervalSince1970: 1_754_000_112),
      kind: "ack",
      payload: AckPayload(
        acknowledgedMessageIds: reboundOutbox.map(\.messageId),
        revision: 1
      )
    )
    _ = try WatchDataStore.acknowledge(acknowledgement)
    let acknowledgedOutbox = try WatchDataStore.loadOutbox()
    try require(
      acknowledgedOutbox.isEmpty,
      "A rebound first-pair command must be acknowledgeable under the phone epoch."
    )
  }

  private static func verifyAcknowledgementPersistsBeforeUI() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-ack-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let initial = try WatchDataStore.loadState()
    let pending = try WatchDataStore.enqueue(
      [.clearTarget],
      at: Date(timeIntervalSince1970: 1_754_000_000)
    )
    try require(pending.count == 1, "The ACK probe must create one pending command.")

    let acknowledgement = AckEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: initial.accountEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 1,
      baseRevision: 0,
      sentAt: Date(timeIntervalSince1970: 1_754_000_001),
      kind: "ack",
      payload: AckPayload(
        acknowledgedMessageIds: [pending[0].messageId],
        revision: 1
      )
    )
    let data = try WearableEnvelopeDecoder.encoder().encode(acknowledgement)

    let applied = try WatchDataStore.acknowledgeEnvelopeData(data)
    let remainingOutbox = try WatchDataStore.loadOutbox()
    let persistedState = try WatchDataStore.loadState()

    try require(
      applied.envelope.messageId == acknowledgement.messageId,
      "The durable ACK path must decode the exact watch contract."
    )
    try require(
      remainingOutbox.isEmpty,
      "The ACK must prune the outbox before any UI callback runs."
    )
    try require(
      persistedState.pendingCommandCount == 0,
      "The persisted watch state must reflect the pruned outbox."
    )

    let snapshot = StateSnapshotEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: initial.accountEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 2,
      baseRevision: 1,
      sentAt: Date(timeIntervalSince1970: 1_754_000_002),
      kind: "state_snapshot",
      payload: StateSnapshotPayload(
        revision: 2,
        target: nil,
        activeEvening: nil,
        otherEvenings: [],
        nearbyPubs: [],
        recentDrinks: [],
        frequentDrinks: [],
        menuDrinks: [],
        pendingCommandCount: 0,
        isStale: false,
        lastPhoneContactAt: Date(timeIntervalSince1970: 1_754_000_002)
      )
    )
    let snapshotData = try WearableEnvelopeDecoder.encoder().encode(snapshot)

    _ = try WatchDataStore.applySnapshotEnvelopeData(snapshotData)

    let persistedSnapshotState = try WatchDataStore.loadState()
    try require(
      persistedSnapshotState.revision == 2 && !persistedSnapshotState.isStale,
      "The snapshot must persist before any UI callback runs."
    )
  }

  private static func verifyStaleSnapshotCannotRegressAcknowledgedState() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-stale-snapshot-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let initial = try WatchDataStore.loadState()
    let pub = PubRef(
      pubKey: "u2fkbn4f",
      name: "Testovací hospoda",
      latitude: 50.08706,
      longitude: 14.41786
    )
    let eveningId = UUID()
    let firstDrink = DrinkSpec(
      id: UUID(),
      name: "Testovací ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_010)
    )
    let secondDrink = DrinkSpec(
      id: UUID(),
      name: "Testovací nealko",
      drinkType: .softDrink,
      volumeMl: 500,
      priceCzk: 55,
      servingType: .bottle,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_011)
    )
    let pending = try WatchDataStore.enqueue(
      [
        .startEveningAndAddDrink(
          eveningId: eveningId,
          pub: pub,
          drinkingDayKey: "2025-08-01",
          drink: firstDrink
        ),
        .addDrink(eveningId: eveningId, drink: secondDrink),
      ],
      at: Date(timeIntervalSince1970: 1_754_000_012)
    )
    try require(pending.count == 2, "The stale snapshot probe must queue two facts.")

    let acknowledgement = AckEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: initial.accountEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 5,
      baseRevision: 0,
      sentAt: Date(timeIntervalSince1970: 1_754_000_013),
      kind: "ack",
      payload: AckPayload(
        acknowledgedMessageIds: pending.map(\.messageId),
        revision: 5
      )
    )
    let acknowledgementData = try WearableEnvelopeDecoder.encoder().encode(acknowledgement)
    _ = try WatchDataStore.acknowledgeEnvelopeData(acknowledgementData)

    let acknowledgedState = try WatchDataStore.loadState()
    let acknowledgedOutbox = try WatchDataStore.loadOutbox()
    try require(
      acknowledgedState.revision == 5
        && acknowledgedState.activeEvening?.visibleDrinks.count == 2,
      "ACK revision 5 must durably retain both committed drinks."
    )
    try require(
      acknowledgedOutbox.isEmpty,
      "The stale snapshot probe requires the ACK to prune the outbox first."
    )

    let staleEvening = EveningState(
      eveningId: eveningId,
      pub: pub,
      drinkingDayKey: "2025-08-01",
      startedAt: firstDrink.recordedAt,
      closedAt: nil,
      status: .active,
      drinks: [firstDrink],
      removedDrinkIds: []
    )
    let staleSnapshot = StateSnapshotEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: initial.accountEpoch,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 6,
      baseRevision: 3,
      sentAt: Date(timeIntervalSince1970: 1_754_000_014),
      kind: "state_snapshot",
      payload: StateSnapshotPayload(
        revision: 3,
        target: nil,
        activeEvening: staleEvening,
        otherEvenings: [],
        nearbyPubs: [pub],
        recentDrinks: [],
        frequentDrinks: [],
        menuDrinks: [],
        pendingCommandCount: 0,
        isStale: false,
        lastPhoneContactAt: Date(timeIntervalSince1970: 1_754_000_014)
      )
    )
    let staleSnapshotData = try WearableEnvelopeDecoder.encoder().encode(staleSnapshot)
    let ignored = try WatchDataStore.applySnapshotEnvelopeData(staleSnapshotData)
    let persistedState = try WatchDataStore.loadState()
    let persistedOutbox = try WatchDataStore.loadOutbox()
    let persistedWidget = WatchDataStore.loadWidgetSnapshot()

    try require(
      ignored.state.revision == 5
        && ignored.state.activeEvening?.visibleDrinks.count == 2
        && ignored.state.target?.pub.pubKey == pub.pubKey
        && ignored.state.isStale,
      "A revision 3 snapshot must not regress the in-memory state after ACK revision 5."
    )
    try require(
      persistedState.revision == 5
        && persistedState.activeEvening?.visibleDrinks.count == 2
        && persistedState.activeEvening?.visibleDrinks.contains(where: {
          $0.id == secondDrink.id
        }) == true,
      "A revision 3 snapshot must not overwrite the durable revision 5 state."
    )
    try require(
      persistedState.target?.pub.pubKey == pub.pubKey && persistedState.isStale,
      "A stale snapshot must not overwrite other durable snapshot fields."
    )
    try require(
      persistedState.pendingCommandCount == 0
        && persistedOutbox.isEmpty,
      "Ignoring a stale snapshot must keep the acknowledged outbox pruned."
    )
    try require(
      persistedWidget.beerCount == 1
        && persistedWidget.otherCount == 1
        && persistedWidget.totalCzk == 120
        && persistedWidget.pendingCommandCount == 0,
      "Ignoring a stale snapshot must retain the acknowledged widget state."
    )
  }

  private static func verifyAccountChangeResetsRevisionWithoutOutbox() throws {
    let container = FileManager.default.temporaryDirectory.appendingPathComponent(
      "napivo-watch-account-revision-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: container,
      withIntermediateDirectories: true
    )
    setenv("NAPIVO_WATCH_TEST_CONTAINER", container.path, 1)
    defer {
      unsetenv("NAPIVO_WATCH_TEST_CONTAINER")
      try? FileManager.default.removeItem(at: container)
    }

    let originalOldState = try WatchDataStore.loadState()
    let oldAccount = originalOldState.accountEpoch
    let oldActorId = originalOldState.actorId
    let oldPub = PubRef(
      pubKey: "u2fkbn4f",
      name: "Stará hospoda",
      latitude: 50.08706,
      longitude: 14.41786
    )
    let oldDrink = DrinkSpec(
      id: UUID(),
      name: "Starý ležák",
      drinkType: .beer,
      volumeMl: 500,
      priceCzk: 65,
      servingType: .draft,
      recordedAt: Date(timeIntervalSince1970: 1_754_000_020)
    )
    let oldPending = try WatchDataStore.enqueue(
      [
        .startEveningAndAddDrink(
          eveningId: UUID(),
          pub: oldPub,
          drinkingDayKey: "2025-08-01",
          drink: oldDrink
        )
      ],
      at: Date(timeIntervalSince1970: 1_754_000_020)
    )
    let oldAcknowledgement = AckEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: oldAccount,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 5,
      baseRevision: 0,
      sentAt: Date(timeIntervalSince1970: 1_754_000_021),
      kind: "ack",
      payload: AckPayload(
        acknowledgedMessageIds: oldPending.map(\.messageId),
        revision: 5
      )
    )
    let oldAcknowledgementData = try WearableEnvelopeDecoder.encoder().encode(
      oldAcknowledgement
    )
    _ = try WatchDataStore.acknowledgeEnvelopeData(oldAcknowledgementData)
    let acknowledgedOldState = try WatchDataStore.loadState()
    try require(
      acknowledgedOldState.revision == 5,
      "The account revision probe must begin at old-account revision 5."
    )
    _ = try WatchDataStore.updateNearbyPubs(
      [oldPub],
      refreshedAt: Date(timeIntervalSince1970: 1_754_000_021)
    )
    _ = try WatchDataStore.updateMenu(
      [
        DrinkTemplate(
          name: "Soukromý starý výběr",
          drinkType: .beer,
          volumeMl: 500,
          priceCzk: 65,
          servingType: .draft
        )
      ],
      for: oldPub.pubKey
    )

    let newAccount = UUID()
    let newAccountSnapshot = StateSnapshotEnvelope(
      protocolVersion: WearableProtocol.version,
      messageId: UUID(),
      accountEpoch: newAccount,
      actorId: "phone-contract-probe",
      actorKind: .phone,
      actorSequence: 1,
      baseRevision: 0,
      sentAt: Date(timeIntervalSince1970: 1_754_000_022),
      kind: "state_snapshot",
      payload: StateSnapshotPayload(
        revision: 0,
        target: nil,
        activeEvening: nil,
        otherEvenings: [],
        nearbyPubs: [],
        recentDrinks: [],
        frequentDrinks: [],
        menuDrinks: [],
        pendingCommandCount: 0,
        isStale: false,
        lastPhoneContactAt: Date(timeIntervalSince1970: 1_754_000_022)
      )
    )
    let newAccountSnapshotData = try WearableEnvelopeDecoder.encoder().encode(
      newAccountSnapshot
    )
    _ = try WatchDataStore.applySnapshotEnvelopeData(newAccountSnapshotData)

    let switchedState = try WatchDataStore.loadState()
    let switchedOutbox = try WatchDataStore.loadOutbox()
    try require(
      switchedState.accountEpoch == newAccount && switchedState.revision == 0,
      "An accepted new-account snapshot must reset the old account revision."
    )
    try require(
      switchedState.actorId != oldActorId && switchedState.actorSequence == 0,
      "A real account switch must mint a fresh watch actor and reset its sequence."
    )
    try require(
      switchedState.pubMenus.isEmpty
        && switchedState.lastNearbyRefreshAt == nil
        && switchedState.lastAcceptedDrinkAt == nil
        && switchedState.resolvedTargetMessageId == nil
        && switchedState.conflictingTarget == nil
        && switchedState.syncIssue == nil,
      "A real account switch must not carry private state or caches from the old account."
    )
    try require(
      switchedState.pendingCommandCount == 0
        && switchedOutbox.isEmpty,
      "A new account may be accepted only after the old outbox is empty."
    )

    let newPending = try WatchDataStore.enqueue(
      [.clearTarget],
      at: Date(timeIntervalSince1970: 1_754_000_023)
    )
    try require(
      newPending.count == 1
        && newPending[0].accountEpoch == newAccount
        && newPending[0].actorId == switchedState.actorId
        && newPending[0].actorSequence == 1
        && newPending[0].baseRevision == 0,
      "The first command for a new account must use its fresh actor and revision 0."
    )
  }

  private static func drink(from template: DrinkTemplate) -> DrinkSpec {
    DrinkSpec(
      id: UUID(),
      name: template.name,
      drinkType: template.drinkType,
      volumeMl: template.volumeMl!,
      priceCzk: template.priceCzk!,
      servingType: template.servingType,
      recordedAt: Date()
    )
  }

  private static func require(
    _ condition: @autoclosure () -> Bool,
    _ message: String
  ) throws {
    guard condition() else {
      throw ProbeError.failedAssertion(message)
    }
  }
}
