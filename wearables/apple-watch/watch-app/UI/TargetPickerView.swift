import CoreLocation
import SwiftUI

struct TargetPickerView: View {
  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Group {
        if model.state.nearbyPubs.isEmpty {
          EmptyStateCard(
            icon: "mug",
            title: "Žádná hospoda po ruce",
            message: "Až se chytí poloha nebo telefon, objeví se tady."
          )
        } else {
          List(model.state.nearbyPubs) { pub in
            Button {
              model.selectTarget(pub)
              dismiss()
            } label: {
              HStack(spacing: 8) {
                Image(
                  systemName: model.selectedTarget?.pubKey == pub.pubKey
                    ? "location.circle.fill"
                    : "mug.fill"
                )
                .foregroundStyle(WatchTheme.amber)
                VStack(alignment: .leading, spacing: 2) {
                  Text(pub.name)
                    .font(.body.weight(.semibold))
                    .lineLimit(2)
                    .privacySensitive()
                  Text(distance(to: pub))
                    .font(.caption2)
                    .foregroundStyle(WatchTheme.muted)
                }
              }
            }
            .accessibilityIdentifier("watch.target.\(pub.pubKey)")
          }
          .listStyle(.carousel)
        }
      }
      .navigationTitle("Kam to bude?")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Zavřít") {
            dismiss()
          }
        }
      }
    }
  }

  private func distance(to pub: PubRef) -> String {
    guard let location = model.location else { return pub.city ?? "v okolí" }
    let metres = NearbyPubsClient.distance(from: location, to: pub)
    if metres < 1_000 {
      return "\(Int(metres.rounded())) m"
    }
    return String(format: "%.1f km", metres / 1_000).replacingOccurrences(of: ".", with: ",")
  }
}
