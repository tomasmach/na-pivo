import Foundation

private enum ProbeError: Error {
  case failed(String)
}

@main
private enum NearbyRefreshGateProbe {
  static func main() throws {
    try offlineCachedResultRetriesOnlyAfterCooldown()
    try successfulCachedResultStaysQuietInSameArea()
    try newAreaBypassesRetryCooldown()
    try emptyResultRetriesWithoutHammering()
  }

  private static func offlineCachedResultRetriesOnlyAfterCooldown() throws {
    var gate = NearbyRefreshGate(retryCooldown: 30)

    try require(
      gate.startAttempt(
        isSameArea: false,
        hasCachedPubs: true,
        nowUptime: 1
      ))
    gate.finishAttempt(retryRequired: true)

    try require(
      !gate.startAttempt(
        isSameArea: true,
        hasCachedPubs: true,
        nowUptime: 30.999
      ))
    try require(
      gate.startAttempt(
        isSameArea: true,
        hasCachedPubs: true,
        nowUptime: 31
      ))
  }

  private static func successfulCachedResultStaysQuietInSameArea() throws {
    var gate = NearbyRefreshGate(retryCooldown: 30)

    try require(
      gate.startAttempt(
        isSameArea: false,
        hasCachedPubs: true,
        nowUptime: 1
      ))
    gate.finishAttempt(retryRequired: false)

    try require(
      !gate.startAttempt(
        isSameArea: true,
        hasCachedPubs: true,
        nowUptime: 301
      ))
  }

  private static func newAreaBypassesRetryCooldown() throws {
    var gate = NearbyRefreshGate(retryCooldown: 30)

    try require(
      gate.startAttempt(
        isSameArea: false,
        hasCachedPubs: true,
        nowUptime: 1
      ))
    gate.finishAttempt(retryRequired: true)

    try require(
      gate.startAttempt(
        isSameArea: false,
        hasCachedPubs: true,
        nowUptime: 1.001
      ))
  }

  private static func emptyResultRetriesWithoutHammering() throws {
    var gate = NearbyRefreshGate(retryCooldown: 30)

    try require(
      gate.startAttempt(
        isSameArea: false,
        hasCachedPubs: false,
        nowUptime: 1
      ))
    gate.finishAttempt(retryRequired: true)

    try require(
      !gate.startAttempt(
        isSameArea: true,
        hasCachedPubs: false,
        nowUptime: 2
      ))
    try require(
      gate.startAttempt(
        isSameArea: true,
        hasCachedPubs: false,
        nowUptime: 31
      ))
  }

  private static func require(
    _ condition: @autoclosure () -> Bool
  ) throws {
    guard condition() else {
      throw ProbeError.failed("Nearby refresh retry policy diverged.")
    }
  }
}
