import ExpoModulesCore
import Foundation

private let pendingAddsDirectoryName = "BeerLiveActivityPendingAdds-v1"
private let appGroupInfoPlistKey = "ExpoWidgetsAppGroupIdentifier"

private struct PendingBeerAdd: Codable {
  let id: String
  let sessionId: String
  let createdAt: Int64
}

private enum PendingBeerAddStore {
  static func getPendingAdds() throws -> [[String: Any]] {
    let directory = try pendingAddsDirectory(createIfMissing: false)
    guard FileManager.default.fileExists(atPath: directory.path) else {
      return []
    }

    let urls = try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    )

    return try urls
      .filter { $0.pathExtension == "json" }
      .map { url in
        let data = try Data(contentsOf: url)
        let event = try JSONDecoder().decode(PendingBeerAdd.self, from: data)
        return [
          "id": event.id,
          "sessionId": event.sessionId,
          "createdAt": event.createdAt,
        ] as [String: Any]
      }
      .sorted {
        ($0["createdAt"] as? Int64 ?? 0) < ($1["createdAt"] as? Int64 ?? 0)
      }
  }

  static func acknowledge(ids: [String]) throws {
    guard !ids.isEmpty else { return }
    let directory = try pendingAddsDirectory(createIfMissing: false)
    guard FileManager.default.fileExists(atPath: directory.path) else { return }

    for id in Set(ids) {
      // Only files named from UUIDs written by the AppIntent may be removed.
      guard UUID(uuidString: id) != nil else { continue }
      let url = directory.appendingPathComponent(id).appendingPathExtension("json")
      do {
        try FileManager.default.removeItem(at: url)
      } catch let error as CocoaError where error.code == .fileNoSuchFile {
        // Acknowledgement is idempotent.
      }
    }
  }

  private static func pendingAddsDirectory(createIfMissing: Bool) throws -> URL {
    guard
      let appGroupIdentifier = Bundle.main.object(
        forInfoDictionaryKey: appGroupInfoPlistKey
      ) as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: appGroupIdentifier
      )
    else {
      throw PendingBeerAddStoreException()
    }

    let directory = container.appendingPathComponent(
      pendingAddsDirectoryName,
      isDirectory: true
    )
    if createIfMissing {
      try FileManager.default.createDirectory(
        at: directory,
        withIntermediateDirectories: true
      )
    }
    return directory
  }
}

private final class PendingBeerAddStoreException: Exception, @unchecked Sendable {
  override var reason: String {
    "The Live Activity app-group container is unavailable. Rebuild the native app with the expo-widgets configuration."
  }
}

public final class BeerLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BeerLiveActivity")

    AsyncFunction("getPendingAdds") { () throws -> [[String: Any]] in
      try PendingBeerAddStore.getPendingAdds()
    }

    AsyncFunction("ackPendingAdds") { (ids: [String]) throws in
      try PendingBeerAddStore.acknowledge(ids: ids)
    }
  }
}
