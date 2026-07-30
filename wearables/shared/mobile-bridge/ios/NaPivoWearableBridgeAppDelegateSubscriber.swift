import ExpoModulesCore
import UIKit

public final class NaPivoWearableBridgeAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    NaPivoWearableConnectivityCoordinator.shared.activate()
    return false
  }
}
