import CoreLocation
import Foundation

struct NearbyPubsClient {
  enum ClientError: Error {
    case invalidURL
    case invalidResponse
    case unavailable
  }

  private let session: URLSession
  private let baseURL: URL

  init(session: URLSession = .shared) {
    self.session = session
    #if DEBUG
      if let value = ProcessInfo.processInfo.environment["NAPIVO_WATCH_BACKEND_URL"],
        let debugURL = URL(string: value)
      {
        baseURL = debugURL
      } else {
        baseURL = URL(string: "https://api.na-pivo.cz")!
      }
    #else
      baseURL = URL(string: "https://api.na-pivo.cz")!
    #endif
  }

  func fetchNearby(from location: CLLocation) async throws -> [PubRef] {
    #if DEBUG
      if DebugScenario.forceOffline {
        throw ClientError.unavailable
      }
      if let pubs = DebugScenario.nearbyPubs {
        return pubs
      }
    #endif
    let coarseLatitude = roundedCoordinate(location.coordinate.latitude)
    let coarseLongitude = roundedCoordinate(location.coordinate.longitude)
    var components = URLComponents(
      url: baseURL.appendingPathComponent("v1/pubs/near"),
      resolvingAgainstBaseURL: false
    )
    components?.queryItems = [
      URLQueryItem(name: "lat", value: String(coarseLatitude)),
      URLQueryItem(name: "lng", value: String(coarseLongitude)),
      URLQueryItem(name: "radius_km", value: "5"),
    ]
    guard let url = components?.url else { throw ClientError.invalidURL }
    var request = URLRequest(url: url)
    request.timeoutInterval = 10
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw ClientError.invalidResponse
    }
    let payload = try JSONDecoder().decode(NearbyResponse.self, from: data)
    return payload.items
      .filter { $0.pubDetails?.venueKind != "not_pub" }
      .compactMap(\.pub)
      .sorted {
        distance(from: location.coordinate, to: $0) < distance(from: location.coordinate, to: $1)
      }
      .prefix(10)
      .map { $0 }
  }

  func fetchMenu(for pub: PubRef) async throws -> [DrinkTemplate] {
    #if DEBUG
      if DebugScenario.forceOffline {
        throw ClientError.unavailable
      }
      if let menu = DebugScenario.menu {
        return menu
      }
    #endif
    let url = baseURL.appendingPathComponent("v1/pub-hours")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(
      MenuRequest(
        pubs: [
          MenuRequest.Pub(
            name: pub.name,
            lat: pub.latitude,
            lng: pub.longitude,
            city: pub.city
          )
        ],
        syncBudget: 0
      )
    )
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      throw ClientError.invalidResponse
    }
    let payload = try JSONDecoder().decode(MenuResponse.self, from: data)
    return (payload.results.first?.beers ?? []).compactMap { beer in
      guard let name = DrinkValidation.normalizedName(beer.name) else { return nil }
      let volume = beer.volumeMl.flatMap {
        DrinkValidation.validVolume($0, for: .beer) ? $0 : nil
      }
      let price = beer.priceCzk.flatMap { DrinkValidation.validPrice($0) ? $0 : nil }
      return DrinkTemplate(
        name: name,
        drinkType: .beer,
        volumeMl: volume,
        priceCzk: price,
        servingType: .draft
      )
    }
  }

  static func distance(from location: CLLocation, to pub: PubRef) -> CLLocationDistance {
    location.distance(
      from: CLLocation(latitude: pub.latitude, longitude: pub.longitude)
    )
  }

  static func bearing(from origin: CLLocationCoordinate2D, to pub: PubRef) -> Double {
    let sourceLatitude = origin.latitude * .pi / 180
    let targetLatitude = pub.latitude * .pi / 180
    let deltaLongitude = (pub.longitude - origin.longitude) * .pi / 180
    let y = sin(deltaLongitude) * cos(targetLatitude)
    let x =
      cos(sourceLatitude) * sin(targetLatitude)
      - sin(sourceLatitude) * cos(targetLatitude) * cos(deltaLongitude)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
  }

  private func roundedCoordinate(_ value: Double) -> Double {
    (value * 1_000).rounded() / 1_000
  }

  private func distance(from origin: CLLocationCoordinate2D, to pub: PubRef) -> Double {
    CLLocation(latitude: origin.latitude, longitude: origin.longitude).distance(
      from: CLLocation(latitude: pub.latitude, longitude: pub.longitude)
    )
  }
}

private struct NearbyResponse: Decodable {
  let items: [NearbyItem]
}

private struct NearbyItem: Decodable {
  struct Position: Decodable {
    let lat: Double
    let lon: Double
  }

  struct RegionalEntry: Decodable {
    let name: String
    let type: String
  }

  struct PubDetails: Decodable {
    let venueKind: String?
  }

  let id: String?
  let name: String
  let position: Position
  let location: String?
  let regionalStructure: [RegionalEntry]?
  let pubDetails: PubDetails?

  var pub: PubRef? {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedName.isEmpty, normalizedName.count <= 200 else { return nil }
    let city =
      regionalStructure?.first(where: {
        $0.type == "regional.municipality" || $0.type == "regional.city"
      })?.name ?? location
    return PubRef(
      pubKey: Geohash.encode(latitude: position.lat, longitude: position.lon, precision: 8),
      name: normalizedName,
      latitude: position.lat,
      longitude: position.lon,
      city: city,
      externalId: id
    )
  }
}

private struct MenuRequest: Encodable {
  struct Pub: Encodable {
    let name: String
    let lat: Double
    let lng: Double
    let city: String?
  }

  let pubs: [Pub]
  let syncBudget: Int

  enum CodingKeys: String, CodingKey {
    case pubs
    case syncBudget = "sync_budget"
  }
}

private struct MenuResponse: Decodable {
  struct Result: Decodable {
    let beers: [Beer]?
  }

  struct Beer: Decodable {
    let name: String
    let priceCzk: Int?
    let volumeMl: Int?

    enum CodingKeys: String, CodingKey {
      case name
      case priceCzk = "price_czk"
      case volumeMl = "volume_ml"
    }
  }

  let results: [Result]
}

enum Geohash {
  private static let alphabet = Array("0123456789bcdefghjkmnpqrstuvwxyz")

  static func encode(latitude: Double, longitude: Double, precision: Int) -> String {
    var latitudeRange = (-90.0, 90.0)
    var longitudeRange = (-180.0, 180.0)
    var isLongitude = true
    var bit = 0
    var character = 0
    var result = ""

    while result.count < precision {
      if isLongitude {
        let midpoint = (longitudeRange.0 + longitudeRange.1) / 2
        if longitude > midpoint {
          character |= 1 << (4 - bit)
          longitudeRange.0 = midpoint
        } else {
          longitudeRange.1 = midpoint
        }
      } else {
        let midpoint = (latitudeRange.0 + latitudeRange.1) / 2
        if latitude > midpoint {
          character |= 1 << (4 - bit)
          latitudeRange.0 = midpoint
        } else {
          latitudeRange.1 = midpoint
        }
      }
      isLongitude.toggle()
      if bit < 4 {
        bit += 1
      } else {
        result.append(alphabet[character])
        bit = 0
        character = 0
      }
    }
    return result
  }
}
