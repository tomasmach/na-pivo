import SwiftUI

struct DrinkPickerView: View {
  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss
  @State private var showOtherTypes = false

  var body: some View {
    NavigationStack {
      List {
        if model.isLoadingMenu {
          HStack {
            ProgressView()
            Text("Čepuju nabídku…")
              .font(.caption)
          }
        }

        if !model.menuCandidates.isEmpty {
          Section("Nabídka hospody") {
            ForEach(model.menuCandidates) { template in
              candidateRow(template)
            }
          }
        }

        if !model.recentCandidates.isEmpty {
          Section("Poslední") {
            ForEach(model.recentCandidates.prefix(5)) { template in
              candidateRow(template)
            }
          }
        }

        if !model.frequentCandidates.isEmpty {
          Section("Časté") {
            ForEach(model.frequentCandidates.prefix(5)) { template in
              candidateRow(template)
            }
          }
        }

        Section {
          NavigationLink {
            NewDrinkFlowView(initialType: .beer, seed: nil)
          } label: {
            Label("Přidat nové", systemImage: "plus.circle.fill")
              .foregroundStyle(WatchTheme.amber)
          }
          .accessibilityIdentifier("watch.drinks.addNew")

          Button {
            withAnimation {
              showOtherTypes.toggle()
            }
          } label: {
            HStack {
              Label("Něco jiného", systemImage: "ellipsis")
              Spacer()
              Image(systemName: showOtherTypes ? "chevron.up" : "chevron.down")
            }
          }
          .accessibilityIdentifier("watch.drinks.otherTypes")

          if showOtherTypes {
            ForEach([DrinkType.softDrink, .wine, .shot]) { type in
              NavigationLink {
                NewDrinkFlowView(
                  initialType: type,
                  seed: nil,
                  startsAtTypePicker: false
                )
              } label: {
                Label(type.title, systemImage: type.systemImage)
              }
              .accessibilityIdentifier("watch.drinks.type.\(type.rawValue)")
            }
          }
        }
      }
      .listStyle(.carousel)
      .navigationTitle("Co to bude?")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Zavřít") {
            model.presentedSheet = nil
            dismiss()
          }
        }
      }
    }
  }

  @ViewBuilder
  private func candidateRow(_ template: DrinkTemplate) -> some View {
    if template.priceCzk == nil || template.volumeMl == nil {
      NavigationLink {
        NewDrinkFlowView(initialType: template.drinkType, seed: template)
      } label: {
        DrinkCandidateLabel(template: template, needsPrice: true)
      }
    } else {
      Button {
        guard
          let pub = model.pendingConfirmationPub ?? model.currentEvening?.pub
            ?? model.selectedTarget
        else {
          return
        }
        model.requestRecord(template, at: pub)
      } label: {
        DrinkCandidateLabel(template: template, needsPrice: false)
      }
      .accessibilityIdentifier("watch.drinks.candidate.\(template.id)")
    }
  }
}

private struct DrinkCandidateLabel: View {
  let template: DrinkTemplate
  let needsPrice: Bool

  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: template.drinkType.systemImage)
        .foregroundStyle(WatchTheme.amber)
      VStack(alignment: .leading, spacing: 2) {
        Text(template.name)
          .font(.body.weight(.semibold))
          .lineLimit(2)
          .privacySensitive()
        Text(meta)
          .font(.caption2)
          .foregroundStyle(needsPrice ? WatchTheme.warning : WatchTheme.muted)
      }
    }
  }

  private var meta: String {
    let volume = template.volumeMl.map(DrinkSpec.formatVolume)
    if let price = template.priceCzk {
      if let volume {
        return "\(template.drinkType.shortTitle) · \(volume) · \(price) Kč"
      }
      return "\(template.drinkType.shortTitle) · doplnit objem · \(price) Kč"
    }
    return "\(volume ?? "objem neznámý") · doplnit cenu"
  }
}
