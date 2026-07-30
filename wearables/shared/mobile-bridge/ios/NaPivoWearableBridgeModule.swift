import ExpoModulesCore
import Foundation

public final class NaPivoWearableBridgeModule: Module {
  private var transportObserver: NSObjectProtocol?
  private var commandObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("NaPivoWearableBridge")

    Events("onTransportChanged", "onWearableCommand")

    OnCreate { [weak self] in
      NaPivoWearableConnectivityCoordinator.shared.activate()
      self?.transportObserver = NotificationCenter.default.addObserver(
        forName: .naPivoWearableTransportChanged,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onTransportChanged", ["changed": true])
      }
      self?.commandObserver = NotificationCenter.default.addObserver(
        forName: .naPivoWearableCommandReceived,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onWearableCommand", ["changed": true])
      }
    }

    OnDestroy { [weak self] in
      if let observer = self?.transportObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      if let observer = self?.commandObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self?.transportObserver = nil
      self?.commandObserver = nil
    }

    AsyncFunction("publishSnapshot") { (envelopeJson: String) throws in
      try NaPivoWearableConnectivityCoordinator.shared.publishSnapshot(json: envelopeJson)
    }

    AsyncFunction("clearSnapshot") { () throws in
      try NaPivoWearableConnectivityCoordinator.shared.clearSnapshot()
    }

    AsyncFunction("getPendingCommands") { () throws -> [String] in
      try NaPivoWearableConnectivityCoordinator.shared.getPendingCommands()
    }

    AsyncFunction("getAcknowledgedActorSequences") { (accountEpoch: String) throws
      -> [String: Int] in
      try NaPivoWearableConnectivityCoordinator.shared
        .getAcknowledgedActorSequences(accountEpoch: accountEpoch)
    }

    AsyncFunction("ackPendingCommands") { (messageIds: [String]) throws in
      try NaPivoWearableConnectivityCoordinator.shared.acknowledgePendingCommands(
        messageIds: messageIds
      )
    }

    AsyncFunction("getTransportStatus") { () throws -> [String: Any] in
      try NaPivoWearableConnectivityCoordinator.shared.transportStatus()
    }

    AsyncFunction("requestSync") {
      NaPivoWearableConnectivityCoordinator.shared.requestSync()
    }
  }
}
