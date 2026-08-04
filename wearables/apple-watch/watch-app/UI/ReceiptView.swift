import SwiftUI

struct ReceiptView: View {
  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss
  @State private var showFinishConfirmation = false

  var body: some View {
    NavigationStack {
      List {
        Section {
          HStack {
            Text("Účet")
              .font(.headline)
            Spacer()
            Text("\(model.currentEvening?.totalCzk ?? 0) Kč")
              .font(.headline.monospacedDigit())
              .foregroundStyle(WatchTheme.amber)
          }
          HStack {
            Text("\(model.currentEvening?.beerCount ?? 0) piv")
            Spacer()
            Text(otherSummary)
          }
          .font(.caption)
          .foregroundStyle(WatchTheme.muted)
        }

        Section("Rozpis") {
          ForEach((model.currentEvening?.visibleDrinks ?? []).reversed()) { drink in
            HStack(spacing: 6) {
              VStack(alignment: .leading, spacing: 1) {
                Text(drink.name)
                  .font(.caption.weight(.semibold))
                  .lineLimit(2)
                  .privacySensitive()
                Text(drink.summary)
                  .font(.system(size: 9))
                  .foregroundStyle(WatchTheme.muted)
              }
              Spacer()
              Button(role: .destructive) {
                model.removeDrink(drink)
              } label: {
                Image(systemName: "minus.circle.fill")
              }
              .buttonStyle(.plain)
              .accessibilityLabel("Odebrat \(drink.name)")
              .accessibilityIdentifier("watch.receipt.remove.\(drink.id.uuidString)")
            }
          }
        }

        Section {
          Button(role: .destructive) {
            showFinishConfirmation = true
          } label: {
            Label("Dopito", systemImage: "checkered.flag")
              .frame(maxWidth: .infinity)
          }
          .accessibilityIdentifier("watch.receipt.finish")
        }
      }
      .listStyle(.carousel)
      .navigationTitle("Tácek")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Hotovo") {
            dismiss()
          }
        }
      }
      .alert("Zavřít večer?", isPresented: $showFinishConfirmation) {
        Button("Dopito", role: .destructive) {
          model.finishEvening()
          dismiss()
        }
        Button("Ještě ne", role: .cancel) {}
      }
    }
  }

  private var otherSummary: String {
    guard let evening = model.currentEvening else { return "0 ostatních" }
    let count = evening.otherCounts.values.reduce(0, +)
    return "\(count) ostatních"
  }
}
