import CoreLocation
import Foundation

#if DEBUG
  enum DebugScenario {
    static let name = ProcessInfo.processInfo.environment["NAPIVO_WATCH_SCENARIO"]
    static let forceOffline =
      ProcessInfo.processInfo.environment["NAPIVO_WATCH_FORCE_OFFLINE"] == "1"

    static var location: CLLocationCoordinate2D? {
      guard name != nil else { return nil }
      return CLLocationCoordinate2D(latitude: 50.087, longitude: 14.421)
    }

    static var heading: CLLocationDirection? {
      guard let raw = ProcessInfo.processInfo.environment["NAPIVO_WATCH_FIXED_HEADING"] else {
        return name == nil ? nil : 35
      }
      return Double(raw)
    }

    static var nearbyPubs: [PubRef]? {
      guard name != nil else { return nil }
      return [
        PubRef(
          pubKey: "u2fkbn4f",
          name: "U Zlatého tygra",
          latitude: 50.08706,
          longitude: 14.41786,
          city: "Praha"
        ),
        PubRef(
          pubKey: "u2fkbn8k",
          name: "Lokál Dlouhááá",
          latitude: 50.09016,
          longitude: 14.42537,
          city: "Praha"
        ),
        PubRef(
          pubKey: "u2fkbjzz",
          name: "U Medvídků",
          latitude: 50.08243,
          longitude: 14.41921,
          city: "Praha"
        ),
      ]
    }

    static var menu: [DrinkTemplate]? {
      guard name != nil else { return nil }
      return [
        DrinkTemplate(
          name: "Pilsner Urquell 12°",
          drinkType: .beer,
          volumeMl: 500,
          priceCzk: 68,
          servingType: .draft
        ),
        DrinkTemplate(
          name: "Kozel 11°",
          drinkType: .beer,
          volumeMl: 500,
          priceCzk: 54,
          servingType: .draft
        ),
        DrinkTemplate(
          name: "Birell Pomelo",
          drinkType: .softDrink,
          volumeMl: 500,
          priceCzk: 49,
          servingType: .bottle
        ),
      ]
    }
  }
#else
  enum DebugScenario {
    static let forceOffline = false
  }
#endif
