import SwiftUI

struct PubConfirmationView: View {
  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(spacing: 8) {
      Text("Jsi opravdu tady?")
        .font(.headline)
      Text(model.pendingConfirmationPub?.name ?? "")
        .font(.body.weight(.bold))
        .multilineTextAlignment(.center)
        .lineLimit(2)
        .minimumScaleFactor(0.78)
        .privacySensitive()
      Label("Hospodu potvrzuješ ty, ne GPS.", systemImage: "hand.tap.fill")
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(WatchTheme.muted)
        .multilineTextAlignment(.center)

      Button {
        model.confirmPub()
      } label: {
        Text("Jo, jsem tady")
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.borderedProminent)
      .tint(WatchTheme.amber)
      .foregroundStyle(WatchTheme.background)
      .controlSize(.large)
      .accessibilityIdentifier("watch.pub.confirm")
    }
    .padding(.horizontal, 8)
    .accessibilityAction(named: "Zrušit") {
      model.cancelPubConfirmation()
      dismiss()
    }
  }
}
