import CoreLocation
import Foundation

@MainActor
final class WatchLocationService: NSObject, ObservableObject {
  enum State: Equatable {
    case idle
    case requestingPermission
    case locating
    case ready
    case denied
    case restricted
    case unavailable
    case failed
  }

  @Published private(set) var state: State = .idle
  @Published private(set) var location: CLLocation?
  @Published private(set) var heading: CLLocationDirection?

  private let manager = CLLocationManager()

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    manager.distanceFilter = 15
    manager.headingFilter = 3
  }

  func start() {
    #if DEBUG
      if let fixed = DebugScenario.location {
        location = CLLocation(latitude: fixed.latitude, longitude: fixed.longitude)
        heading = DebugScenario.heading
        state = .ready
        return
      }
    #endif
    guard CLLocationManager.locationServicesEnabled() else {
      state = .unavailable
      return
    }
    switch manager.authorizationStatus {
    case .notDetermined:
      state = .requestingPermission
      manager.requestWhenInUseAuthorization()
    case .authorizedAlways, .authorizedWhenInUse:
      beginUpdates()
    case .denied:
      state = .denied
    case .restricted:
      state = .restricted
    @unknown default:
      state = .failed
    }
  }

  func retry() {
    start()
  }

  func stop() {
    manager.stopUpdatingLocation()
    manager.stopUpdatingHeading()
  }

  private func beginUpdates() {
    state = .locating
    manager.startUpdatingLocation()
    if CLLocationManager.headingAvailable() {
      manager.startUpdatingHeading()
    } else {
      heading = nil
    }
  }
}

extension WatchLocationService: CLLocationManagerDelegate {
  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    Task { @MainActor [weak self] in
      guard let self else { return }
      switch manager.authorizationStatus {
      case .authorizedAlways, .authorizedWhenInUse:
        self.beginUpdates()
      case .denied:
        self.state = .denied
      case .restricted:
        self.state = .restricted
      case .notDetermined:
        self.state = .requestingPermission
      @unknown default:
        self.state = .failed
      }
    }
  }

  nonisolated func locationManager(
    _ manager: CLLocationManager,
    didUpdateLocations locations: [CLLocation]
  ) {
    guard let latest = locations.last, latest.horizontalAccuracy >= 0 else { return }
    Task { @MainActor [weak self] in
      self?.location = latest
      self?.state = .ready
    }
  }

  nonisolated func locationManager(
    _ manager: CLLocationManager,
    didUpdateHeading newHeading: CLHeading
  ) {
    guard newHeading.headingAccuracy >= 0 else { return }
    let value = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
    Task { @MainActor [weak self] in
      self?.heading = value
    }
  }

  nonisolated func locationManager(
    _ manager: CLLocationManager,
    didFailWithError error: Error
  ) {
    let locationError = error as? CLError
    guard locationError?.code != .locationUnknown else { return }
    Task { @MainActor [weak self] in
      self?.state = .failed
    }
  }
}
