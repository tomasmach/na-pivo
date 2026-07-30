import Foundation
import WatchConnectivity

@MainActor
final class WatchConnectivityService: NSObject, ObservableObject {
  @Published private(set) var activationState: WCSessionActivationState = .notActivated
  @Published private(set) var isPhoneReachable = false
  @Published private(set) var phoneNeedsUnlock = false

  var onSnapshot: ((WatchLocalState) -> Void)?
  var onAcknowledgement: ((WatchLocalState) -> Void)?

  private let session: WCSession?

  override init() {
    session = WCSession.isSupported() ? WCSession.default : nil
    super.init()
  }

  func activate() {
    guard let session else { return }
    session.delegate = self
    session.activate()
    updateStatus(from: session)
  }

  func flushOutbox(_ envelopes: [CommandEnvelope]) {
    guard let session, session.activationState == .activated else { return }
    let outstandingIds = Set(
      session.outstandingUserInfoTransfers.compactMap {
        $0.userInfo["messageId"] as? String
      }
    )

    for envelope in envelopes {
      guard let data = try? WearableEnvelopeDecoder.encoder().encode(envelope) else { continue }
      let payload: [String: Any] = [
        WearableProtocol.commandTransportKey: data,
        "messageId": envelope.messageId.uuidString.lowercased(),
      ]
      if !outstandingIds.contains(envelope.messageId.uuidString.lowercased()) {
        session.transferUserInfo(payload)
      }
      if session.isReachable {
        session.sendMessage(
          payload,
          replyHandler: { [weak self] reply in
            self?.receive(reply)
          },
          errorHandler: { _ in }
        )
      }
    }
  }

  func requestSync() {
    guard let session, session.isReachable else { return }
    session.sendMessage(
      ["control": "request_sync"],
      replyHandler: { [weak self] reply in
        self?.receive(reply)
      },
      errorHandler: { _ in }
    )
  }

  private func updateStatus(from session: WCSession) {
    activationState = session.activationState
    isPhoneReachable = session.isReachable
    phoneNeedsUnlock = session.iOSDeviceNeedsUnlockAfterRebootForReachability
  }

  nonisolated private func receive(_ payload: [String: Any]) {
    guard let data = payload[WearableProtocol.commandTransportKey] as? Data else { return }
    receive(data)
  }

  nonisolated private func receive(_ data: Data) {
    switch WearableEnvelopeDecoder.kind(in: data) {
    case "state_snapshot":
      guard let applied = try? WatchDataStore.applySnapshotEnvelopeData(data) else {
        return
      }
      Task { @MainActor [weak self] in
        self?.onSnapshot?(applied.state)
        if !applied.reboundOutbox.isEmpty {
          self?.flushOutbox(applied.reboundOutbox)
        }
      }
    case "ack":
      guard let applied = try? WatchDataStore.acknowledgeEnvelopeData(data) else {
        return
      }
      Task { @MainActor [weak self] in
        self?.onAcknowledgement?(applied.state)
      }
    default:
      return
    }
  }
}

extension WatchConnectivityService: WCSessionDelegate {
  nonisolated func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    Task { @MainActor [weak self] in
      self?.updateStatus(from: session)
      if activationState == .activated {
        self?.requestSync()
        if let pending = try? WatchDataStore.loadOutbox() {
          self?.flushOutbox(pending)
        }
      }
    }
  }

  nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
    Task { @MainActor [weak self] in
      self?.updateStatus(from: session)
      if session.isReachable {
        self?.requestSync()
        if let pending = try? WatchDataStore.loadOutbox() {
          self?.flushOutbox(pending)
        }
      }
    }
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any]
  ) {
    receive(message)
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    receive(message)
    replyHandler(["received": true])
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveApplicationContext applicationContext: [String: Any]
  ) {
    receive(applicationContext)
  }

  nonisolated func session(
    _ session: WCSession,
    didReceiveUserInfo userInfo: [String: Any]
  ) {
    receive(userInfo)
  }
}
