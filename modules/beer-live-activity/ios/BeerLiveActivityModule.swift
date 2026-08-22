import ExpoModulesCore
import Foundation

private let pendingAddsDirectoryName = "BeerLiveActivityPendingAdds-v1"
private let appGroupInfoPlistKey = "ExpoWidgetsAppGroupIdentifier"

/// How many times an undecodable file is re-read before it is quarantined.
/// The writer (the patched expo-widgets AppIntent, outside this repo) saves
/// with `.atomic`, but a concurrent reader can still observe the directory
/// mid-replace, so a single failed read is not proof of corruption.
private let corruptReadAttempts = 3
/// A file modified more recently than this is assumed mid-write and left
/// alone for a later foreground pass instead of being quarantined.
private let midWriteGraceInterval: TimeInterval = 5
/// Quarantined files older than this are removed, so quarantine cannot grow
/// without bound.
private let quarantineRetentionInterval: TimeInterval = 24 * 60 * 60

private struct PendingBeerAdd: Codable {
  let id: String
  let sessionId: String
  let createdAt: Int64
  let beerName: String?
  let priceCzk: Double?
  let volumeMl: Int?
  let servingType: String?
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

    return urls
      .filter { $0.pathExtension == "json" }
      .compactMap { url in
        // Each tap owns one file. A file that will not decode must not block
        // every healthy tap behind it from reaching JavaScript.
        guard let event = readPendingBeerAdd(at: url) else {
          quarantine(url: url, directory: directory)
          return nil
        }
        var result = [
          "id": event.id,
          "sessionId": event.sessionId,
          "createdAt": event.createdAt,
        ] as [String: Any]
        if let beerName = event.beerName { result["beerName"] = beerName }
        if let priceCzk = event.priceCzk { result["priceCzk"] = priceCzk }
        if let volumeMl = event.volumeMl { result["volumeMl"] = volumeMl }
        if let servingType = event.servingType { result["servingType"] = servingType }
        return result
      }
      .sorted {
        ($0["createdAt"] as? Int64 ?? 0) < ($1["createdAt"] as? Int64 ?? 0)
      }
  }

  /// Reads and decodes one pending tap, tolerating a concurrent writer.
  ///
  /// A failed read is retried a bounded number of times before the file is
  /// treated as corrupt: the AppIntent replaces files atomically, so an empty
  /// or truncated read usually means the replace was in flight, not that the
  /// data is gone. Files modified within the grace window are never
  /// quarantined — the next foreground pass reads them settled.
  private static func readPendingBeerAdd(at url: URL) -> PendingBeerAdd? {
    for attempt in 0..<corruptReadAttempts {
      if attempt > 0 {
        // Brief bounded backoff lets an in-flight atomic replace finish.
        Thread.sleep(forTimeInterval: 0.02 * Double(attempt))
      }
      guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
        return nil
      }
      if let modified = attributes[.modificationDate] as? Date,
         Date().timeIntervalSince(modified) < midWriteGraceInterval,
         (try? Data(contentsOf: url)) == nil {
        // Mid-write: skip this pass without quarantine.
        return nil
      }
      if let data = try? Data(contentsOf: url),
         let event = try? JSONDecoder().decode(PendingBeerAdd.self, from: data) {
        return event
      }
    }
    return nil
  }

  /// Moves an undecodable tap aside instead of deleting it: a rename is
  /// reversible evidence, a removal is not. Quarantined files keep their id in
  /// the name, stop matching the `.json` scan, and are pruned by age.
  private static func quarantine(url: URL, directory: URL) {
    do {
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      if let modified = attributes[.modificationDate] as? Date,
         Date().timeIntervalSince(modified) < midWriteGraceInterval {
        // Likely still being written; leave it for a later pass.
        return
      }
    } catch {
      // The file vanished under us — acknowledgement already won.
      return
    }
    let quarantined = directory.appendingPathComponent(url.deletingPathExtension().lastPathComponent)
      .appendingPathExtension("quarantined")
    try? FileManager.default.removeItem(at: quarantined)
    try? FileManager.default.moveItem(at: url, to: quarantined)
    pruneQuarantine(directory: directory)
  }

  private static func pruneQuarantine(directory: URL) {
    guard
      let urls = try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.contentModificationDateKey],
        options: [.skipsHiddenFiles]
      )
    else { return }
    for url in urls where url.pathExtension == "quarantined" {
      guard
        let modified = try? url.resourceValues(forKeys: [.contentModificationDateKey])
          .contentModificationDate,
        Date().timeIntervalSince(modified) > quarantineRetentionInterval
      else { continue }
      try? FileManager.default.removeItem(at: url)
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

  static func clearPendingAdds() throws {
    let directory = try pendingAddsDirectory(createIfMissing: false)
    guard FileManager.default.fileExists(atPath: directory.path) else { return }

    let urls = try FileManager.default.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil,
      options: [.skipsHiddenFiles]
    )
    for url in urls where url.pathExtension == "json" {
      do {
        try FileManager.default.removeItem(at: url)
      } catch let error as CocoaError where error.code == .fileNoSuchFile {
        // A concurrent acknowledgement can win; bulk clearing is idempotent.
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

    AsyncFunction("clearPendingAdds") { () throws in
      try PendingBeerAddStore.clearPendingAdds()
    }
  }
}
