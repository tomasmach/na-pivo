#if os(watchOS) || NAPIVO_CONTRACT_TESTS
  import Foundation

  enum WearableProtocol {
    static let version = 1
    static let appGroup = "group.com.tomasmach.na-pivo"
    static let commandTransportKey = "envelope"
  }

  enum WearableActorKind: String, Codable {
    case phone
    case watchOS = "watchos"
    case wearOS = "wearos"
  }

  enum DrinkType: String, Codable, CaseIterable, Identifiable {
    case beer
    case softDrink = "soft_drink"
    case wine
    case shot

    var id: String { rawValue }

    var title: String {
      switch self {
      case .beer: "Pivo"
      case .softDrink: "Nealko"
      case .wine: "Víno"
      case .shot: "Panák"
      }
    }

    var shortTitle: String {
      switch self {
      case .beer: "pivo"
      case .softDrink: "nealko"
      case .wine: "víno"
      case .shot: "panák"
      }
    }

    var systemImage: String {
      switch self {
      case .beer: "mug.fill"
      case .softDrink: "waterbottle.fill"
      case .wine: "wineglass.fill"
      case .shot: "smallcircle.filled.circle"
      }
    }

    var volumePresets: [Int] {
      switch self {
      case .beer: [300, 400, 500]
      case .softDrink: [300, 500]
      case .wine: [100, 150, 200]
      case .shot: [20, 40, 50]
      }
    }

    var defaultVolume: Int {
      switch self {
      case .beer, .softDrink: 500
      case .wine: 200
      case .shot: 40
      }
    }
  }

  enum ServingType: String, Codable, CaseIterable {
    case unknown
    case draft
    case bottle
    case can
    case plasticBottle = "plastic_bottle"
    case other
  }

  struct PubRef: Codable, Hashable, Identifiable {
    let pubKey: String
    let name: String
    let latitude: Double
    let longitude: Double
    var city: String?
    var externalId: String?

    var id: String { pubKey }
  }

  struct DrinkSpec: Codable, Hashable, Identifiable {
    let id: UUID
    let name: String
    let drinkType: DrinkType
    let volumeMl: Int
    let priceCzk: Int
    let servingType: ServingType
    let recordedAt: Date

    var summary: String {
      "\(drinkType.shortTitle) · \(Self.formatVolume(volumeMl)) · \(priceCzk) Kč"
    }

    var repeatLabel: String {
      "\(name) · \(summary)"
    }

    static func formatVolume(_ millilitres: Int) -> String {
      if millilitres % 1000 == 0 {
        return "\(millilitres / 1000) l"
      }
      let value = Double(millilitres) / 1000
      return String(format: "%.2g l", value).replacingOccurrences(of: ".", with: ",")
    }
  }

  struct DrinkTemplate: Codable, Hashable, Identifiable {
    let name: String
    let drinkType: DrinkType
    let volumeMl: Int?
    let priceCzk: Int?
    let servingType: ServingType

    var id: String {
      "\(drinkType.rawValue)|\(name.lowercased())|\(volumeMl.map(String.init) ?? "unknown")"
    }

    init(
      name: String,
      drinkType: DrinkType,
      volumeMl: Int?,
      priceCzk: Int?,
      servingType: ServingType
    ) {
      self.name = name
      self.drinkType = drinkType
      self.volumeMl = volumeMl
      self.priceCzk = priceCzk
      self.servingType = servingType
    }

    init(drink: DrinkSpec) {
      self.init(
        name: drink.name,
        drinkType: drink.drinkType,
        volumeMl: drink.volumeMl,
        priceCzk: drink.priceCzk,
        servingType: drink.servingType
      )
    }
  }

  struct DrinkChoice: Codable, Hashable, Identifiable {
    let choiceId: String
    let name: String
    let drinkType: DrinkType
    let volumeMl: Int?
    let priceCzk: Int?
    let servingType: ServingType

    var id: String { choiceId }

    var template: DrinkTemplate {
      DrinkTemplate(
        name: name,
        drinkType: drinkType,
        volumeMl: volumeMl,
        priceCzk: priceCzk,
        servingType: servingType
      )
    }
  }

  enum TargetSelection: String, Codable {
    case manual
    case nearest
  }

  struct TargetState: Codable, Hashable {
    let selection: TargetSelection
    let pub: PubRef
  }

  enum EveningStatus: String, Codable {
    case active
    case closed
    case conflict
  }

  struct EveningState: Codable, Hashable, Identifiable {
    let eveningId: UUID
    let pub: PubRef
    let drinkingDayKey: String
    let startedAt: Date
    var closedAt: Date?
    var status: EveningStatus
    var drinks: [DrinkSpec]
    var removedDrinkIds: [UUID]

    var id: UUID { eveningId }

    var visibleDrinks: [DrinkSpec] {
      let removed = Set(removedDrinkIds)
      return drinks.filter { !removed.contains($0.id) }
    }

    var beerCount: Int {
      visibleDrinks.filter { $0.drinkType == .beer }.count
    }

    var otherCounts: [DrinkType: Int] {
      Dictionary(grouping: visibleDrinks.filter { $0.drinkType != .beer }, by: \.drinkType)
        .mapValues(\.count)
    }

    var totalCzk: Int {
      visibleDrinks.reduce(0) { $0 + $1.priceCzk }
    }

    var latestDrink: DrinkSpec? {
      visibleDrinks.max { $0.recordedAt < $1.recordedAt }
    }

    mutating func addIfMissing(_ drink: DrinkSpec) {
      guard !drinks.contains(where: { $0.id == drink.id }) else { return }
      drinks.append(drink)
    }

    mutating func remove(_ drinkId: UUID) {
      guard !removedDrinkIds.contains(drinkId) else { return }
      removedDrinkIds.append(drinkId)
    }
  }

  enum RemoveReason: String, Codable {
    case undo
    case correction
  }

  enum WearableCommand: Codable, Hashable {
    case setTarget(TargetState)
    case clearTarget
    case startEveningAndAddDrink(
      eveningId: UUID,
      pub: PubRef,
      drinkingDayKey: String,
      drink: DrinkSpec
    )
    case addDrink(eveningId: UUID, drink: DrinkSpec)
    case removeDrink(eveningId: UUID, drinkId: UUID, reason: RemoveReason)
    case closeEvening(eveningId: UUID, closedAt: Date)
    case resolveEveningConflict(activeEveningId: UUID)

    private enum CodingKeys: String, CodingKey {
      case type
      case target
      case eveningId
      case pub
      case drinkingDayKey
      case drink
      case drinkId
      case reason
      case closedAt
      case activeEveningId
    }

    private enum Kind: String, Codable {
      case setTarget = "set_target"
      case clearTarget = "clear_target"
      case startEveningAndAddDrink = "start_evening_and_add_drink"
      case addDrink = "add_drink"
      case removeDrink = "remove_drink"
      case closeEvening = "close_evening"
      case resolveEveningConflict = "resolve_evening_conflict"
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      switch try container.decode(Kind.self, forKey: .type) {
      case .setTarget:
        self = .setTarget(try container.decode(TargetState.self, forKey: .target))
      case .clearTarget:
        self = .clearTarget
      case .startEveningAndAddDrink:
        self = .startEveningAndAddDrink(
          eveningId: try container.decode(UUID.self, forKey: .eveningId),
          pub: try container.decode(PubRef.self, forKey: .pub),
          drinkingDayKey: try container.decode(String.self, forKey: .drinkingDayKey),
          drink: try container.decode(DrinkSpec.self, forKey: .drink)
        )
      case .addDrink:
        self = .addDrink(
          eveningId: try container.decode(UUID.self, forKey: .eveningId),
          drink: try container.decode(DrinkSpec.self, forKey: .drink)
        )
      case .removeDrink:
        self = .removeDrink(
          eveningId: try container.decode(UUID.self, forKey: .eveningId),
          drinkId: try container.decode(UUID.self, forKey: .drinkId),
          reason: try container.decode(RemoveReason.self, forKey: .reason)
        )
      case .closeEvening:
        self = .closeEvening(
          eveningId: try container.decode(UUID.self, forKey: .eveningId),
          closedAt: try container.decode(Date.self, forKey: .closedAt)
        )
      case .resolveEveningConflict:
        self = .resolveEveningConflict(
          activeEveningId: try container.decode(UUID.self, forKey: .activeEveningId)
        )
      }
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      switch self {
      case .setTarget(let target):
        try container.encode(Kind.setTarget, forKey: .type)
        try container.encode(target, forKey: .target)
      case .clearTarget:
        try container.encode(Kind.clearTarget, forKey: .type)
      case .startEveningAndAddDrink(let eveningId, let pub, let drinkingDayKey, let drink):
        try container.encode(Kind.startEveningAndAddDrink, forKey: .type)
        try container.encode(eveningId, forKey: .eveningId)
        try container.encode(pub, forKey: .pub)
        try container.encode(drinkingDayKey, forKey: .drinkingDayKey)
        try container.encode(drink, forKey: .drink)
      case .addDrink(let eveningId, let drink):
        try container.encode(Kind.addDrink, forKey: .type)
        try container.encode(eveningId, forKey: .eveningId)
        try container.encode(drink, forKey: .drink)
      case .removeDrink(let eveningId, let drinkId, let reason):
        try container.encode(Kind.removeDrink, forKey: .type)
        try container.encode(eveningId, forKey: .eveningId)
        try container.encode(drinkId, forKey: .drinkId)
        try container.encode(reason, forKey: .reason)
      case .closeEvening(let eveningId, let closedAt):
        try container.encode(Kind.closeEvening, forKey: .type)
        try container.encode(eveningId, forKey: .eveningId)
        try container.encode(closedAt, forKey: .closedAt)
      case .resolveEveningConflict(let activeEveningId):
        try container.encode(Kind.resolveEveningConflict, forKey: .type)
        try container.encode(activeEveningId, forKey: .activeEveningId)
      }
    }
  }

  struct CommandPayload: Codable, Hashable {
    let command: WearableCommand
  }

  struct CommandEnvelope: Codable, Hashable, Identifiable {
    let protocolVersion: Int
    let messageId: UUID
    let accountEpoch: UUID
    let actorId: String
    let actorKind: WearableActorKind
    let actorSequence: Int
    let baseRevision: Int
    let sentAt: Date
    let kind: String
    let payload: CommandPayload

    var id: UUID { messageId }
  }

  struct StateSnapshotPayload: Codable, Hashable {
    let revision: Int
    let target: TargetState?
    let activeEvening: EveningState?
    let otherEvenings: [EveningState]
    let nearbyPubs: [PubRef]
    let recentDrinks: [DrinkChoice]
    let frequentDrinks: [DrinkChoice]
    let menuDrinks: [DrinkChoice]
    let pendingCommandCount: Int
    let isStale: Bool
    let lastPhoneContactAt: Date?
  }

  struct StateSnapshotEnvelope: Codable, Hashable {
    let protocolVersion: Int
    let messageId: UUID
    let accountEpoch: UUID
    let actorId: String
    let actorKind: WearableActorKind
    let actorSequence: Int
    let baseRevision: Int
    let sentAt: Date
    let kind: String
    let payload: StateSnapshotPayload
  }

  struct AckPayload: Codable, Hashable {
    let acknowledgedMessageIds: [UUID]
    let revision: Int
  }

  struct AckEnvelope: Codable, Hashable {
    let protocolVersion: Int
    let messageId: UUID
    let accountEpoch: UUID
    let actorId: String
    let actorKind: WearableActorKind
    let actorSequence: Int
    let baseRevision: Int
    let sentAt: Date
    let kind: String
    let payload: AckPayload
  }

  enum WearableEnvelopeDecoder {
    static func decoder() -> JSONDecoder {
      let decoder = JSONDecoder()
      decoder.dateDecodingStrategy = .iso8601
      return decoder
    }

    static func encoder() -> JSONEncoder {
      let encoder = JSONEncoder()
      encoder.dateEncodingStrategy = .iso8601
      encoder.outputFormatting = [.sortedKeys]
      return encoder
    }

    static func kind(in data: Data) -> String? {
      guard
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let kind = object["kind"] as? String
      else {
        return nil
      }
      return kind
    }
  }

  enum DrinkValidation {
    private static let genericNames: Set<String> = [
      "beer", "drink", "napoj", "nealko", "neco", "něco", "nápoj", "panak", "panák",
      "pivo", "shot", "vino", "víno",
    ]

    static func normalizedName(_ input: String) -> String? {
      let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, trimmed.count <= 80 else { return nil }
      guard !genericNames.contains(trimmed.lowercased()) else { return nil }
      return trimmed
    }

    static func validVolume(_ value: Int, for type: DrinkType) -> Bool {
      switch type {
      case .shot:
        (10...200).contains(value)
      case .beer, .softDrink, .wine:
        (10...3000).contains(value)
      }
    }

    static func validPrice(_ value: Int) -> Bool {
      (1...1000).contains(value)
    }
  }
#endif
