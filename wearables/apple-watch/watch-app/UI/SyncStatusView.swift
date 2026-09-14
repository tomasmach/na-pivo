import SwiftUI

struct SyncStatusView: View {
  @EnvironmentObject private var model: WatchAppModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        Section("Spojení") {
          Label(model.syncLabel, systemImage: connectionIcon)
          if let contact = model.state.lastPhoneContactAt {
            HStack {
              Text("Telefon naposledy")
              Spacer()
              Text(contact, style: .relative)
            }
            .font(.caption)
          }
          if model.state.isStale {
            Label("Data můžou být starší", systemImage: "clock.badge.exclamationmark")
              .foregroundStyle(WatchTheme.amber)
          }
          if model.phoneNeedsUnlock {
            Text("Po restartu odemkni iPhone.")
              .font(.caption)
              .foregroundStyle(WatchTheme.warning)
          }
        }

        if let issue = model.state.syncIssue {
          Section("Potřebuje tvoje slovo") {
            Text(issue.message)
              .font(.caption)
              .foregroundStyle(WatchTheme.warning)

            if issue == .targetConflict {
              if let phone = model.state.target {
                Button {
                  model.resolveTargetConflict(using: phone)
                } label: {
                  VStack(alignment: .leading) {
                    Text("Cíl z telefonu")
                      .font(.caption2)
                    Text(phone.pub.name)
                      .font(.body.weight(.semibold))
                      .privacySensitive()
                  }
                }
                .accessibilityIdentifier("watch.sync.choosePhoneTarget")
              }
              if let watch = model.state.conflictingTarget {
                Button {
                  model.resolveTargetConflict(using: watch)
                } label: {
                  VStack(alignment: .leading) {
                    Text("Cíl z hodinek")
                      .font(.caption2)
                    Text(watch.pub.name)
                      .font(.body.weight(.semibold))
                      .privacySensitive()
                  }
                }
                .accessibilityIdentifier("watch.sync.chooseWatchTarget")
              }
            }

            if issue == .eveningConflict {
              ForEach(conflictingEvenings) { evening in
                Button {
                  model.resolveEveningConflict(using: evening.eveningId)
                } label: {
                  VStack(alignment: .leading) {
                    Text(evening.pub.name)
                      .font(.body.weight(.semibold))
                      .privacySensitive()
                    Text("\(evening.visibleDrinks.count) drinků zůstane tady")
                      .font(.caption2)
                  }
                }
                .accessibilityIdentifier("watch.sync.chooseEvening.\(evening.eveningId.uuidString)")
              }
            }
          }
        }

        Section {
          Button {
            model.requestPhoneSync()
          } label: {
            Label("Srovnat teď", systemImage: "arrow.triangle.2.circlepath")
              .frame(maxWidth: .infinity)
          }
          .disabled(!model.isPhoneReachable)
          .accessibilityIdentifier("watch.sync.retry")
        } footer: {
          Text("Neodeslané zápisy zůstávají na hodinkách i po restartu.")
        }
      }
      .listStyle(.carousel)
      .navigationTitle("Synchronizace")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Zavřít") {
            dismiss()
          }
        }
      }
    }
  }

  private var connectionIcon: String {
    if model.state.syncIssue != nil { return "exclamationmark.triangle.fill" }
    if model.pendingCommandCount > 0 { return "clock.arrow.circlepath" }
    return model.isPhoneReachable ? "checkmark.icloud.fill" : "iphone.slash"
  }

  private var conflictingEvenings: [EveningState] {
    ([model.state.activeEvening].compactMap { $0 } + model.state.otherEvenings)
      .filter { $0.status == .conflict || $0.status == .active }
  }
}
