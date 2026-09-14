import SwiftUI

@main
struct NapivoWatchApp: App {
  @StateObject private var model = WatchAppModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      WatchRootView()
        .environmentObject(model)
        .task {
          model.start()
        }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active {
            model.resume()
          } else {
            model.stop()
          }
        }
    }
  }
}
