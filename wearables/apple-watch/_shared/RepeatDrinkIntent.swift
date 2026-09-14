#if os(watchOS)
  import AppIntents
  import WatchConnectivity
  import WidgetKit

  struct RepeatLastDrinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Zopakovat poslední drink"
    static let description = IntentDescription("Zapíše na hodinkách stejný konkrétní drink.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
      do {
        _ = try WatchDataStore.repeatLastDrink()
        WatchOutboxTransmitter.flushDurableOutbox()
        WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
        return .result(dialog: "Načepováno.")
      } catch WatchStoreError.duplicateTap {
        return .result(dialog: "Jednou stačí.")
      } catch WatchStoreError.accountConflict {
        return .result(dialog: "Účet se změnil. Otevři Na pivo.")
      } catch {
        return .result(dialog: "Otevři Na pivo.")
      }
    }
  }

  enum WatchOutboxTransmitter {
    private static let coordinator = WatchIntentConnectivityCoordinator()

    static func flushDurableOutbox() {
      coordinator.activateAndFlush()
    }
  }

  private final class WatchIntentConnectivityCoordinator: NSObject, WCSessionDelegate {
    private let session = WCSession.isSupported() ? WCSession.default : nil

    func activateAndFlush() {
      guard let session else { return }

      // App intents may execute in the widget extension or inside the watch app.
      // Preserve a live app-owned delegate when one already exists.
      if let existingDelegate = session.delegate, existingDelegate !== self {
        if session.activationState == .activated {
          flush(using: session)
        } else {
          session.activate()
        }
        return
      }

      session.delegate = self
      if session.activationState == .activated {
        flush(using: session)
      } else {
        session.activate()
      }
    }

    private func flush(using session: WCSession) {
      guard session.activationState == .activated else { return }
      guard let envelopes = try? WatchDataStore.loadOutbox(), !envelopes.isEmpty else {
        return
      }
      let outstandingIds = Set(
        session.outstandingUserInfoTransfers.compactMap {
          ($0.userInfo["messageId"] as? String)?.lowercased()
        }
      )

      for envelope in envelopes {
        guard let data = try? WearableEnvelopeDecoder.encoder().encode(envelope) else {
          continue
        }
        let messageId = envelope.messageId.uuidString.lowercased()
        let payload: [String: Any] = [
          WearableProtocol.commandTransportKey: data,
          "messageId": messageId,
        ]
        if !outstandingIds.contains(messageId) {
          _ = session.transferUserInfo(payload)
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

    private func receive(_ payload: [String: Any]) {
      guard let data = payload[WearableProtocol.commandTransportKey] as? Data else {
        return
      }
      switch WearableEnvelopeDecoder.kind(in: data) {
      case "state_snapshot":
        guard let applied = try? WatchDataStore.applySnapshotEnvelopeData(data) else {
          return
        }
        if !applied.reboundOutbox.isEmpty, let session {
          // Reload the durable outbox so every command rewritten to the phone's
          // first-pair epoch is retried, including commands made outside this intent.
          flush(using: session)
        }
      case "ack":
        guard (try? WatchDataStore.acknowledgeEnvelopeData(data)) != nil else { return }
      default:
        return
      }
      WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
    }

    func session(
      _ session: WCSession,
      activationDidCompleteWith activationState: WCSessionActivationState,
      error: Error?
    ) {
      if activationState == .activated {
        flush(using: session)
      }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
      if session.isReachable {
        flush(using: session)
      }
    }

    func session(
      _ session: WCSession,
      didReceiveMessage message: [String: Any]
    ) {
      receive(message)
    }

    func session(
      _ session: WCSession,
      didReceiveMessage message: [String: Any],
      replyHandler: @escaping ([String: Any]) -> Void
    ) {
      receive(message)
      replyHandler(["received": true])
    }

    func session(
      _ session: WCSession,
      didReceiveApplicationContext applicationContext: [String: Any]
    ) {
      receive(applicationContext)
    }

    func session(
      _ session: WCSession,
      didReceiveUserInfo userInfo: [String: Any]
    ) {
      receive(userInfo)
    }
  }
#endif
