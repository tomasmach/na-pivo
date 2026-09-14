#if os(watchOS) || NAPIVO_CONTRACT_TESTS
  import Darwin
  import Foundation

  enum WatchSyncIssue: String, Codable {
    case accountChanged
    case targetConflict
    case eveningConflict

    var message: String {
      switch self {
      case .accountChanged:
        "Telefon má jiný účet. Nejdřív vyřeš neodeslané zápisy."
      case .targetConflict:
        "Telefon a hodinky míří jinam. Vyber, kam se jde."
      case .eveningConflict:
        "Vznikly dva večery v různých hospodách. Drinkům místo neměníme."
      }
    }
  }

  struct WatchLocalState: Codable, Hashable {
    var accountEpoch: UUID
    var actorId: String
    var actorSequence: Int
    var revision: Int
    var target: TargetState?
    var activeEvening: EveningState?
    var otherEvenings: [EveningState]
    var nearbyPubs: [PubRef]
    var recentDrinks: [DrinkChoice]
    var frequentDrinks: [DrinkChoice]
    var menuDrinks: [DrinkChoice]
    var snapshotMenuPubKey: String?
    var pubMenus: [String: [DrinkTemplate]]
    var isStale: Bool
    var lastPhoneContactAt: Date?
    var lastNearbyRefreshAt: Date?
    var lastAcceptedDrinkAt: Date?
    var syncIssue: WatchSyncIssue?
    var conflictingTarget: TargetState?
    var resolvedTargetMessageId: UUID?
    var pendingCommandCount: Int

    static func empty() -> WatchLocalState {
      WatchLocalState(
        accountEpoch: UUID(),
        actorId: "watchos-\(UUID().uuidString.lowercased())",
        actorSequence: 0,
        revision: 0,
        target: nil,
        activeEvening: nil,
        otherEvenings: [],
        nearbyPubs: [],
        recentDrinks: [],
        frequentDrinks: [],
        menuDrinks: [],
        snapshotMenuPubKey: nil,
        pubMenus: [:],
        isStale: true,
        lastPhoneContactAt: nil,
        lastNearbyRefreshAt: nil,
        lastAcceptedDrinkAt: nil,
        syncIssue: nil,
        conflictingTarget: nil,
        resolvedTargetMessageId: nil,
        pendingCommandCount: 0
      )
    }

    var allKnownPubs: [PubRef] {
      var seen = Set<String>()
      return ([target?.pub].compactMap { $0 } + nearbyPubs).filter {
        seen.insert($0.pubKey).inserted
      }
    }
  }

  struct WatchWidgetSnapshot: Codable, Hashable {
    let pubName: String?
    let beerCount: Int
    let otherCount: Int
    let totalCzk: Int
    let repeatDrinkName: String?
    let repeatDrinkSummary: String?
    let hasActiveEvening: Bool
    let pendingCommandCount: Int
    let updatedAt: Date

    static let empty = WatchWidgetSnapshot(
      pubName: nil,
      beerCount: 0,
      otherCount: 0,
      totalCzk: 0,
      repeatDrinkName: nil,
      repeatDrinkSummary: nil,
      hasActiveEvening: false,
      pendingCommandCount: 0,
      updatedAt: .distantPast
    )
  }

  enum WatchStoreError: Error {
    case appGroupUnavailable
    case lockUnavailable
    case invalidAcknowledgement
    case invalidSnapshot
    case noActiveEvening
    case noRepeatDrink
    case duplicateTap
    case accountConflict
  }

  enum WatchDataStore {
    private static let stateFile = "watch-state-v1.json"
    private static let outboxFile = "watch-outbox-v1.json"
    private static let widgetFile = "watch-widget-v1.json"
    private static let lockFile = "watch-state-v1.lock"
    private static let duplicateTapWindow: TimeInterval = 1.2

    static func loadState() throws -> WatchLocalState {
      try withLock {
        let outbox = try readOutbox()
        return try readRecoveredState(outbox: outbox)
      }
    }

    static func loadOutbox() throws -> [CommandEnvelope] {
      try withLock { try readOutbox() }
    }

    static func loadWidgetSnapshot() -> WatchWidgetSnapshot {
      guard let url = try? fileURL(widgetFile), let data = try? Data(contentsOf: url) else {
        return .empty
      }
      return (try? WearableEnvelopeDecoder.decoder().decode(WatchWidgetSnapshot.self, from: data))
        ?? .empty
    }

    @discardableResult
    static func enqueue(_ commands: [WearableCommand], at now: Date = Date()) throws
      -> [CommandEnvelope]
    {
      guard !commands.isEmpty else { return [] }
      return try withLock {
        var outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        guard state.syncIssue != .accountChanged else { throw WatchStoreError.accountConflict }
        var envelopes: [CommandEnvelope] = []

        for command in commands {
          if case .setTarget = command {
            state.resolvedTargetMessageId = nil
          } else if case .clearTarget = command {
            state.resolvedTargetMessageId = nil
          }
          state.actorSequence += 1
          let envelope = CommandEnvelope(
            protocolVersion: WearableProtocol.version,
            messageId: UUID(),
            accountEpoch: state.accountEpoch,
            actorId: state.actorId,
            actorKind: .watchOS,
            actorSequence: state.actorSequence,
            baseRevision: state.revision,
            sentAt: now,
            kind: "command",
            payload: CommandPayload(command: command)
          )
          outbox.append(envelope)
          apply(command, to: &state)
          envelopes.append(envelope)
        }

        state.pendingCommandCount = outbox.count
        try write(outbox, to: outboxFile)
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
        return envelopes
      }
    }

    static func acknowledge(_ ack: AckEnvelope) throws -> WatchLocalState {
      try withLock {
        var outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        guard ack.protocolVersion == WearableProtocol.version else { return state }
        guard ack.accountEpoch == state.accountEpoch else { return state }
        let acknowledged = Set(ack.payload.acknowledgedMessageIds)
        outbox.removeAll { acknowledged.contains($0.messageId) }
        if let resolved = state.resolvedTargetMessageId, acknowledged.contains(resolved) {
          state.resolvedTargetMessageId = nil
        }
        state.revision = max(state.revision, ack.payload.revision)
        state.lastPhoneContactAt = Date()
        state.pendingCommandCount = outbox.count
        try write(outbox, to: outboxFile)
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
        return state
      }
    }

    static func acknowledgeEnvelopeData(_ data: Data) throws
      -> (envelope: AckEnvelope, state: WatchLocalState)
    {
      let acknowledgement = try WearableEnvelopeDecoder.decoder().decode(
        AckEnvelope.self,
        from: data
      )
      guard acknowledgement.kind == "ack" else {
        throw WatchStoreError.invalidAcknowledgement
      }
      return (
        envelope: acknowledgement,
        state: try acknowledge(acknowledgement)
      )
    }

    static func applySnapshotEnvelopeData(_ data: Data) throws
      -> (
        envelope: StateSnapshotEnvelope,
        state: WatchLocalState,
        reboundOutbox: [CommandEnvelope]
      )
    {
      let snapshot = try WearableEnvelopeDecoder.decoder().decode(
        StateSnapshotEnvelope.self,
        from: data
      )
      guard snapshot.kind == "state_snapshot" else {
        throw WatchStoreError.invalidSnapshot
      }
      let applied = try applySnapshotWithOutcome(snapshot)
      return (
        envelope: snapshot,
        state: applied.state,
        reboundOutbox: applied.reboundOutbox
      )
    }

    static func applySnapshot(_ envelope: StateSnapshotEnvelope) throws -> WatchLocalState {
      try applySnapshotWithOutcome(envelope).state
    }

    private static func applySnapshotWithOutcome(_ envelope: StateSnapshotEnvelope) throws
      -> (state: WatchLocalState, reboundOutbox: [CommandEnvelope])
    {
      try withLock {
        var outbox = try readOutbox()
        var current = try readRecoveredState(outbox: outbox)
        guard envelope.protocolVersion == WearableProtocol.version else {
          return (current, [])
        }
        var isCurrentAccount = envelope.accountEpoch == current.accountEpoch
        var reboundFirstPairOutbox = false

        if !isCurrentAccount, !outbox.isEmpty {
          if current.lastPhoneContactAt == nil {
            outbox = outbox.map {
              reboundEnvelope($0, to: envelope.accountEpoch)
            }
            current.accountEpoch = envelope.accountEpoch
            isCurrentAccount = true
            reboundFirstPairOutbox = true
          } else {
            current.syncIssue = .accountChanged
            current.pendingCommandCount = outbox.count
            try write(current, to: stateFile)
            try write(makeWidgetSnapshot(from: current), to: widgetFile)
            return (current, [])
          }
        }

        let snapshot = envelope.payload
        if isCurrentAccount, snapshot.revision < current.revision {
          return (current, [])
        }

        if !isCurrentAccount {
          let wasPreviouslyPaired = current.lastPhoneContactAt != nil
          if wasPreviouslyPaired {
            // Never carry private state, cached menus or an actor stream across
            // a real account boundary. Snapshot fields are applied below onto
            // this clean baseline.
            current = .empty()
            current.accountEpoch = envelope.accountEpoch
          } else {
            // A pristine first pair keeps its provisional actor identity.
            current.accountEpoch = envelope.accountEpoch
            current.resolvedTargetMessageId = nil
            current.lastAcceptedDrinkAt = nil
          }
        }

        current.revision =
          isCurrentAccount ? max(current.revision, snapshot.revision) : snapshot.revision
        current.target = snapshot.target
        current.activeEvening = snapshot.activeEvening
        current.otherEvenings = snapshot.otherEvenings
        current.nearbyPubs = snapshot.nearbyPubs
        current.recentDrinks = snapshot.recentDrinks
        current.frequentDrinks = snapshot.frequentDrinks
        current.menuDrinks = snapshot.menuDrinks
        current.snapshotMenuPubKey = snapshot.target?.pub.pubKey
        current.isStale = snapshot.isStale
        current.lastPhoneContactAt = snapshot.lastPhoneContactAt ?? envelope.sentAt
        current.syncIssue = nil
        current.conflictingTarget = nil

        let latestTargetMutationId = outbox.reversed().first { envelope in
          switch envelope.payload.command {
          case .setTarget, .clearTarget:
            true
          default:
            false
          }
        }?.messageId

        for pending in outbox {
          switch pending.payload.command {
          case .setTarget, .clearTarget:
            guard pending.messageId == latestTargetMutationId else { continue }
          default:
            break
          }

          if case .setTarget(let localTarget) = pending.payload.command,
            localTarget.selection == .manual,
            let phoneTarget = snapshot.target,
            phoneTarget.selection == .manual,
            phoneTarget.pub.pubKey != localTarget.pub.pubKey,
            current.resolvedTargetMessageId != pending.messageId,
            pending.baseRevision < snapshot.revision
          {
            current.syncIssue = .targetConflict
            current.conflictingTarget = localTarget
            continue
          }

          if case .startEveningAndAddDrink(let eveningId, let pub, _, _) = pending.payload.command,
            let phoneEvening = snapshot.activeEvening,
            phoneEvening.eveningId != eveningId,
            phoneEvening.pub.pubKey != pub.pubKey,
            pending.baseRevision < snapshot.revision
          {
            current.syncIssue = .eveningConflict
          }
          apply(pending.payload.command, to: &current)
        }

        current.pendingCommandCount = outbox.count
        if reboundFirstPairOutbox {
          try write(outbox, to: outboxFile)
        }
        try write(current, to: stateFile)
        try write(makeWidgetSnapshot(from: current), to: widgetFile)
        return (current, reboundFirstPairOutbox ? outbox : [])
      }
    }

    static func updateNearbyPubs(_ pubs: [PubRef], refreshedAt: Date) throws -> WatchLocalState {
      try withLock {
        let outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        state.nearbyPubs = Array(pubs.prefix(10))
        state.lastNearbyRefreshAt = refreshedAt
        state.isStale = false
        if state.target == nil || state.target?.selection == .nearest {
          state.target = state.nearbyPubs.first.map {
            TargetState(selection: .nearest, pub: $0)
          }
        }
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
        return state
      }
    }

    static func updateMenu(_ drinks: [DrinkTemplate], for pubKey: String) throws -> WatchLocalState
    {
      try withLock {
        let outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        state.pubMenus[pubKey] = Array(drinks.prefix(20))
        try write(state, to: stateFile)
        return state
      }
    }

    static func resolveTargetConflict(with target: TargetState) throws -> [CommandEnvelope] {
      try withLock {
        var outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        state.syncIssue = state.syncIssue == .targetConflict ? nil : state.syncIssue
        state.conflictingTarget = nil
        state.actorSequence += 1
        let envelope = CommandEnvelope(
          protocolVersion: WearableProtocol.version,
          messageId: UUID(),
          accountEpoch: state.accountEpoch,
          actorId: state.actorId,
          actorKind: .watchOS,
          actorSequence: state.actorSequence,
          baseRevision: state.revision,
          sentAt: Date(),
          kind: "command",
          payload: CommandPayload(command: .setTarget(target))
        )
        outbox.append(envelope)
        state.resolvedTargetMessageId = envelope.messageId
        state.target = target
        state.pendingCommandCount = outbox.count
        try write(outbox, to: outboxFile)
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
        return [envelope]
      }
    }

    static func repeatLastDrink(now: Date = Date()) throws -> CommandEnvelope {
      try withLock {
        var outbox = try readOutbox()
        var state = try readRecoveredState(outbox: outbox)
        guard state.syncIssue != .accountChanged else {
          throw WatchStoreError.accountConflict
        }
        guard var evening = state.activeEvening, evening.status == .active else {
          throw WatchStoreError.noActiveEvening
        }
        guard let last = evening.latestDrink else { throw WatchStoreError.noRepeatDrink }
        if let accepted = state.lastAcceptedDrinkAt,
          now.timeIntervalSince(accepted) < duplicateTapWindow
        {
          throw WatchStoreError.duplicateTap
        }

        state.actorSequence += 1
        let drink = DrinkSpec(
          id: UUID(),
          name: last.name,
          drinkType: last.drinkType,
          volumeMl: last.volumeMl,
          priceCzk: last.priceCzk,
          servingType: last.servingType,
          recordedAt: now
        )
        let command = WearableCommand.addDrink(eveningId: evening.eveningId, drink: drink)
        let envelope = CommandEnvelope(
          protocolVersion: WearableProtocol.version,
          messageId: UUID(),
          accountEpoch: state.accountEpoch,
          actorId: state.actorId,
          actorKind: .watchOS,
          actorSequence: state.actorSequence,
          baseRevision: state.revision,
          sentAt: now,
          kind: "command",
          payload: CommandPayload(command: command)
        )
        outbox.append(envelope)
        evening.addIfMissing(drink)
        state.activeEvening = evening
        state.lastAcceptedDrinkAt = now
        state.pendingCommandCount = outbox.count
        try write(outbox, to: outboxFile)
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
        return envelope
      }
    }

    static func replaceForDebug(_ state: WatchLocalState) throws {
      #if DEBUG
        try withLock {
          try write([CommandEnvelope](), to: outboxFile)
          try write(state, to: stateFile)
          try write(makeWidgetSnapshot(from: state), to: widgetFile)
        }
      #endif
    }

    static func makeWidgetSnapshot(from state: WatchLocalState) -> WatchWidgetSnapshot {
      let evening = state.activeEvening
      let latest = evening?.latestDrink
      let otherCount = evening?.otherCounts.values.reduce(0, +) ?? 0
      return WatchWidgetSnapshot(
        pubName: evening?.pub.name ?? state.target?.pub.name,
        beerCount: evening?.beerCount ?? 0,
        otherCount: otherCount,
        totalCzk: evening?.totalCzk ?? 0,
        repeatDrinkName: latest?.name,
        repeatDrinkSummary: latest?.summary,
        hasActiveEvening: evening?.status == .active && !(evening?.visibleDrinks.isEmpty ?? true),
        pendingCommandCount: state.pendingCommandCount,
        updatedAt: Date()
      )
    }

    private static func readRecoveredState(outbox: [CommandEnvelope]) throws -> WatchLocalState {
      var state = try readState()
      let persistedState = state

      // A first-pair rebind writes the outbox before the state so a crash can
      // never leave an acknowledged-looking state with provisional envelopes.
      // If that narrow crash happens, the uniform pending epoch is the durable
      // half of the unfinished rebind and can safely repair an unpaired state.
      if state.lastPhoneContactAt == nil {
        let pendingEpochs = Set(outbox.map(\.accountEpoch))
        if pendingEpochs.count == 1, let pendingEpoch = pendingEpochs.first {
          state.accountEpoch = pendingEpoch
        }
      }

      applyPending(outbox, to: &state)
      let highestPendingSequence =
        outbox.lazy
        .filter { $0.actorKind == .watchOS && $0.actorId == state.actorId }
        .map(\.actorSequence)
        .max() ?? 0
      state.actorSequence = max(state.actorSequence, highestPendingSequence)
      state.pendingCommandCount = outbox.count

      if state != persistedState {
        try write(state, to: stateFile)
        try write(makeWidgetSnapshot(from: state), to: widgetFile)
      }
      return state
    }

    private static func reboundEnvelope(
      _ envelope: CommandEnvelope,
      to accountEpoch: UUID
    ) -> CommandEnvelope {
      CommandEnvelope(
        protocolVersion: envelope.protocolVersion,
        messageId: envelope.messageId,
        accountEpoch: accountEpoch,
        actorId: envelope.actorId,
        actorKind: envelope.actorKind,
        actorSequence: envelope.actorSequence,
        baseRevision: envelope.baseRevision,
        sentAt: envelope.sentAt,
        kind: envelope.kind,
        payload: envelope.payload
      )
    }

    private static func applyPending(_ outbox: [CommandEnvelope], to state: inout WatchLocalState) {
      for envelope in outbox {
        apply(envelope.payload.command, to: &state)
      }
    }

    private static func apply(_ command: WearableCommand, to state: inout WatchLocalState) {
      switch command {
      case .setTarget(let target):
        if state.target?.selection == .manual, target.selection == .nearest {
          return
        }
        state.target = target
      case .clearTarget:
        state.target = state.nearbyPubs.first.map {
          TargetState(selection: .nearest, pub: $0)
        }
      case .startEveningAndAddDrink(let eveningId, let pub, let drinkingDayKey, let drink):
        if var current = state.activeEvening, current.eveningId == eveningId {
          current.addIfMissing(drink)
          state.activeEvening = current
          state.lastAcceptedDrinkAt = drink.recordedAt
          return
        }

        if var current = state.activeEvening,
          current.status == .active,
          !current.visibleDrinks.isEmpty
        {
          current.status = current.pub.pubKey == pub.pubKey ? .closed : .conflict
          current.closedAt = drink.recordedAt
          state.otherEvenings.removeAll { $0.eveningId == current.eveningId }
          state.otherEvenings.insert(current, at: 0)
          if current.status == .conflict {
            state.syncIssue = .eveningConflict
          }
        }

        state.activeEvening = EveningState(
          eveningId: eveningId,
          pub: pub,
          drinkingDayKey: drinkingDayKey,
          startedAt: drink.recordedAt,
          status: .active,
          drinks: [drink],
          removedDrinkIds: []
        )
        state.target = TargetState(selection: .manual, pub: pub)
        state.lastAcceptedDrinkAt = drink.recordedAt
      case .addDrink(let eveningId, let drink):
        if var current = state.activeEvening, current.eveningId == eveningId {
          current.addIfMissing(drink)
          state.activeEvening = current
          state.lastAcceptedDrinkAt = drink.recordedAt
          return
        }
        if let index = state.otherEvenings.firstIndex(where: { $0.eveningId == eveningId }) {
          state.otherEvenings[index].addIfMissing(drink)
        }
      case .removeDrink(let eveningId, let drinkId, _):
        if var current = state.activeEvening, current.eveningId == eveningId {
          current.remove(drinkId)
          state.activeEvening = current
          return
        }
        if let index = state.otherEvenings.firstIndex(where: { $0.eveningId == eveningId }) {
          state.otherEvenings[index].remove(drinkId)
        }
      case .closeEvening(let eveningId, let closedAt):
        guard var current = state.activeEvening, current.eveningId == eveningId else { return }
        current.status = .closed
        current.closedAt = closedAt
        state.otherEvenings.removeAll { $0.eveningId == current.eveningId }
        state.otherEvenings.insert(current, at: 0)
        state.activeEvening = nil
      case .resolveEveningConflict(let activeEveningId):
        if state.activeEvening?.eveningId == activeEveningId {
          state.activeEvening?.status = .active
          state.activeEvening?.closedAt = nil
        } else if let index = state.otherEvenings.firstIndex(where: {
          $0.eveningId == activeEveningId
        }) {
          var selected = state.otherEvenings.remove(at: index)
          if var previous = state.activeEvening {
            previous.status = .closed
            state.otherEvenings.insert(previous, at: 0)
          }
          selected.status = .active
          selected.closedAt = nil
          state.activeEvening = selected
        }
        state.otherEvenings = state.otherEvenings.map { evening in
          guard evening.status == .active || evening.status == .conflict else {
            return evening
          }
          var closed = evening
          closed.status = .closed
          return closed
        }
        state.syncIssue = nil
      }
    }

    private static func readState() throws -> WatchLocalState {
      guard let url = try? fileURL(stateFile), let data = try? Data(contentsOf: url) else {
        let state = WatchLocalState.empty()
        try write(state, to: stateFile)
        return state
      }
      return try WearableEnvelopeDecoder.decoder().decode(WatchLocalState.self, from: data)
    }

    private static func readOutbox() throws -> [CommandEnvelope] {
      guard let url = try? fileURL(outboxFile), let data = try? Data(contentsOf: url) else {
        return []
      }
      return try WearableEnvelopeDecoder.decoder().decode([CommandEnvelope].self, from: data)
    }

    private static func write<T: Encodable>(_ value: T, to filename: String) throws {
      let data = try WearableEnvelopeDecoder.encoder().encode(value)
      let url = try fileURL(filename)
      try data.write(
        to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      try excludeFromBackup(url)
    }

    private static func excludeFromBackup(_ url: URL) throws {
      var protectedURL = url
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try protectedURL.setResourceValues(values)
    }

    private static func fileURL(_ filename: String) throws -> URL {
      #if NAPIVO_CONTRACT_TESTS
        if let testContainerPath = getenv("NAPIVO_WATCH_TEST_CONTAINER") {
          return URL(fileURLWithPath: String(cString: testContainerPath), isDirectory: true)
            .appendingPathComponent(filename, isDirectory: false)
        }
      #endif
      guard
        let container = FileManager.default.containerURL(
          forSecurityApplicationGroupIdentifier: WearableProtocol.appGroup
        )
      else {
        throw WatchStoreError.appGroupUnavailable
      }
      return container.appendingPathComponent(filename, isDirectory: false)
    }

    private static func withLock<T>(_ body: () throws -> T) throws -> T {
      let url = try fileURL(lockFile)
      let descriptor = url.path.withCString {
        Darwin.open($0, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
      }
      guard descriptor >= 0 else { throw WatchStoreError.lockUnavailable }
      guard flock(descriptor, LOCK_EX) == 0 else {
        Darwin.close(descriptor)
        throw WatchStoreError.lockUnavailable
      }
      defer {
        flock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
      }
      return try body()
    }
  }
#endif
