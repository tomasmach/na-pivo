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
    let data = try store.saveSnapshot(json)
    guard let session else { return }
    try session.updateApplicationContext([transportKey: data])
    if session.isReachable {
      session.sendMessage(
        [transportKey: data],
        replyHandler: nil,
        errorHandler: { _ in }
      )
    }
    postChange()
  }

  func getPendingCommands() throws -> [String] {
    try store.pendingCommandJSON()
  }

  func acknowledgePendingCommands(messageIds: [String]) throws {
    guard !messageIds.isEmpty else { return }
    let acknowledgement = try store.makeAcknowledgement(for: messageIds)
    guard let session else { return }
    session.transferUserInfo([transportKey: acknowledgement])
    if session.isReachable {
      session.sendMessage(
        [transportKey: acknowledgement],
        replyHandler: nil,
        errorHandler: { _ in }
      )
    }
    try store.removeAcknowledgedCommands(messageIds)
    postChange()
  }

  func requestSync() {
    postChange()
    sendLatestSnapshot()
  }

  func transportStatus() throws -> [String: Any] {
    let local = try store.status()
    return [
      "supported": session != nil,
      "paired": session?.isPaired ?? false,
      "reachable": session?.isReachable ?? false,
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
    try store.persistIncomingCommand(data)
    DispatchQueue.main.async {
      NotificationCenter.default.post(
        name: .naPivoWearableCommandReceived,
        object: nil
      )
    }
    postChange()
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
    let data: Data?
    do {
      data = try store.latestSnapshotData()
    } catch {
      replyHandler?(["available": false])
      return
    }
    guard let data else {
      replyHandler?(["available": false])
      return
    }
    if let replyHandler {
      replyHandler([transportKey: data])
      return
    }
    guard let session, session.isReachable else { return }
    session.sendMessage(
      [transportKey: data],
      replyHandler: nil,
      errorHandler: { _ in }
    )
  }

  private func postChange() {
    DispatchQueue.main.async {
      NotificationCenter.default.post(
        name: .naPivoWearableTransportChanged,
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
