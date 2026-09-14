import SwiftUI

struct NewDrinkFlowView: View {
  enum Step {
    case type
    case name
    case confirmName
    case volume
    case price
    case review
  }

  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss

  let initialType: DrinkType
  let seed: DrinkTemplate?

  @State private var step: Step
  @State private var drinkType: DrinkType
  @State private var name: String
  @State private var volumeMl: Int
  @State private var priceCzk: Int?
  @State private var validationMessage: String?

  init(
    initialType: DrinkType,
    seed: DrinkTemplate?,
    startsAtTypePicker: Bool = true
  ) {
    self.initialType = initialType
    self.seed = seed
    _drinkType = State(initialValue: seed?.drinkType ?? initialType)
    _name = State(initialValue: seed?.name ?? "")
    _volumeMl = State(initialValue: seed?.volumeMl ?? initialType.defaultVolume)
    _priceCzk = State(initialValue: seed?.priceCzk)
    _step = State(
      initialValue: seed == nil
        ? (startsAtTypePicker ? .type : .name)
        : .confirmName
    )
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        progress
        stepContent
      }
      .padding(.horizontal, 3)
    }
    .navigationTitle("Nový drink")
    .navigationBarTitleDisplayMode(.inline)
    .alert(
      "Tohle nesedí",
      isPresented: Binding(
        get: { validationMessage != nil },
        set: { if !$0 { validationMessage = nil } }
      )
    ) {
      Button("Opravit") {
        validationMessage = nil
      }
    } message: {
      Text(validationMessage ?? "")
    }
  }

  private var progress: some View {
    HStack(spacing: 4) {
      ForEach(0..<5, id: \.self) { index in
        Capsule()
          .fill(index <= progressIndex ? WatchTheme.amber : WatchTheme.surface)
          .frame(height: 3)
      }
    }
    .padding(.horizontal, 6)
  }

  @ViewBuilder
  private var stepContent: some View {
    switch step {
    case .type:
      typeStep
    case .name:
      nameStep
    case .confirmName:
      confirmNameStep
    case .volume:
      volumeStep
    case .price:
      priceStep
    case .review:
      reviewStep
    }
  }

  private var typeStep: some View {
    VStack(spacing: 8) {
      Text("Jaký typ?")
        .font(.headline)
      LazyVGrid(
        columns: [
          GridItem(.flexible(), spacing: 7),
          GridItem(.flexible(), spacing: 7),
        ],
        spacing: 7
      ) {
        ForEach(DrinkType.allCases) { type in
          Button {
            drinkType = type
            volumeMl = type.defaultVolume
            step = .name
          } label: {
            VStack(spacing: 3) {
              Image(systemName: type.systemImage)
              Text(type.title)
                .font(.caption.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 46)
          }
          .buttonStyle(.bordered)
          .tint(type == .beer ? WatchTheme.amber : WatchTheme.creamMuted)
          .accessibilityIdentifier("watch.newDrink.type.\(type.rawValue)")
        }
      }
    }
  }

  private var nameStep: some View {
    VStack(spacing: 7) {
      Text("Konkrétní název")
        .font(.headline)
      Text("Nadiktuj nebo napiš název. Samotné „Pivo“ neprojde.")
        .font(.caption2)
        .foregroundStyle(WatchTheme.muted)
        .multilineTextAlignment(.center)
        .lineLimit(3)
      TextFieldLink(
        "Napsat nebo nadiktovat",
        prompt: Text("Název drinku")
      ) { result in
        name = String(result.prefix(80))
        step = .confirmName
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .controlSize(.large)
      .accessibilityIdentifier("watch.newDrink.nameInput")
    }
  }

  private var confirmNameStep: some View {
    VStack(spacing: 10) {
      Text("Slyšel jsem:")
        .font(.caption)
        .foregroundStyle(WatchTheme.muted)
      Text(name.isEmpty ? "Nic" : name)
        .font(.title3.weight(.bold))
        .multilineTextAlignment(.center)
        .privacySensitive()
      Button {
        guard let normalized = DrinkValidation.normalizedName(name) else {
          validationMessage = "Potřebuju konkrétní název do 80 znaků."
          return
        }
        name = normalized
        step = .volume
      } label: {
        Label("Sedí", systemImage: "checkmark")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .accessibilityIdentifier("watch.newDrink.confirmName")
      Button("Opravit") {
        step = .name
      }
      .accessibilityIdentifier("watch.newDrink.retryName")
    }
  }

  private var volumeStep: some View {
    VStack(spacing: 8) {
      Text("Kolik toho je?")
        .font(.headline)
      LazyVGrid(
        columns: [
          GridItem(.flexible(), spacing: 7),
          GridItem(.flexible(), spacing: 7),
        ],
        spacing: 7
      ) {
        ForEach(drinkType.volumePresets, id: \.self) { volume in
          Button {
            volumeMl = volume
            step = .price
          } label: {
            Text(DrinkSpec.formatVolume(volume))
              .font(.body.monospacedDigit().weight(.semibold))
              .frame(maxWidth: .infinity, minHeight: 38)
          }
          .buttonStyle(.bordered)
          .tint(WatchTheme.amber)
          .accessibilityIdentifier("watch.newDrink.volume.\(volume)")
        }

        TextFieldLink(
          "Jiný objem",
          prompt: Text("Mililitry")
        ) { result in
          let digits = result.filter(\.isNumber)
          guard let value = Int(digits), DrinkValidation.validVolume(value, for: drinkType) else {
            validationMessage =
              drinkType == .shot
              ? "Panák může mít 10 až 200 ml."
              : "Objem může mít 10 až 3000 ml."
            return
          }
          volumeMl = value
          step = .price
        }
        .frame(minHeight: 38)
        .buttonStyle(.bordered)
        .tint(WatchTheme.amber)
        .accessibilityIdentifier("watch.newDrink.customVolume")
      }
    }
  }

  private var priceStep: some View {
    VStack(spacing: 10) {
      Image(systemName: "banknote.fill")
        .font(.title2)
        .foregroundStyle(WatchTheme.amber)
      Text("Kolik stál?")
        .font(.headline)
      if let priceCzk {
        Text("\(priceCzk) Kč")
          .font(.title2.monospacedDigit().weight(.bold))
      }
      TextFieldLink(
        priceCzk == nil ? "Zadat cenu" : "Změnit cenu",
        prompt: Text("1 až 1000 Kč")
      ) { result in
        let digits = result.filter(\.isNumber)
        guard let value = Int(digits), DrinkValidation.validPrice(value) else {
          validationMessage = "Cena musí být 1 až 1000 Kč."
          return
        }
        priceCzk = value
        step = .review
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .accessibilityIdentifier("watch.newDrink.priceInput")
      if priceCzk != nil {
        Button("Cena sedí") {
          step = .review
        }
        .accessibilityIdentifier("watch.newDrink.confirmPrice")
      }
    }
  }

  private var reviewStep: some View {
    VStack(spacing: 9) {
      WatchCard {
        VStack(alignment: .leading, spacing: 4) {
          Label(drinkType.title, systemImage: drinkType.systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(WatchTheme.amber)
          Text(name)
            .font(.headline)
            .privacySensitive()
          Text("\(DrinkSpec.formatVolume(volumeMl)) · \(priceCzk ?? 0) Kč")
            .font(.caption)
            .foregroundStyle(WatchTheme.muted)
        }
      }
      Button {
        guard let priceCzk else {
          validationMessage = "Ještě chybí cena."
          return
        }
        model.recordNewDrink(
          type: drinkType,
          name: name,
          volumeMl: volumeMl,
          priceCzk: priceCzk,
          servingType: drinkType == .beer ? .draft : .unknown
        )
        dismiss()
      } label: {
        Label("Zapsat drink", systemImage: "plus.circle.fill")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .accessibilityIdentifier("watch.newDrink.submit")
      Button("Změnit cenu") {
        step = .price
      }
      .font(.caption)
    }
  }

  private var progressIndex: Int {
    switch step {
    case .type: 0
    case .name, .confirmName: 1
    case .volume: 2
    case .price: 3
    case .review: 4
    }
  }
}
