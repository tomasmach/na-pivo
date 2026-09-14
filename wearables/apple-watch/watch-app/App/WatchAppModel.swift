import Combine
import CoreLocation
import Foundation
import WatchKit
import WidgetKit

@MainActor
final class WatchAppModel: ObservableObject {
  enum PresentedSheet: String, Identifiable {
    case targetPicker
    case pubConfirmation
    case drinkPicker
    case receipt
    case syncStatus

    var id: String { rawValue }
  }

  struct UndoOffer: Equatable {
    let eveningId: UUID
    let drinkId: UUID
    let title: String
    let expiresAt: Date
  }

  struct RapidConfirmation: Equatable {
    let template: DrinkTemplate
    let pub: PubRef
  }

  @Published private(set) var state = WatchLocalState.empty()
  @Published var presentedSheet: PresentedSheet?
  @Published var showCompass = true
  @Published private(set) var locationState: WatchLocationService.State = .idle
  @Published private(set) var location: CLLocation?
  @Published private(set) var heading: CLLocationDirection?
  @Published private(set) var isPhoneReachable = false
  @Published private(set) var phoneNeedsUnlock = false
  @Published private(set) var isLoadingNearby = false
  @Published private(set) var isLoadingMenu = false
  @Published private(set) var networkUnavailable = false
  @Published private(set) var undoOffer: UndoOffer?
  @Published private(set) var rapidConfirmation: RapidConfirmation?
  @Published var notice: String?

  private(set) var pendingConfirmationPub: PubRef?

  private let locationService: WatchLocationService
  private let connectivity: WatchConnectivityService
  private let pubsClient: NearbyPubsClient
  private var subscriptions = Set<AnyCancellable>()
  private var undoTask: Task<Void, Never>?
  private var nearbyTask: Task<Void, Never>?
  private var nearbyRetryTask: Task<Void, Never>?
  private var menuTask: Task<Void, Never>?
  private var lastNearbyOrigin: CLLocation?
  private var nearbyRefreshGate = NearbyRefreshGate()
  private var nearbyRetryRequired = false
  private var isRunning = false
  private var lastAcceptedTap = Date.distantPast
  private var didStart = false

  init(
    locationService: WatchLocationService? = nil,
    connectivity: WatchConnectivityService? = nil,
    pubsClient: NearbyPubsClient? = nil
  ) {
    self.locationService = locationService ?? WatchLocationService()
    self.connectivity = connectivity ?? WatchConnectivityService()
    self.pubsClient = pubsClient ?? NearbyPubsClient()
    bindServices()
  }

  deinit {
    undoTask?.cancel()
    nearbyTask?.cancel()
    nearbyRetryTask?.cancel()
    menuTask?.cancel()
  }

  var hasActiveEvening: Bool {
    guard let evening = state.activeEvening, evening.status == .active else { return false }
    return !evening.visibleDrinks.isEmpty
  }

  var selectedTarget: PubRef? {
    state.target?.pub ?? state.nearbyPubs.first
  }

  var currentEvening: EveningState? {
    state.activeEvening
  }

  var lastDrink: DrinkSpec? {
    currentEvening?.latestDrink
  }

  var pendingCommandCount: Int {
    state.pendingCommandCount
  }

  var syncLabel: String {
    if state.syncIssue != nil { return "Rozpor" }
    if pendingCommandCount > 0, isPhoneReachable { return "Posílám \(pendingCommandCount)" }
    if pendingCommandCount > 0 { return "Čeká \(pendingCommandCount)" }
    if phoneNeedsUnlock { return "Odemkni iPhone" }
    if isPhoneReachable { return "Srovnáno" }
    return "Bez telefonu"
  }

  var relativeBearing: Double? {
    guard
      let target = selectedTarget,
      let location,
      let heading
    else {
      return nil
    }
    let absolute = NearbyPubsClient.bearing(from: location.coordinate, to: target)
    return (absolute - heading + 360).truncatingRemainder(dividingBy: 360)
  }

  var targetDistance: CLLocationDistance? {
    guard let target = selectedTarget, let location else { return nil }
    return NearbyPubsClient.distance(from: location, to: target)
  }

  var menuCandidates: [DrinkTemplate] {
    guard let pub = pendingConfirmationPub ?? selectedTarget else { return [] }
    if let local = state.pubMenus[pub.pubKey] {
      return local
    }
    guard pub.pubKey == state.snapshotMenuPubKey else { return [] }
    return state.menuDrinks.map(\.template)
  }

  var recentCandidates: [DrinkTemplate] {
    deduplicatedTemplates(from: state.recentDrinks.map(\.template))
  }

  var frequentCandidates: [DrinkTemplate] {
    deduplicatedTemplates(from: state.frequentDrinks.map(\.template))
  }

  func start() {
    guard !didStart else {
      resume()
      return
    }
    didStart = true
    #if DEBUG
      seedDebugStateIfRequested()
    #endif
    do {
      state = try WatchDataStore.loadState()
    } catch {
      notice = "Lokální zápisy nejdou otevřít."
    }
    showCompass = !hasActiveEvening
    if state.syncIssue != nil {
      presentedSheet = .syncStatus
    }
    connectivity.onSnapshot = { [weak self] snapshotState in
      self?.receiveSnapshotState(snapshotState)
    }
    connectivity.onAcknowledgement = { [weak self] acknowledgedState in
      self?.receiveAcknowledgementState(acknowledgedState)
    }
    resume()
    if let target = selectedTarget {
      refreshMenu(for: target)
    }
  }

  func resume() {
    guard didStart else { return }
    isRunning = true
    connectivity.activate()
    locationService.start()
    flushPending()
    if nearbyRetryRequired, let location {
      scheduleNearbyRetry(from: location)
    }
  }

  func stop() {
    isRunning = false
    nearbyRetryTask?.cancel()
    nearbyRetryTask = nil
    locationService.stop()
  }

  func retryLocation() {
    locationService.retry()
  }

  func showCounter() {
    guard hasActiveEvening else { return }
    showCompass = false
  }

  func openCompass() {
    showCompass = true
  }

  func openTargetPicker() {
    presentedSheet = .targetPicker
  }

  func selectTarget(_ pub: PubRef) {
    let target = TargetState(selection: .manual, pub: pub)
    do {
      let envelopes = try WatchDataStore.enqueue([.setTarget(target)])
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      refreshMenu(for: pub)
      presentedSheet = nil
    } catch {
      notice = "Cíl se neuložil."
    }
  }

  func askToLogAtTarget() {
    guard let pub = selectedTarget else {
      notice = "Nejdřív vyber hospodu."
      return
    }
    pendingConfirmationPub = pub
    presentedSheet = .pubConfirmation
  }

  func confirmPub() {
    guard let pub = pendingConfirmationPub else {
      presentedSheet = nil
      return
    }
    presentedSheet = .drinkPicker
    refreshMenu(for: pub)
  }

  func cancelPubConfirmation() {
    pendingConfirmationPub = nil
    presentedSheet = nil
  }

  func openDrinkPicker() {
    pendingConfirmationPub = currentEvening?.pub ?? selectedTarget
    presentedSheet = .drinkPicker
    if let pub = pendingConfirmationPub {
      refreshMenu(for: pub)
    }
  }

  func openReceipt() {
    presentedSheet = .receipt
  }

  func openSyncStatus() {
    presentedSheet = .syncStatus
  }

  func repeatLastDrink() {
    guard let drink = lastDrink, let pub = currentEvening?.pub else { return }
    let template = DrinkTemplate(drink: drink)
    requestRecord(template, at: pub)
  }

  func repeatButtonLongPressed() {
    lastAcceptedTap = Date().addingTimeInterval(0.8)
    openDrinkPicker()
  }

  func requestRecord(_ template: DrinkTemplate, at pub: PubRef) {
    guard let price = template.priceCzk, DrinkValidation.validPrice(price) else {
      notice = "Nejdřív doplň cenu."
      return
    }
    guard let volumeMl = template.volumeMl else {
      notice = "Nejdřív doplň objem."
      return
    }
    guard DrinkValidation.validVolume(volumeMl, for: template.drinkType) else {
      notice = "Ten objem nesedí."
      return
    }
    guard DrinkValidation.normalizedName(template.name) != nil else {
      notice = "Napiš konkrétní drink."
      return
    }
    let now = Date()
    if template.drinkType != .softDrink,
      let latest = lastDrink,
      now.timeIntervalSince(latest.recordedAt) >= 0,
      now.timeIntervalSince(latest.recordedAt) < 5 * 60
    {
      rapidConfirmation = RapidConfirmation(template: template, pub: pub)
      return
    }
    record(template, at: pub, now: now)
  }

  func confirmRapidRecord() {
    guard let pending = rapidConfirmation else { return }
    rapidConfirmation = nil
    record(pending.template, at: pending.pub, now: Date())
  }

  func cancelRapidRecord() {
    rapidConfirmation = nil
  }

  func recordNewDrink(
    type: DrinkType,
    name: String,
    volumeMl: Int,
    priceCzk: Int,
    servingType: ServingType = .unknown
  ) {
    guard let pub = pendingConfirmationPub ?? currentEvening?.pub ?? selectedTarget else {
      notice = "Chybí hospoda."
      return
    }
    guard let concreteName = DrinkValidation.normalizedName(name) else {
      notice = "Napiš konkrétní název."
      return
    }
    guard DrinkValidation.validVolume(volumeMl, for: type) else {
      notice = type == .shot ? "Panák má 10 až 200 ml." : "Objem má 10 až 3000 ml."
      return
    }
    guard DrinkValidation.validPrice(priceCzk) else {
      notice = "Cena má být 1 až 1000 Kč."
      return
    }
    let template = DrinkTemplate(
      name: concreteName,
      drinkType: type,
      volumeMl: volumeMl,
      priceCzk: priceCzk,
      servingType: servingType
    )
    requestRecord(template, at: pub)
  }

  func undoLastDrink() {
    guard let offer = undoOffer else { return }
    undoOffer = nil
    undoTask?.cancel()
    do {
      let envelopes = try WatchDataStore.enqueue([
        .removeDrink(
          eveningId: offer.eveningId,
          drinkId: offer.drinkId,
          reason: .undo
        )
      ])
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
      WKInterfaceDevice.current().play(.click)
      if !hasActiveEvening {
        showCompass = true
      }
    } catch {
      notice = "Vrácení se neuložilo."
    }
  }

  func removeDrink(_ drink: DrinkSpec) {
    guard let evening = currentEvening else { return }
    do {
      let envelopes = try WatchDataStore.enqueue([
        .removeDrink(
          eveningId: evening.eveningId,
          drinkId: drink.id,
          reason: .correction
        )
      ])
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
      WKInterfaceDevice.current().play(.click)
      if !hasActiveEvening {
        presentedSheet = nil
        showCompass = true
      }
    } catch {
      notice = "Drink se neodebral."
    }
  }

  func finishEvening() {
    guard let evening = currentEvening else { return }
    do {
      let envelopes = try WatchDataStore.enqueue([
        .closeEvening(eveningId: evening.eveningId, closedAt: Date())
      ])
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
      WKInterfaceDevice.current().play(.success)
      presentedSheet = nil
      showCompass = true
      pendingConfirmationPub = nil
    } catch {
      notice = "Večer se neuzavřel."
    }
  }

  func resolveTargetConflict(using target: TargetState) {
    do {
      let envelopes = try WatchDataStore.resolveTargetConflict(with: target)
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      presentedSheet = nil
    } catch {
      notice = "Rozpor se nevyřešil."
    }
  }

  func resolveEveningConflict(using eveningId: UUID) {
    do {
      let envelopes = try WatchDataStore.enqueue([
        .resolveEveningConflict(activeEveningId: eveningId)
      ])
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      presentedSheet = nil
      showCompass = !hasActiveEvening
    } catch {
      notice = "Večer se nepodařilo vybrat."
    }
  }

  func requestPhoneSync() {
    connectivity.requestSync()
    flushPending()
  }

  private func bindServices() {
    locationService.$state
      .receive(on: RunLoop.main)
      .sink { [weak self] value in self?.locationState = value }
      .store(in: &subscriptions)

    locationService.$location
      .receive(on: RunLoop.main)
      .sink { [weak self] value in
        guard let self else { return }
        self.location = value
        if let value {
          self.refreshNearby(from: value)
        }
      }
      .store(in: &subscriptions)

    locationService.$heading
      .receive(on: RunLoop.main)
      .sink { [weak self] value in self?.heading = value }
      .store(in: &subscriptions)

    connectivity.$isPhoneReachable
      .receive(on: RunLoop.main)
      .sink { [weak self] value in
        self?.isPhoneReachable = value
        if value {
          self?.flushPending()
        }
      }
      .store(in: &subscriptions)

    connectivity.$phoneNeedsUnlock
      .receive(on: RunLoop.main)
      .sink { [weak self] value in self?.phoneNeedsUnlock = value }
      .store(in: &subscriptions)
  }

  private func refreshNearby(from location: CLLocation) {
    let isSameArea =
      lastNearbyOrigin.map {
        location.distance(from: $0) < 100
      } ?? false
    guard
      nearbyRefreshGate.startAttempt(
        isSameArea: isSameArea,
        hasCachedPubs: !state.nearbyPubs.isEmpty,
        nowUptime: ProcessInfo.processInfo.systemUptime
      )
    else {
      return
    }
    nearbyRetryTask?.cancel()
    nearbyRetryTask = nil
    lastNearbyOrigin = location
    nearbyTask?.cancel()
    isLoadingNearby = true
    nearbyTask = Task { [weak self] in
      guard let self else { return }
      do {
        let pubs = try await pubsClient.fetchNearby(from: location)
        guard !Task.isCancelled else { return }
        state = try WatchDataStore.updateNearbyPubs(pubs, refreshedAt: Date())
        finishNearbyAttempt(retryRequired: pubs.isEmpty, from: location)
        isLoadingNearby = false
        networkUnavailable = false
        if let target = selectedTarget {
          refreshMenu(for: target)
        }
      } catch {
        guard !Task.isCancelled else { return }
        finishNearbyAttempt(retryRequired: true, from: location)
        isLoadingNearby = false
        networkUnavailable = true
        if state.nearbyPubs.isEmpty {
          notice = "Síť stávkuje. Zkusíme to za chvíli."
        }
      }
    }
  }

  private func finishNearbyAttempt(retryRequired: Bool, from location: CLLocation) {
    nearbyRefreshGate.finishAttempt(retryRequired: retryRequired)
    nearbyRetryRequired = retryRequired
    if retryRequired {
      scheduleNearbyRetry(from: location)
    }
  }

  private func scheduleNearbyRetry(from fallbackLocation: CLLocation) {
    guard isRunning else { return }
    nearbyRetryTask?.cancel()
    nearbyRetryTask = Task { [weak self] in
      try? await Task.sleep(
        for: .seconds(NearbyRefreshGate.defaultRetryCooldown)
      )
      guard let self, !Task.isCancelled, isRunning else { return }
      let retryLocation = location ?? fallbackLocation
      nearbyRetryTask = nil
      refreshNearby(from: retryLocation)
    }
  }

  private func refreshMenu(for pub: PubRef) {
    menuTask?.cancel()
    isLoadingMenu = true
    menuTask = Task { [weak self] in
      guard let self else { return }
      do {
        let menu = try await pubsClient.fetchMenu(for: pub)
        guard !Task.isCancelled else { return }
        state = try WatchDataStore.updateMenu(menu, for: pub.pubKey)
        isLoadingMenu = false
      } catch {
        guard !Task.isCancelled else { return }
        isLoadingMenu = false
      }
    }
  }

  private func record(_ template: DrinkTemplate, at pub: PubRef, now: Date) {
    guard now >= lastAcceptedTap else { return }
    guard now.timeIntervalSince(lastAcceptedTap) >= 1.2 else {
      notice = "Jednou stačí."
      return
    }
    lastAcceptedTap = now
    guard
      let name = DrinkValidation.normalizedName(template.name),
      let volumeMl = template.volumeMl,
      let price = template.priceCzk
    else {
      return
    }
    let drink = DrinkSpec(
      id: UUID(),
      name: name,
      drinkType: template.drinkType,
      volumeMl: volumeMl,
      priceCzk: price,
      servingType: template.servingType,
      recordedAt: now
    )

    var commands: [WearableCommand] = []
    if let active = state.activeEvening,
      active.status == .active,
      active.pub.pubKey != pub.pubKey
    {
      commands.append(.closeEvening(eveningId: active.eveningId, closedAt: now))
      commands.append(
        .startEveningAndAddDrink(
          eveningId: UUID(),
          pub: pub,
          drinkingDayKey: drinkingDayKey(for: now),
          drink: drink
        )
      )
    } else if let active = state.activeEvening, active.status == .active {
      commands.append(.addDrink(eveningId: active.eveningId, drink: drink))
    } else {
      commands.append(
        .startEveningAndAddDrink(
          eveningId: UUID(),
          pub: pub,
          drinkingDayKey: drinkingDayKey(for: now),
          drink: drink
        )
      )
    }

    do {
      let envelopes = try WatchDataStore.enqueue(commands, at: now)
      state = try WatchDataStore.loadState()
      connectivity.flushOutbox(envelopes)
      WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
      WKInterfaceDevice.current().play(.success)
      pendingConfirmationPub = nil
      presentedSheet = nil
      showCompass = false
      offerUndo(for: drink)
    } catch {
      notice = "Zápis se neuložil."
    }
  }

  private func offerUndo(for drink: DrinkSpec) {
    guard let evening = state.activeEvening else { return }
    undoTask?.cancel()
    let offer = UndoOffer(
      eveningId: evening.eveningId,
      drinkId: drink.id,
      title: drink.name,
      expiresAt: Date().addingTimeInterval(6)
    )
    undoOffer = offer
    undoTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(6))
      guard !Task.isCancelled else { return }
      if self?.undoOffer == offer {
        self?.undoOffer = nil
      }
    }
  }

  private func receiveSnapshotState(_ snapshotState: WatchLocalState) {
    state = snapshotState
    WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
    showCompass = showCompass || !hasActiveEvening
    if state.syncIssue != nil {
      presentedSheet = .syncStatus
    }
    if let target = selectedTarget {
      refreshMenu(for: target)
    }
  }

  private func receiveAcknowledgementState(_ acknowledgedState: WatchLocalState) {
    state = acknowledgedState
    WidgetCenter.shared.reloadTimelines(ofKind: "NapivoEveningWidget")
  }

  private func flushPending() {
    guard let pending = try? WatchDataStore.loadOutbox(), !pending.isEmpty else { return }
    connectivity.flushOutbox(pending)
  }

  private func drinkingDayKey(for date: Date) -> String {
    let shifted = date.addingTimeInterval(-4 * 60 * 60)
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: shifted)
  }

  private func deduplicatedTemplates(from source: [DrinkTemplate]) -> [DrinkTemplate] {
    var seen = Set<String>()
    return source.filter { seen.insert($0.id).inserted }
  }

  #if DEBUG
    private func seedDebugStateIfRequested() {
      guard
        let scenario = DebugScenario.name,
        ["active", "target_conflict", "evening_conflict"].contains(scenario),
        let pubs = DebugScenario.nearbyPubs,
        let pub = pubs.first
      else {
        return
      }
      var seeded = WatchLocalState.empty()
      let drink = DrinkSpec(
        id: UUID(),
        name: "Pilsner Urquell 12°",
        drinkType: .beer,
        volumeMl: 500,
        priceCzk: 68,
        servingType: .draft,
        recordedAt: Date().addingTimeInterval(-12 * 60)
      )
      seeded.target = TargetState(selection: .manual, pub: pub)
      seeded.activeEvening = EveningState(
        eveningId: UUID(),
        pub: pub,
        drinkingDayKey: drinkingDayKey(for: Date()),
        startedAt: drink.recordedAt,
        status: .active,
        drinks: [drink],
        removedDrinkIds: []
      )
      seeded.nearbyPubs = pubs
      seeded.pubMenus[pub.pubKey] = DebugScenario.menu ?? []

      if scenario == "target_conflict", pubs.count > 1 {
        seeded.conflictingTarget = TargetState(selection: .manual, pub: pubs[1])
        seeded.syncIssue = .targetConflict
      }

      if scenario == "evening_conflict", pubs.count > 1 {
        let otherDrink = DrinkSpec(
          id: UUID(),
          name: "Kofola Original",
          drinkType: .softDrink,
          volumeMl: 500,
          priceCzk: 55,
          servingType: .draft,
          recordedAt: Date().addingTimeInterval(-5 * 60)
        )
        seeded.otherEvenings = [
          EveningState(
            eveningId: UUID(),
            pub: pubs[1],
            drinkingDayKey: drinkingDayKey(for: Date()),
            startedAt: otherDrink.recordedAt,
            status: .conflict,
            drinks: [otherDrink],
            removedDrinkIds: []
          )
        ]
        seeded.syncIssue = .eveningConflict
      }

      try? WatchDataStore.replaceForDebug(seeded)
    }
  #endif
}
