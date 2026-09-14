import SwiftUI

struct WatchRootView: View {
  @EnvironmentObject private var model: WatchAppModel

  var body: some View {
    NavigationStack {
      Group {
        if model.hasActiveEvening, !model.showCompass {
          CounterView()
        } else {
          CompassView()
        }
      }
      .background(WatchTheme.background.ignoresSafeArea())
    }
    .sheet(item: $model.presentedSheet) { sheet in
      sheetContent(sheet)
        .modifier(WatchModelAlerts(isSheetContext: true))
    }
    .modifier(WatchModelAlerts(isSheetContext: false))
  }

  @ViewBuilder
  private func sheetContent(_ sheet: WatchAppModel.PresentedSheet) -> some View {
    switch sheet {
    case .targetPicker:
      TargetPickerView()
    case .pubConfirmation:
      PubConfirmationView()
    case .drinkPicker:
      DrinkPickerView()
    case .receipt:
      ReceiptView()
    case .syncStatus:
      SyncStatusView()
    }
  }
}

private struct WatchModelAlerts: ViewModifier {
  @EnvironmentObject private var model: WatchAppModel
  let isSheetContext: Bool

  func body(content: Content) -> some View {
    content
      .alert(
        "Tak rychle?",
        isPresented: Binding(
          get: { contextIsActive && model.rapidConfirmation != nil },
          set: { if !$0 { model.cancelRapidRecord() } }
        )
      ) {
        Button("Jo, dej to tam") {
          model.confirmRapidRecord()
        }
        Button("Ne, překlep", role: .cancel) {
          model.cancelRapidRecord()
        }
      } message: {
        Text("Poslední drink je před chvilkou. Opravdu další?")
      }
      .alert(
        "Na pivo",
        isPresented: Binding(
          get: { contextIsActive && model.notice != nil },
          set: { if !$0 { model.notice = nil } }
        )
      ) {
        Button("Dobře") {
          model.notice = nil
        }
      } message: {
        Text(model.notice ?? "")
      }
  }

  private var contextIsActive: Bool {
    if isSheetContext {
      return model.presentedSheet != nil
    }
    return model.presentedSheet == nil
  }
}
