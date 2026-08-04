import Foundation

struct NearbyRefreshGate {
  static let defaultRetryCooldown: TimeInterval = 30

  private let retryCooldown: TimeInterval
  private var lastAttemptUptime: TimeInterval?
  private var retryRequired = false

  init(retryCooldown: TimeInterval = Self.defaultRetryCooldown) {
    self.retryCooldown = retryCooldown
  }

  mutating func startAttempt(
    isSameArea: Bool,
    hasCachedPubs: Bool,
    nowUptime: TimeInterval
  ) -> Bool {
    if isSameArea {
      if hasCachedPubs, !retryRequired {
        return false
      }

      if let lastAttemptUptime,
        nowUptime - lastAttemptUptime < retryCooldown
      {
        return false
      }
    }

    lastAttemptUptime = nowUptime
    return true
  }

  mutating func finishAttempt(retryRequired: Bool) {
    self.retryRequired = retryRequired
  }
}
