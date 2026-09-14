import Foundation
import WatchConnectivity

extension Notification.Name {
  static let naPivoWearableTransportChanged = Notification.Name(
    "NaPivoWearableTransportChanged"
  )
  static let naPivoWearableCommandReceived = Notification.Name(
    "NaPivoWearableCommandReceived"
  )
}

final class NaPivoWearableConnectivityCoordinator: NSObject {
  static let shared = NaPivoWearableConnectivityCoordinator()

  private let store = NaPivoWearableBridgeStore.shared
  private let transportKey = "envelope"
  private let session: WCSession?
  private let snapshotTransportGate = NaPivoWearableSnapshotTransportGate()

  private override init() {
    session = WCSession.isSupported() ? WCSession.default : nil
    super.init()
  }

  func activate() {
    guard let session else { return }
    session.delegate = self
    session.activate()
  }

  func publishSnapshot(json: String) throws {
    try snapshotTransportGate.sync {
      let data = try store.saveSnapshot(json)
      if let session = activatedSession() {
        // The snapshot is already durable. A concurrent deactivation is a
        // transport deferral, not a reason to reject the JS operation.
        try? transmitSnapshot(data, through: session)
      }
    }
    postChange()
  }

  func clearSnapshot() throws {
    var shouldActivate = false
    try snapshotTransportGate.sync {
      try store.clearSnapshotMetadataPreservingInbox()
      if let session {
        if session.activationState == .activated {
          // Application context is itself durable. Replace it so
          // WatchConnectivity cannot redeliver the outgoing account. A
          // transport error must not undo the local privacy reset; later sync
          // callbacks retry from the now-empty durable store.
          try? session.updateApplicationContext([:])
        } else {
          shouldActivate = true
        }
      }
    }
    if shouldActivate {
      // activationDidComplete takes the same lock and replaces the context from
      // the now-empty store. Activate outside the lock to avoid delegate reentry.
      session?.activate()
    }
    postChange()
  }

  func getPendingCommands() throws -> [String] {
    try store.pendingCommandJSON()
  }

  func getAcknowledgedActorSequences(accountEpoch: String) throws -> [String: Int] {
    try store.acknowledgedActorSequences(accountEpoch: accountEpoch)
  }

  func acknowledgePendingCommands(messageIds: [String]) throws {
    guard !messageIds.isEmpty else { return }
    guard let session = activatedSession() else {
      // Keep the inbox facts until WatchConnectivity can durably own the ACK.
      postChange()
      return
    }
    let acknowledgement = try store.makeAcknowledgement(for: messageIds)
    _ = session.transferUserInfo([transportKey: acknowledgement])
    if session.isReachable {
      session.sendMessage(
        [transportKey: acknowledgement],
        replyHandler: nil,
        errorHandler: { _ in }
      )
    }
    if NaPivoWearableConnectivityPolicy.shouldRemoveAcknowledgedCommands(
      activationStateWasActivated: true,
      acknowledgementTransferWasScheduled: true
    ) {
      try store.removeAcknowledgedCommands(messageIds)
    }
    postChange()
  }

  func requestSync() {
    postChange()
    sendLatestSnapshot()
  }

  func transportStatus() throws -> [String: Any] {
    let local = try store.status()
    let activationStateIsActivated = session?.activationState == .activated
    let connection = NaPivoWearableConnectivityPolicy.connectionStatus(
      activationStateIsActivated: activationStateIsActivated,
      paired: session?.isPaired ?? false,
      reachable: session?.isReachable ?? false
    )
    return [
      "supported": session != nil,
      "paired": connection.paired,
      "reachable": connection.reachable,
      "pendingCommands": local.pendingCommands,
      "lastReceivedAt": local.lastReceivedAt ?? NSNull(),
      "lastSentAt": local.lastSentAt ?? NSNull(),
    ]
  }

  private func accept(_ message: [String: Any]) throws {
    if message["control"] as? String == "request_sync" {
      requestSync()
      return
    }
    guard let data = message[transportKey] as? Data else { return }
    guard envelopeKind(in: data) == "command" else { return }
    let newlyPersisted = try store.persistIncomingCommand(data)
    if newlyPersisted {
      postPendingCommandWake()
      postChange()
    }
  }

  private func envelopeKind(in data: Data) -> String? {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let kind = object["kind"] as? String
    else {
      return nil
    }
    return kind
  }

  private func sendLatestSnapshot(replyHandler: (([String: Any]) -> Void)? = nil) {
    snapshotTransportGate.sync {
      let data: Data?
      do {
        data = try store.latestSnapshotData()
      } catch {
        replyHandler?(["available": false])
        return
      }
      guard let data else {
        replyHandler?(["available": false])
        if let session = activatedSession() {
          // A clear may happen while connectivity is inactive. Supersede any old
          // application context on activation or the watch's next explicit sync.
          try? session.updateApplicationContext([:])
        }
        return
      }
      if let replyHandler {
        replyHandler([transportKey: data])
        return
      }
      guard let session = activatedSession() else { return }
      try? transmitSnapshot(data, through: session)
    }
  }

  private func activatedSession() -> WCSession? {
    guard
      let session,
      NaPivoWearableConnectivityPolicy.allowsTransport(
        activationStateIsActivated: session.activationState == .activated
      )
    else {
      return nil
    }
    return session
  }

  private func transmitSnapshot(_ data: Data, through session: WCSession) throws {
    try session.updateApplicationContext([transportKey: data])
    if session.isReachable {
      session.sendMessage(
        [transportKey: data],
        replyHandler: nil,
        errorHandler: { _ in }
      )
    }
  }

  private func postChange() {
    DispatchQueue.main.async {
      NotificationCenter.default.post(
        name: .naPivoWearableTransportChanged,
        object: nil
      )
    }
  }

  private func postPendingCommandWake() {
    DispatchQueue.main.async {
      NotificationCenter.default.post(
        name: .naPivoWearableCommandReceived,
        object: nil
      )
    }
  }
}

extension NaPivoWearableConnectivityCoordinator: WCSessionDelegate {
  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    postChange()
    if activationState == .activated {
      sendLatestSnapshot()
      let pendingCommandCount = (try? store.status().pendingCommands) ?? 0
      if NaPivoWearableConnectivityPolicy.shouldWakePendingCommands(
        activationStateIsActivated: true,
        pendingCommandCount: pendingCommandCount
      ) {
        postPendingCommandWake()
      }
    }
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    postChange()
  }

  func sessionDidDeactivate(_ session: WCSession) {
    session.activate()
    postChange()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    postChange()
    if session.isReachable {
      sendLatestSnapshot()
    }
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any]
  ) {
    try? accept(message)
  }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    if message["control"] as? String == "request_sync" {
      postChange()
      sendLatestSnapshot(replyHandler: replyHandler)
      return
    }
    do {
      try accept(message)
      replyHandler(["persisted": true])
    } catch {
      replyHandler(["persisted": false])
    }
  }

  func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any]
  ) {
    try? accept(userInfo)
  }
}
